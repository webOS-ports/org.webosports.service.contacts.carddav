/*
 * Which zones a batch of events asks the time zone manager for. The system
 * service refuses a whole request when one of its entries is not a name.
 * Runs under mocha (make test) or "node --test test/iCalTimeZones.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var path = require("path");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");
var root = path.join(__dirname, "..");
var utils = path.join(root, "service", "javascript", "utils") + path.sep;
var timeFile = utils + "iCalTimeHandling.js";

function quiet() {
	return undefined;
}

global.Future = require(path.join(root, "test-scripts", "foundations", "future"));
global.checkResult = require(utils + "checkResult.js");
global.libPath = utils;
global.Log = {log: quiet, debug: quiet, log_icalDebug: quiet};

var requested;
var manager = {
	timezone: "Europe/Amsterdam",
	loadTimezones: function (timezones) {
		requested = timezones;
		return new global.Future({returnValue: true});
	},
	convertTime: function (timestamp) {
		return timestamp;
	},
	getOffset: function () {
		return 3600;
	}
};

global.Calendar = {TimezoneManager: function () { return manager; }};
delete require.cache[timeFile];
var Time = require(timeFile);
delete require.cache[timeFile];

function zonesFor(events) {
	return new Promise(function (resolve) {
		Time.normalizeToLocalTimezone(events).then(function (future) {
			future.getResult();
			resolve(requested);
		});
	});
}

bdd.describe("iCalTimeHandling zone requests", function () {
	bdd.it("asks only for names when a zone has no Windows mapping", function () {
		return zonesFor([{tzId: "Europe/Amsterdam"}]).then(function (zones) {
			assert.deepStrictEqual(zones, ["Europe/Amsterdam"]);
		});
	});

	bdd.it("also asks for the zone a Windows name stands for", function () {
		return zonesFor([{tzId: "Eastern Standard Time"}]).then(function (zones) {
			assert.strictEqual(zones[0], "Eastern Standard Time");
			assert.ok(zones.length > 1 && zones.slice(1).every(function (zone) {
				return zone.indexOf("/") > 0;
			}));
		});
	});

	bdd.it("uses the local zone for an event without one", function () {
		return zonesFor([{}]).then(function (zones) {
			assert.deepStrictEqual(zones, ["Europe/Amsterdam"]);
		});
	});
});
