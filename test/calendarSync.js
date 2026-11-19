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
});
