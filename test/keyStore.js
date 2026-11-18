/*
 * KeyStore against a key manager that behaves like the real one: every call
 * answers later, and storing a key that exists fails.
 * Runs under mocha (make test) or "node --test test/keyStore.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var path = require("path");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");
var root = path.join(__dirname, "..");

global.Future = require(path.join(root, "test-scripts", "foundations", "future"));
global.checkResult = require(path.join(root, "service", "javascript", "utils", "checkResult.js"));
global.libPath = path.join(root, "service", "javascript", "utils") + path.sep;
global.Log = {log: function () { return undefined; }, debug: function () { return undefined; }};

var keys, failStore;
global.PalmCall = {
	call: function (uri, method, args) {
		var future = new global.Future();
		setImmediate(function () {
			var name = args.keyname;
			if (method === "store" && failStore) {
				future.setException(new Error("store refused"));
			} else if (method === "store" && keys[name]) {
				future.setException(new Error("Key already exists"));
			} else if (method === "store") {
				keys[name] = args.keydata;
				future.result = {returnValue: true};
			} else if (!keys[name]) {
				future.setException(new Error("Key not found"));
			} else if (method === "remove") {
				delete keys[name];
				future.result = {returnValue: true};
			} else {
				future.result = {returnValue: true, keyname: name, keydata: keys[name]};
			}
		});
		return future;
	}
};

var KeyStore = require(path.join(root, "service", "javascript", "utils", "KeyStore.js"));

function outcome(future) {
	return new Promise(function (resolve) {
		future.then(function () {
			resolve(global.checkResult(future));
		});
	});
}

bdd.describe("KeyStore.putKey", function () {
	bdd.it("stores both of two simultaneous puts for one account, the later one last", function () {
		keys = {};
		failStore = false;
		return Promise.all([
			outcome(KeyStore.putKey("account", {from: "contacts"})),
			outcome(KeyStore.putKey("account", {from: "calendar"}))
		]).then(function (results) {
			assert.strictEqual(results[0].returnValue, true);
			assert.strictEqual(results[1].returnValue, true);
			return outcome(KeyStore.getKey("account"));
		}).then(function (result) {
			assert.deepStrictEqual(result.credentials, {from: "calendar"});
		});
	});

	bdd.it("reports a failed store and still runs the put waiting behind it", function () {
		keys = {};
		failStore = true;
		var first = outcome(KeyStore.putKey("account", {n: 1}));
		var second = KeyStore.putKey("account", {n: 2});
		return first.then(function (result) {
			assert.strictEqual(result.returnValue, false);
			failStore = false;
			return outcome(second);
		}).then(function (result) {
			assert.strictEqual(result.returnValue, true);
		});
	});
});
