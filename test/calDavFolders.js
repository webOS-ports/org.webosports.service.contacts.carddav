/*
 * CalDav.getFolders against a server that fails first and answers later.
 * Runs under mocha (make test) or "node --test test/calDavFolders.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var path = require("path");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");
var root = path.join(__dirname, "..");
var utils = path.join(root, "service", "javascript", "utils") + path.sep;

function quiet() {
	return undefined;
}

global.Future = require(path.join(root, "test-scripts", "foundations", "future"));
global.checkResult = require(utils + "checkResult.js");
global.libPath = utils;
global.Log = {log: quiet, debug: quiet, log_calDavDebug: quiet, log_calDavParsingDebug: quiet};

var answers, requests, delays;

global.httpClient = {
	parseURLIntoOptions: function (url, options) {
		options.path = url;
		options.prefix = "";
	},
	sendRequest: function () {
		var future = new global.Future(), answer = answers.shift();
		requests += 1;
		setImmediate(function () {
			future.result = answer;
		});
		return future;
	}
};

var CalDav = require(utils + "CalDav.js");
var realSetTimeout = global.setTimeout;
var ok = {returnValue: true, returnCode: 207, parsedBody: {multistatus: {response: [{href: {$t: "/home/"}}]}}};

function failure(code) {
	return {returnValue: false, returnCode: code};
}

function list(serverAnswers) {
	answers = serverAnswers;
	requests = 0;
	delays = [];
	global.setTimeout = function (callback, delay) {
		delays.push(delay);
		return setImmediate(callback);
	};
	return new Promise(function (resolve) {
		var future = CalDav.getFolders({path: "https://server/home/", userAuth: {}}, "contact");
		future.then(function () {
			global.setTimeout = realSetTimeout;
			resolve(global.checkResult(future));
		});
	});
}

bdd.describe("CalDav.getFolders", function () {
	bdd.it("lists the folders after a temporary server error", function () {
		return list([failure(502), ok]).then(function (result) {
			assert.strictEqual(result.returnValue, true);
			assert.deepStrictEqual(result.folders, []);
			assert.strictEqual(requests, 2);
			assert.strictEqual(delays.length, 1);
		});
	});

	bdd.it("gives up when the server keeps failing", function () {
		return list([failure(503), failure(503), failure(504), failure(502), ok]).then(function (result) {
			assert.strictEqual(result.returnValue, false);
			assert.strictEqual(result.returnCode, 502);
			assert.strictEqual(requests, 4);
		});
	});

	bdd.it("does not repeat a request the server rejected", function () {
		return list([failure(403), ok]).then(function (result) {
			assert.strictEqual(result.returnCode, 403);
			assert.strictEqual(requests, 1);
		});
	});
});
