/*
 * OnEnabled against a framework command that behaves like the real one: an
 * account being disabled refuses a second disable as busy.
 * Runs under mocha (make test) or "node --test test/onEnabled.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");
var root = path.join(__dirname, "..");
var foundations = path.join(root, "test-scripts", "foundations");

global.Future = require(path.join(foundations, "future"));
global.Class = require(path.join(foundations, "class.js")).Class;
global.checkResult = require(path.join(root, "service", "javascript", "utils", "checkResult.js"));
global.Log = {log: function () { return undefined; }, debug: function () { return undefined; }};
global.PalmCall = {};

var inProgress, disabled, initialSyncs, active, maxActive, duration;

global.Sync = {
	EnabledAccountCommand: global.Class.create({
		initialize: function (capability, enabled, accountId) {
			this.capability = capability;
			this.client = {clientId: accountId || "account", kinds: {objects: {}}};
			this.controller = {args: {enabled: enabled}, service: {name: "service"}};
			this.handler = {
				enableAccount: function () {
					var future = new global.Future();
					setImmediate(function () {
						future.result = true; //a new account: the framework wants an initial sync.
					});
					return future;
				}
			};
		},
		run: function (result) {
			var self = this, accountId = this.client.clientId;
			if (!this.controller.args.enabled && inProgress[accountId]) {
				result.result = {returnValue: false, errorText: "Sync in progress", errorCode: "BUSY"};
				return;
			}
			inProgress[accountId] = !this.controller.args.enabled;
			active += 1;
			maxActive = Math.max(maxActive, active);
			setTimeout(function () {
				active -= 1;
				inProgress[accountId] = false;
				if (!self.controller.args.enabled) {
					disabled.push(self.capability);
					result.result = true;
					return;
				}
				self.handler.enableAccount({}).then(function (future) {
					if (future.result) {
						initialSyncs.push(self.capability);
					}
					result.result = true;
				});
			}, duration);
		}
	})
};

var source = fs.readFileSync(path.join(root, "service", "javascript", "assistants", "onenabledassistant.js"), "utf8");
var OnEnabled = vm.runInThisContext("(function () {" + source + "\nreturn OnEnabled;}())");

function reset() {
	inProgress = {};
	disabled = [];
	initialSyncs = [];
	active = 0;
	maxActive = 0;
	duration = 5;
}

function outcome(future) {
	return new Promise(function (resolve) {
		future.then(function () {
			resolve(global.checkResult(future));
		});
	});
}

function start(capability, enabled, accountId) {
	return outcome(new OnEnabled(capability, enabled, accountId).run(new global.Future()));
}

bdd.describe("OnEnabled", function () {
	bdd.it("disables both capabilities of an account when asked at the same moment", function () {
		reset();
		return Promise.all([start("contacts", false), start("calendar", false)]).then(function (results) {
			assert.deepStrictEqual(results, [true, true]);
			assert.deepStrictEqual(disabled, ["contacts", "calendar"]);
			assert.strictEqual(maxActive, 1);
		});
	});

	bdd.it("runs enabling one capability at a time as well", function () {
		reset();
		return Promise.all([start("contacts", true), start("calendar", true)]).then(function () {
			assert.strictEqual(maxActive, 1);
		});
	});

	bdd.it("starts one initial sync when capabilities are enabled together", function () {
		reset();
		return Promise.all([start("contacts", true), start("calendar", true)]).then(function () {
			assert.deepStrictEqual(initialSyncs, ["calendar"]);
		});
	});

	bdd.it("starts the initial sync for a capability enabled on its own", function () {
		reset();
		return start("contacts", true).then(function () {
			assert.deepStrictEqual(initialSyncs, ["contacts"]);
		});
	});

	bdd.it("still starts the initial sync when only a disable is waiting", function () {
		reset();
		return Promise.all([start("contacts", true), start("calendar", false)]).then(function () {
			assert.deepStrictEqual(initialSyncs, ["contacts"]);
			assert.deepStrictEqual(disabled, ["calendar"]);
		});
	});

	bdd.it("waits for a running sync instead of leaving the data behind", function () {
		reset();
		inProgress.account = true;
		setTimeout(function () {
			inProgress.account = false;
		}, 100);
		return start("contacts", false).then(function (result) {
			assert.strictEqual(result, true);
			assert.deepStrictEqual(disabled, ["contacts"]);
		});
	});

	bdd.it("does not make different accounts wait for each other", function () {
		reset();
		duration = 30;
		return Promise.all([start("contacts", false, "one"), start("contacts", false, "two")]).then(function () {
			assert.strictEqual(maxActive, 2);
		});
	});
});
