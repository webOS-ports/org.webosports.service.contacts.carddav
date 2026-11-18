/*
 * Repeats worked out by the service. The expected dates are the examples of
 * RFC 5545 section 3.8.5.3.
 * Runs under mocha (make test) or "node --test test/iCalRecurrence.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var path = require("path");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");
var Recurrence = require(path.join(__dirname, "..", "service", "javascript", "utils", "iCalRecurrence.js"));

function wall(text) {
	return Date.UTC(+text.substr(0, 4), +text.substr(4, 2) - 1, +text.substr(6, 2),
		+(text.substr(9, 2) || 9), +(text.substr(11, 2) || 0));
}
function days(walls) {
	return walls.map(function (value) {
		return new Date(value).toISOString().substr(0, 10).replace(/-/g, "");
	});
}
function clock(walls) {
	return walls.map(function (value) {
		return new Date(value).toISOString().substr(0, 16).replace(/[\-:]/g, "");
	});
}
function expand(rule, start, options) {
	return Recurrence.expandRule(Recurrence.parseRule(rule), wall(start), options);
}

bdd.describe("working out repeats", function () {
	[
		["WKST=MO", "19970805", "FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO", ["19970805", "19970810", "19970819", "19970824"]],
		["WKST=SU", "19970805", "FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU", ["19970805", "19970817", "19970819", "19970831"]],
		["second to last weekday", "19970929", "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2;COUNT=7",
			["19970929", "19971030", "19971127", "19971230", "19980129", "19980226", "19980330"]],
		["third to last day", "19970928", "FREQ=MONTHLY;BYMONTHDAY=-3;COUNT=6", ["19970928", "19971029", "19971128", "19971229", "19980129", "19980226"]],
		["Friday the 13th", "19980213", "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13;COUNT=5", ["19980213", "19980313", "19981113", "19990813", "20001013"]],
		["days of the year", "19970101", "FREQ=YEARLY;INTERVAL=3;COUNT=7;BYYEARDAY=1,100,200",
			["19970101", "19970410", "19970719", "20000101", "20000409", "20000718", "20030101"]],
		["week number", "19970512", "FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO;COUNT=3", ["19970512", "19980511", "19990517"]],
		["20th Monday of the year", "19970519", "FREQ=YEARLY;BYDAY=20MO;COUNT=3", ["19970519", "19980518", "19990517"]],
		["Thursdays in March", "19970313", "FREQ=YEARLY;BYMONTH=3;BYDAY=TH;COUNT=4", ["19970313", "19970320", "19970327", "19980305"]],
		["last Friday", "19970926", "FREQ=MONTHLY;BYDAY=-1FR;COUNT=3", ["19970926", "19971031", "19971128"]],
		["first Thursday of March", "19970306", "FREQ=YEARLY;BYMONTH=3;BYDAY=1TH;COUNT=3", ["19970306", "19980305", "19990304"]],
		["the 31st", "19970131", "FREQ=MONTHLY;COUNT=4", ["19970131", "19970331", "19970531", "19970731"]],
		["29 February", "20280229", "FREQ=YEARLY;COUNT=2", ["20280229", "20320229"]]
	].forEach(function (c) {
		bdd.it(c[0], function () {
			assert.deepStrictEqual(days(expand(c[2], c[1])), c[3]);
		});
	});

	bdd.it("every three hours until the afternoon", function () {
		assert.deepStrictEqual(clock(expand("FREQ=HOURLY;INTERVAL=3", "19970902T0900", {until: wall("19970902T1700")})),
			["19970902T0900", "19970902T1200", "19970902T1500"]);
	});

	bdd.it("every 15 minutes", function () {
		assert.deepStrictEqual(clock(expand("FREQ=MINUTELY;INTERVAL=15;COUNT=6", "19970902T0900")),
			["19970902T0900", "19970902T0915", "19970902T0930", "19970902T0945", "19970902T1000", "19970902T1015"]);
	});

	bdd.it("every 20 minutes from nine to five, written two ways", function () {
		var one = expand("FREQ=DAILY;BYHOUR=9,10,11,12,13,14,15,16;BYMINUTE=0,20,40;COUNT=25", "19970902T0900"),
			two = expand("FREQ=MINUTELY;INTERVAL=20;BYHOUR=9,10,11,12,13,14,15,16;COUNT=25", "19970902T0900");
		assert.deepStrictEqual(clock(one), clock(two));
		assert.strictEqual(clock(one)[24], "19970903T0900");
	});

	bdd.it("stops at the end of the window and skips what is too old", function () {
		var walls = expand("FREQ=DAILY", "20200101", {from: wall("20260101"), to: wall("20260103")});
		assert.deepStrictEqual(days(walls), ["20200101", "20260101", "20260102", "20260103"]);
	});

	bdd.it("stops inside a period at the end of the window", function () {
		var walls = expand("FREQ=MONTHLY;BYMONTHDAY=1,20", "20260101", {to: wall("20260110")});
		assert.deepStrictEqual(days(walls), ["20260101"]);
	});

	bdd.it("does not need to walk through years of minutes", function () {
		var walls = expand("FREQ=MINUTELY", "20000101", {from: wall("20260101"), to: wall("20260101") + 120000});
		assert.strictEqual(walls.length, 4);
	});

	bdd.it("leaves what the calendar can do to the calendar", function () {
		["FREQ=DAILY;COUNT=3", "FREQ=WEEKLY;BYDAY=MO,WE;WKST=SU", "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;WKST=MO", "FREQ=MONTHLY;BYDAY=2TU", "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13"].forEach(function (rule) {
			assert.strictEqual(Recurrence.needsExpansion(rule), false, rule);
		});
		["FREQ=HOURLY", "FREQ=DAILY;BYHOUR=9,17", "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;WKST=SU", "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13;COUNT=3"].forEach(function (rule) {
			assert.strictEqual(Recurrence.needsExpansion(rule), true, rule);
		});
	});
});
