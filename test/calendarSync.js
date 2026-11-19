/*
 * How a series with exceptions reaches the database, and uploading several
 * changes in one go.
 * Runs under mocha (make test) or "node --test test/calendarSync.js".
 */
/*jslint node: true, nomen: true */
"use strict";

var assert = require("assert");
var path = require("path");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");
var root = path.join(__dirname, "..");
var service = path.join(root, "service", "javascript");
var foundations = path.join(root, "test-scripts", "foundations");

function quiet() {
	return undefined;
}

global.Future = require(path.join(foundations, "future"));
global.Class = require(path.join(foundations, "class.js")).Class;
global.checkResult = require(path.join(service, "utils", "checkResult.js"));
global.libPath = path.join(service, "utils") + path.sep;
global.Log = {log: quiet, debug: quiet, log_icalDebug: quiet};
global.Contacts = {};
global.fs = require("fs");
global.Sync = {SyncCommand: global.Class.create({})};
global.Kinds = require(path.join(service, "kinds.js")).Kinds;

var stored;

function answer(value) {
	var future = new global.Future();
	setImmediate(function () {
		future.result = value;
	});
	return future;
}

global.DB = {
	find: function () {
		return answer({returnValue: true, results: stored});
	},
	merge: function () {
		return answer({returnValue: true});
	},
	reserveIds: function () {
		return answer({returnValue: true, ids: ["reserved"]});
	}
};

var CalendarEventHandler = require(global.libPath + "CalendarEventHandler.js");
var SyncAssistant = require(path.join(service, "assistants", "syncassistant.js"));

function finished(future) {
	return new Promise(function (resolve) {
		future.then(function () {
			resolve(global.checkResult(future));
		});
	});
}

bdd.describe("a series with exceptions", function () {
	bdd.it("gives the series the id its exceptions point to", function () {
		var series = {rrule: {freq: "DAILY"}}, child = {recurrenceId: "20260715T090000"},
			entries = [{obj: series, uri: "/a.ics", collectionId: "c", etag: "e"}];
		stored = [];
		return finished(CalendarEventHandler.processEvent(entries, 0, "/a.ics", {
			returnValue: true,
			result: series,
			hasExceptions: true,
			exceptions: [child]
		})).then(function () {
			assert.strictEqual(series._id, "reserved");
			assert.strictEqual(child.parentId, "reserved");
		});
	});

	bdd.it("finds the stored series, not one of its exceptions", function () {
		var series = {}, child = {};
		stored = [{_id: "child", _rev: 1, parentId: "parent"}, {_id: "parent", _rev: 7}];
		return finished(CalendarEventHandler.fillParentIds("/a.ics", series, [child])).then(function () {
			assert.strictEqual(series._id, "parent");
			assert.strictEqual(series._rev, 7);
			assert.strictEqual(child.parentId, "parent");
		});
	});

	bdd.it("loses its old occurrences when it changes", function () {
		var merged = [], merge = global.DB.merge, entry = {obj: {}, uri: "/a.ics"};
		global.DB.merge = function (objects) {
			merged = merged.concat(objects);
			return answer({returnValue: true});
		};
		stored = [{_id: "series"}, {_id: "child", parentId: "series", remoteId: "/a.ics"}];
		return finished(CalendarEventHandler.processEvent([entry], 0, "/a.ics", {returnValue: true, result: entry.obj})).then(function () {
			global.DB.merge = merge;
			assert.deepStrictEqual(merged.map(function (object) { return object._id; }).indexOf("child") >= 0, true);
			assert.strictEqual(merged.some(function (object) { return object._id === "series"; }), false);
		});
	});

	bdd.it("takes its occurrences along when it goes", function () {
		var merged = [], merge = global.DB.merge;
		global.DB.merge = function (objects) {
			merged = merged.concat(objects);
			return answer({returnValue: true});
		};
		stored = [{_id: "series"}, {_id: "child", parentId: "series"}];
		return finished(CalendarEventHandler.deleteChildren("/a.ics")).then(function () {
			global.DB.merge = merge;
			assert.deepStrictEqual(merged, [{_id: "child", _del: true, preventSync: true}]);
		});
	});

	bdd.it("is stored with its account even though it already has an id", function () {
		var assistant = Object.create(SyncAssistant.prototype), to = {}, transform;
		assistant.client = {clientId: "account", config: {}};
		transform = assistant._getObjectTransformer("remote2local", "calendarevent");
		transform(to, {obj: {_id: "reserved", remoteId: "/a.ics"}, uri: "/a.ics", etag: "e"});
		assert.strictEqual(to._id, "reserved");
		assert.strictEqual(to.accountId, "account");
	});
});

bdd.describe("uploading", function () {
	bdd.it("goes through every change of a batch", function () {
		var assistant = Object.create(SyncAssistant.prototype), sent = [],
			batch = [{local: {}}, {local: {}}, {local: {}}];
		assistant.client = {clientId: "account", config: {}};
		assistant._putOneRemoteObject = function (object, kindName) {
			sent.push(kindName);
			return answer({returnValue: true, uri: "/" + sent.length + ".ics", etag: "e"});
		};
		return finished(assistant._processOne(0, [], batch, "calendarevent")).then(function (result) {
			assert.deepStrictEqual(sent, ["calendarevent", "calendarevent", "calendarevent"]);
			assert.strictEqual(result.results.length, 3);
		});
	});

	function failedUpload(answerOfServer) {
		var assistant = Object.create(SyncAssistant.prototype), folders = [
			{collectionId: "mine", ctag: "c", syncToken: "s", pendingSyncToken: "p"},
			{collectionId: "other", ctag: "c", syncToken: "s"}
		], batch = [{local: {calendarId: "mine", etag: "e"}}];
		assistant.client = {clientId: "account", config: {}};
		assistant.SyncKey = {forEachFolder: function (kindName, callback) { folders.forEach(callback); }};
		assistant._putOneRemoteObject = function () { return answer(answerOfServer); };
		return finished(assistant._processOne(0, [], batch, "calendarevent")).then(function () {
			return {folders: folders, local: batch[0].local};
		});
	}

	bdd.it("after a failed upload the next sync lists the collection, so the retry happens", function () {
		return failedUpload({returnValue: false, uri: "/mine/a.ics"}).then(function (state) {
			assert.strictEqual(state.local.uploadFailed, 1);
			assert.strictEqual(state.local.etag, "e");
			assert.strictEqual(state.folders[0].ctag, 0);
			assert.strictEqual(state.folders[0].syncToken, undefined);
			assert.strictEqual(state.folders[0].pendingSyncToken, undefined);
			assert.deepStrictEqual(state.folders[1], {collectionId: "other", ctag: "c", syncToken: "s"});
		});
	});

	function offlineAssistant(calDav) {
		var assistant = Object.create(SyncAssistant.prototype);
		global.CalDav = Object.assign({samePath: function (a, b) { return a === b; }}, calDav);
		global.ID = {findURIofRemoteObject: quiet, uriToRemoteId: function (uri) { return uri; }};
		global.iCalTask = {generateTask: function () { return "BEGIN:VTODO"; }};
		global.ObjectMerge = {uploadAllowed: function () { return true; }};
		assistant.client = {clientId: "account", config: {}};
		assistant.params = {};
		assistant.folders = [{collectionId: "mine", uri: "/mine/"}];
		assistant.SyncKey = {
			forEachFolder: function (kindName, callback) { assistant.folders.forEach(callback); },
			getFolder: function () { return assistant.folders[0]; }
		};
		assistant._checkCollectionId = function () { return true; };
		return assistant;
	}

	function upload(assistant, object) {
		return finished(assistant._processOne(0, [], [object], "task"));
	}

	bdd.it("a new object that could not be sent is sent as new again", function () {
		var sent = [], online = false, local = {calendarId: "mine"}, assistant = offlineAssistant({
			putObject: function (params, remote) {
				sent.push(remote.etag);
				return answer(online ? {returnValue: true, etag: "real", uri: "/mine/n.ics"} : {returnValue: false, returnCode: -1});
			}
		});
		return upload(assistant, {operation: "save", local: local, remote: {add: true, uri: "/mine/n.ics"}}).then(function () {
			assert.strictEqual(local.notOnServer, true);
			assert.strictEqual(local.uploadFailed, 1);
			local.etag = "0"; //what postPutRemoteModify stores
			online = true;
			return upload(assistant, {operation: "save", local: local, remote: {uri: "/mine/n.ics"}});
		}).then(function () {
			assert.deepStrictEqual(sent, [undefined, undefined]);
			assert.strictEqual(local.notOnServer, false);
			assert.strictEqual(local.etag, "real");
			assert.ok(!local.uploadFailed);
		});
	});

	bdd.it("a new object the server refuses stops being new", function () {
		var local = {calendarId: "mine", notOnServer: true, etag: "0"}, assistant = offlineAssistant({
			putObject: function () { return answer({returnValue: false, returnCode: 403}); }
		});
		return upload(assistant, {operation: "save", local: local, remote: {uri: "/mine/n.ics"}}).then(function () {
			assert.strictEqual(local.notOnServer, false);
			assert.strictEqual(local.etag, "0");
		});
	});

	bdd.it("deleting an object the server never got sends nothing", function () {
		var calls = 0, assistant = offlineAssistant({
			deleteObject: function () { calls += 1; return answer({returnValue: true}); }
		});
		return upload(assistant, {operation: "delete", local: {calendarId: "mine", notOnServer: true, uri: "/mine/n.ics"},
			remote: {uri: "/mine/n.ics"}}).then(function () {
			assert.strictEqual(calls, 0);
			assert.strictEqual(assistant.folders[0].pendingDeletes, undefined);
		});
	});

	[[-1, true], [undefined, true], [401, true], [503, true], [403, false], [412, false]].forEach(function (testCase) {
		bdd.it("a delete failing with " + testCase[0] + (testCase[1] ? " is kept for later" : " is not retried"), function () {
			var assistant = offlineAssistant({
				deleteObject: function () { return answer({returnValue: false, returnCode: testCase[0]}); }
			});
			return upload(assistant, {operation: "delete", local: {calendarId: "mine", uri: "/mine/d.ics", etag: "e"},
				remote: {uri: "/mine/d.ics"}}).then(function () {
				assert.deepStrictEqual(assistant.folders[0].pendingDeletes, testCase[1] ? [{uri: "/mine/d.ics", etag: "e"}] : undefined);
			});
		});
	});

	function retry(deleteAnswer, listing, allowed) {
		var calls = [], assistant = offlineAssistant({
				deleteObject: function (params, item) { calls.push(item.uri); return answer(deleteAnswer); }
			}), folder = {uri: "/mine/", pendingDeletes: [{uri: "/mine/d.ics", etag: "e"}]};
		if (allowed === false) {
			global.ObjectMerge.uploadAllowed = function () { return false; };
		}
		return finished(assistant._retryDeletes("task", folder, listing)).then(function (result) {
			return {calls: calls, pending: folder.pendingDeletes, uris: result.etags.map(function (entry) { return entry.uri; })};
		});
	}

	function listing(etag) {
		return [{uri: "/mine/d.ics", etag: etag}, {uri: "/mine/other.ics", etag: "o"}];
	}

	bdd.it("a remembered delete that works is finished and not downloaded", function () {
		return retry({returnValue: true}, listing("e")).then(function (state) {
			assert.deepStrictEqual(state, {calls: ["/mine/d.ics"], pending: undefined, uris: ["/mine/other.ics"]});
		});
	});

	bdd.it("a remembered delete also goes out for objects outside the listing", function () {
		return retry({returnValue: false, returnCode: 404}, []).then(function (state) {
			assert.deepStrictEqual(state, {calls: ["/mine/d.ics"], pending: undefined, uris: []});
		});
	});

	bdd.it("while the server still fails the delete stays and the object stays away", function () {
		return retry({returnValue: false, returnCode: 503}, listing("e")).then(function (state) {
			assert.deepStrictEqual(state.pending, [{uri: "/mine/d.ics", etag: "e"}]);
			assert.deepStrictEqual(state.uris, ["/mine/other.ics"]);
		});
	});

	bdd.it("an object changed on the server is not deleted and comes back", function () {
		return retry({returnValue: true}, listing("new")).then(function (state) {
			assert.deepStrictEqual(state, {calls: [], pending: undefined, uris: ["/mine/d.ics", "/mine/other.ics"]});
		});
	});

	bdd.it("a refused delete brings the object back", function () {
		return retry({returnValue: false, returnCode: 403}, listing("e")).then(function (state) {
			assert.strictEqual(state.pending, undefined);
			assert.deepStrictEqual(state.uris, ["/mine/d.ics", "/mine/other.ics"]);
		});
	});

	bdd.it("with uploads off remembered deletes are dropped", function () {
		return retry({returnValue: true}, listing("e"), false).then(function (state) {
			assert.deepStrictEqual(state, {calls: [], pending: undefined, uris: ["/mine/d.ics", "/mine/other.ics"]});
		});
	});

	bdd.it("task lists never use the changes of the whole calendar", function () {
		var used = [], assistant = offlineAssistant({
			downloadEtags: function () { used.push("listing"); return answer({returnValue: true, etags: []}); },
			syncCollection: function () { used.push("changes"); return answer({returnValue: false}); }
		});
		assistant._listRemoteObjects("task", {uri: "/mine/", syncToken: "t"});
		assert.deepStrictEqual(used, ["listing"]);
	});
});
