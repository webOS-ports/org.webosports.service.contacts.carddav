/*
 * The iCal parser with the phone in Amsterdam and zone rules as the system
 * service reports them for 2026.
 * Runs under mocha (make test) or "node --test test/iCalParser.js".
 */
/*jslint node: true */
"use strict";

process.env.TZ = "Europe/Amsterdam";

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
global.Log = {log: quiet, debug: quiet, log_icalDebug: quiet};

var rules = {
	"Europe/Amsterdam": {hasDstChange: true, utcOffset: 3600, dstOffset: 7200, dstStart: 1774746000, dstEnd: 1792890000},
	"America/New_York": {hasDstChange: true, utcOffset: -18000, dstOffset: -14400, dstStart: 1772953200, dstEnd: 1793512800},
	"Australia/Sydney": {hasDstChange: true, utcOffset: 36000, dstOffset: 39600, dstStart: 1791043200, dstEnd: 1775318400}
};

var manager = {
	timezone: "Europe/Amsterdam",
	timezones: {},
	hasTimezoneInfo: function (tzId, year) {
		return !!(this.timezones[year] && this.timezones[year][tzId]);
	},
	loadTimezones: function (tzIds) {
		tzIds.forEach(function (tzId) {
			assert.strictEqual(typeof tzId, "string");
			if (rules[tzId]) {
				manager.timezones[2026] = manager.timezones[2026] || {};
				manager.timezones[2026][tzId] = rules[tzId];
			}
		});
		return new global.Future({returnValue: true});
	}
};

global.Calendar = {TimezoneManager: function () { return manager; }};
[utils + "iCal.js", utils + "iCalTimeHandling.js"].forEach(function (file) {
	delete require.cache[file];
});
var iCal = require(utils + "iCal.js");
[utils + "iCal.js", utils + "iCalTimeHandling.js"].forEach(function (file) {
	delete require.cache[file];
});

var LOCAL = "DTSTART;TZID=Europe/Amsterdam:20260715T090000\r\nDTEND;TZID=Europe/Amsterdam:20260715T100000\r\n";

function calendar(body) {
	return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" + body + "END:VCALENDAR\r\n";
}

function vevent(body) {
	return "BEGIN:VEVENT\r\nUID:one\r\nDTSTAMP:20260101T000000Z\r\n" + body + "END:VEVENT\r\n";
}

function zoned(tzId, day, time) {
	return "DTSTART;TZID=" + tzId + ":" + day + "T" + time + "00\r\n";
}

function parse(ical) {
	return new Promise(function (resolve, reject) {
		var future = iCal.parseICal(ical);
		future.then(function () {
			try {
				resolve(global.checkResult(future));
			} catch (e) {
				reject(e);
			}
		});
	});
}

function clock(timestamp) {
	var date = new Date(timestamp);
	return date.getDate() + "/" + (date.getMonth() + 1) + " " + date.getHours() + ":" + ("0" + date.getMinutes()).slice(-2);
}

function startOf(tzId, day, time) {
	return parse(calendar(vevent(zoned(tzId, day, time)))).then(function (parsed) {
		return clock(parsed.result.dtstart);
	});
}

bdd.describe("iCal parser", function () {
	bdd.describe("reading lines", function () {
		bdd.it("joins a line folded with a tab", function () {
			return parse(calendar(vevent(LOCAL + "SUMMARY:Hello\r\n\tWorld\r\n"))).then(function (parsed) {
				assert.strictEqual(parsed.result.subject, "HelloWorld");
			});
		});

		bdd.it("does not join a line that ends in =", function () {
			return parse(calendar(vevent(LOCAL + "SUMMARY:a=\r\nLOCATION:Room\r\n"))).then(function (parsed) {
				assert.strictEqual(parsed.result.subject, "a=");
				assert.strictEqual(parsed.result.location, "Room");
			});
		});

		bdd.it("finds an event after a to-do", function () {
			var todo = "BEGIN:VTODO\r\nUID:todo\r\nEND:VTODO\r\n";
			return parse(calendar(todo + vevent(LOCAL + "SUMMARY:After\r\n"))).then(function (parsed) {
				assert.strictEqual(parsed.result.subject, "After");
			});
		});

		bdd.it("skips a line it cannot read", function () {
			return parse(calendar(vevent(LOCAL + "X-BROKEN;A=\"x\"y:z\r\nSUMMARY:Kept\r\n"))).then(function (parsed) {
				assert.strictEqual(parsed.result.subject, "Kept");
			});
		});

		bdd.it("refuses an event without a usable start", function () {
			return parse(calendar(vevent("DTSTART:soon\r\n"))).then(function (parsed) {
				assert.strictEqual(parsed.returnValue, false);
			});
		});
	});

	bdd.describe("time zones", function () {
		bdd.it("converts a time from another zone", function () {
			return startOf("America/New_York", "20260715", "0900").then(function (time) {
				assert.strictEqual(time, "15/7 15:00");
			});
		});

		bdd.it("uses the zone's own clock change", function () {
			return startOf("America/New_York", "20260320", "0900").then(function (time) {
				assert.strictEqual(time, "20/3 14:00");
			});
		});

		bdd.it("applies daylight time south of the equator", function () {
			return startOf("Australia/Sydney", "20260115", "0900").then(function (time) {
				assert.strictEqual(time, "14/1 23:00");
			});
		});

		bdd.it("understands a quoted zone", function () {
			return startOf("\"America/New_York\"", "20260715", "0900").then(function (time) {
				assert.strictEqual(time, "15/7 15:00");
			});
		});

		bdd.it("maps a Windows zone name and stores the real one", function () {
			return parse(calendar(vevent(zoned("\"Eastern Standard Time\"", "20260715", "0900")))).then(function (parsed) {
				assert.strictEqual(clock(parsed.result.dtstart), "15/7 15:00");
				assert.strictEqual(parsed.result.tzId, "America/New_York");
			});
		});

		bdd.it("keeps the clock time for a zone nothing recognises", function () {
			return parse(calendar(vevent(zoned("\"(UTC-05:00) Eastern Time\"", "20260715", "0900")))).then(function (parsed) {
				assert.strictEqual(clock(parsed.result.dtstart), "15/7 9:00");
				assert.strictEqual(parsed.result.tzId, "Europe/Amsterdam");
			});
		});

		bdd.it("uses the rules of a VTIMEZONE in the file", function () {
			var zone = "BEGIN:VTIMEZONE\r\nTZID:Custom\r\n" +
				"BEGIN:STANDARD\r\nDTSTART:20001105T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nEND:STANDARD\r\n" +
				"BEGIN:DAYLIGHT\r\nDTSTART:20000312T020000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nEND:DAYLIGHT\r\n" +
				"END:VTIMEZONE\r\n";
			return parse(calendar(zone + vevent(zoned("Custom", "20260320", "0900")))).then(function (parsed) {
				assert.strictEqual(clock(parsed.result.dtstart), "20/3 14:00");
			});
		});

		bdd.it("reads a half-hour offset in a VTIMEZONE", function () {
			var zone = "BEGIN:VTIMEZONE\r\nTZID:India\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0530\r\nTZOFFSETTO:+0530\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";
			return parse(calendar(zone + vevent(zoned("India", "20260715", "0930")))).then(function (parsed) {
				assert.strictEqual(clock(parsed.result.dtstart), "15/7 6:00");
			});
		});
	});

	bdd.describe("all-day events", function () {
		bdd.it("does not end before it starts when DTEND equals DTSTART", function () {
			var body = "DTSTART;VALUE=DATE:20260715\r\nDTEND;VALUE=DATE:20260715\r\n";
			return parse(calendar(vevent(body))).then(function (parsed) {
				assert.ok(parsed.result.dtend > parsed.result.dtstart);
				assert.strictEqual(clock(parsed.result.dtstart), "15/7 12:00");
			});
		});

		bdd.it("stays on its day whatever zone it names", function () {
			var body = "DTSTART;VALUE=DATE;TZID=Australia/Sydney:20260715\r\nDTEND;VALUE=DATE;TZID=Australia/Sydney:20260716\r\n";
			return parse(calendar(vevent(body))).then(function (parsed) {
				assert.strictEqual(clock(parsed.result.dtstart), "15/7 12:00");
				assert.strictEqual(clock(parsed.result.dtend), "15/7 12:00");
			});
		});
	});

	bdd.describe("repeats", function () {
		var repeat = zoned("America/New_York", "20260713", "0900") + "DTEND;TZID=America/New_York:20260713T100000\r\n";

		bdd.it("keeps a count as a number", function () {
			return parse(calendar(vevent(LOCAL + "RRULE:FREQ=DAILY;COUNT=3\r\n"))).then(function (parsed) {
				assert.strictEqual(parsed.result.rrule.count, 3);
			});
		});

		bdd.it("turns BYSETPOS on one weekday into that weekday's position", function () {
			return parse(calendar(vevent(LOCAL + "RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2\r\n"))).then(function (parsed) {
				assert.deepStrictEqual(parsed.result.rrule.rules[0].ruleValue, [{day: 2, ord: 2}]);
			});
		});

		bdd.it("keeps one event when webOS cannot express BYSETPOS", function () {
			return parse(calendar(vevent(LOCAL + "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1\r\nEXDATE:20260815T090000\r\n"))).then(function (parsed) {
				assert.strictEqual(parsed.result.rrule, undefined);
				assert.strictEqual(parsed.result.exdates, undefined);
				assert.strictEqual(clock(parsed.result.dtstart), "15/7 9:00");
			});
		});

		bdd.it("stores cancelled occurrences as days in the event's zone", function () {
			var body = repeat + "RRULE:FREQ=DAILY;COUNT=9\r\nEXDATE;TZID=America/New_York:20260714T090000\r\n";
			return parse(calendar(vevent(body))).then(function (parsed) {
				assert.deepStrictEqual(parsed.result.exdates, ["20260714"]);
				assert.strictEqual(parsed.result.exceptionDays, undefined);
			});
		});

		bdd.it("works out the day of a cancelled occurrence given in UTC", function () {
			var body = zoned("Australia/Sydney", "20260713", "0800") + "RRULE:FREQ=DAILY;COUNT=9\r\nEXDATE:20260713T220000Z\r\n";
			return parse(calendar(vevent(body))).then(function (parsed) {
				assert.deepStrictEqual(parsed.result.exdates, ["20260714"]);
			});
		});

		bdd.it("hides the occurrence a changed one replaces", function () {
			var ical = calendar(vevent(repeat + "RRULE:FREQ=DAILY;COUNT=9\r\n") +
				vevent("RECURRENCE-ID;TZID=America/New_York:20260715T090000\r\n" + zoned("America/New_York", "20260715", "1100")));
			return parse(ical).then(function (parsed) {
				assert.strictEqual(parsed.hasExceptions, true);
				assert.deepStrictEqual(parsed.result.exdates, ["20260715"]);
				assert.strictEqual(clock(parsed.exceptions[0].dtstart), "15/7 17:00");
				assert.strictEqual(parsed.exceptions[0].exceptionDays, undefined);
			});
		});

		bdd.it("keeps the last occurrence of an UNTIL repeat", function () {
			var body = repeat + "RRULE:FREQ=DAILY;UNTIL=20260720T130000Z\r\n";
			return parse(calendar(vevent(body))).then(function (parsed) {
				assert.ok(parsed.result.rrule.until >= new Date(2026, 6, 20, 23, 59, 59).getTime());
				assert.strictEqual(parsed.result.rrule.untilText, undefined);
			});
		});
	});

	bdd.describe("several events under one UID", function () {
		bdd.it("keeps the first instead of losing them all", function () {
			return parse(calendar(vevent(LOCAL + "SUMMARY:One\r\n") + vevent(LOCAL + "SUMMARY:Two\r\n"))).then(function (parsed) {
				assert.strictEqual(parsed.returnValue, true);
				assert.strictEqual(parsed.result.subject, "One");
				assert.deepStrictEqual(parsed.exceptions, []);
			});
		});

		bdd.it("keeps a changed occurrence that came without its series", function () {
			var one = "RECURRENCE-ID;TZID=Europe/Amsterdam:20260715T090000\r\n" + LOCAL + "SUMMARY:Moved\r\n",
				two = "RECURRENCE-ID;TZID=Europe/Amsterdam:20260716T090000\r\n" + LOCAL + "SUMMARY:Other\r\n";
			return parse(calendar(vevent(one) + vevent(two))).then(function (parsed) {
				assert.strictEqual(parsed.result.subject, "Moved");
				assert.strictEqual(parsed.result.recurrenceId, undefined);
			});
		});
	});

	bdd.it("writes all-day exceptions as valid iCal", function () {
		var event = {subject: "A", allDay: true, dtstart: new Date(2026, 6, 15, 12).getTime(), dtend: new Date(2026, 6, 15, 12, 0, 1).getTime(),
			tzId: "Europe/Amsterdam", uid: "u", rrule: {freq: "DAILY", until: new Date(2026, 6, 20, 12).getTime()}, exdates: ["20260716"]};
		return new Promise(function (resolve) {
			var future = iCal.generateICal(event);
			future.then(function () {
				resolve(global.checkResult(future).result);
			});
		}).then(function (text) {
			assert.ok(text.indexOf("EXDATE;VALUE=DATE:20260716\r\n") >= 0, text);
			assert.ok(text.indexOf("RRULE:FREQ=DAILY;UNTIL=20260720") >= 0, text);
			assert.ok(text.indexOf("DTSTART;VALUE=DATE:20260715\r\n") >= 0, text);
		});
	});
});
