/*
 * When a sync ends: the activity that started it is completed before the
 * SyncOnEdit activities are created again. A SyncOnEdit activity replaces the
 * one with its name, and the activity manager does not release the power lock
 * of a running activity that gets replaced.
 * Runs under mocha (make test) or "node --test test/syncOnEdit.js".
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
global.ObjectMerge = {uploadAllowed: function () { return true; }};

var SyncAssistant = require(path.join(service, "assistants", "syncassistant.js"));

var calls;

function later(value, error) {
	var future = new global.Future();
	setImmediate(function () {
		if (error) {
			future.exception = error;
		} else {
			future.result = value;
		}
	});
	return future;
}

/* Stands in for Foundations.Control.Activity when SyncOnEdit activities are built. */
function FakeActivity(name) {
	this.name = name;
}
["setUserInitiated", "setExplicit", "setPersist", "setReplace", "setPower", "setRequirements",
	"setTrigger", "setCallback"].forEach(function (setter) {
	FakeActivity.prototype[setter] = function () {
		return this;
	};
});
FakeActivity.prototype.start = function () {
	calls.push("create " + this.name);
	return later({returnValue: true, activityId: 2});
};
global.Activity = FakeActivity;

/* The activity that started the sync. */
function running(options) {
	options = options || {};
	return {
		name: "SyncOnEdit:org.webosports.service.cdav:ACC:calendarevent",
		_activityId: 1,
		complete: function (restart) {
			calls.push("complete" + (restart ? " restart" : ""));
			if (options.notOwned) {
				return undefined;
			}
			return later({returnValue: !options.fail}, options.fail);
		}
	};
}

function assistant(args, recreate) {
	var a = Object.create(SyncAssistant.prototype);
	a.controller = {args: args, service: {name: "org.webosports.service.cdav"}, config: {name: "sync"}};
	a.client = {
		clientId: "ACC",
		config: {twoWay: true},
		transport: {modnum: 7, accountId: "ACC", syncKey: {}}
	};
	a.recreateActivitiesOnComplete = recreate;
	a.getSyncObjects = function () {
		return {
			calendarevent: {name: "calendarevent", id: "org.webosports.cdav.calendarevent:1"},
			calendar: {name: "calendar", id: "org.webosports.cdav.calendar:1"}
		};
	};
	a.getPeriodicSyncActivity = function () {
		return later({activityId: 1});
	};
	return a;
}

/* Lets the queued futures run, without depending on complete() giving a result. */
function settle(future) {
	var ticks = 0;
	return new Promise(function (resolve) {
		function tick() {
			ticks += 1;
			if (ticks >= 50) {
				resolve(future.exception ? {exception: future.exception} : (future.result !== undefined ? future.result : "pending"));
			} else {
				setImmediate(tick);
			}
		}
		tick();
	});
}


bdd.describe("completing a sync that has a capability", function () {
	bdd.it("completes the activity before creating SyncOnEdit activities again", function () {
		calls = [];
		return settle(assistant({capability: "CALENDAR", accountId: "ACC"}, true).complete(running())).then(function () {
			assert.deepStrictEqual(calls, [
				"complete",
				"create SyncOnEdit:org.webosports.service.cdav:ACC:calendarevent",
				"create SyncOnEdit:org.webosports.service.cdav:ACC:calendar"
			]);
		});
	});

	bdd.it("still creates them when completing fails", function () {
		calls = [];
		return settle(assistant({capability: "CALENDAR"}, true).complete(running({fail: new Error("activityId not found")}))).then(function () {
			assert.strictEqual(calls[0], "complete");
			assert.strictEqual(calls.length, 3);
		});
	});

	bdd.it("still creates them for an activity it only watched", function () {
		calls = [];
		return settle(assistant({capability: "CALENDAR"}, true).complete(running({notOwned: true}))).then(function () {
			assert.strictEqual(calls[0], "complete");
			assert.strictEqual(calls.length, 3);
		});
	});

	bdd.it("tells the framework it is done", function () {
		calls = [];
		return settle(assistant({capability: "CALENDAR"}, true).complete(running())).then(function (result) {
			assert.strictEqual(result, true);
		});
	});

	bdd.it("creates none while the capability is switched off", function () {
		calls = [];
		return settle(assistant({capability: "CALENDAR"}, false).complete(running())).then(function () {
			assert.deepStrictEqual(calls, ["complete"]);
		});
	});

	bdd.it("creates none when uploads are off", function () {
		var a = assistant({capability: "CALENDAR"}, true);
		calls = [];
		global.ObjectMerge.uploadAllowed = function () { return false; };
		return settle(a.complete(running())).then(function () {
			global.ObjectMerge.uploadAllowed = function () { return true; };
			assert.deepStrictEqual(calls, ["complete"]);
		});
	});
});

bdd.describe("completing the outer sync", function () {
	bdd.it("restarts the periodic activity and creates no SyncOnEdit activity", function () {
		calls = [];
		return settle(assistant({accountId: "ACC"}, true).complete(running())).then(function (result) {
			assert.strictEqual(result, true);
			assert.deepStrictEqual(calls, ["complete restart"]);
		});
	});
});
