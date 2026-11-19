/*
 * What is sent to a server: only what webOS can edit changes there.
 * Runs under mocha (make test) or "node --test test/objectMerge.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var path = require("path");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");
var root = path.join(__dirname, "..");
var utils = path.join(root, "service", "javascript", "utils") + path.sep;

global.libPath = utils;
global.Kinds = require(path.join(root, "service", "javascript", "kinds.js")).Kinds;
var Merge = require(utils + "ObjectMerge.js");

function cal(body) {
	return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:server\r\nX-WR-CALNAME:Mine\r\n" + body + "END:VCALENDAR\r\n";
}
var SERVER = cal("BEGIN:VEVENT\r\nUID:u\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Old\r\nDESCRIPTION:Long\r\n text\r\nDTSTART:20260701T090000Z\r\nDURATION:PT1H\r\n" +
	"ATTENDEE;CN=Someone:mailto:a@example.org\r\nX-CUSTOM:keep\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Alarm text\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT\r\n" +
	"BEGIN:VEVENT\r\nUID:u\r\nRECURRENCE-ID:20260702T090000Z\r\nSUMMARY:Moved\r\nDTSTART:20260702T100000Z\r\nX-OTHER:stay\r\nEND:VEVENT\r\n");

function has(text, line) {
	return text.split("\r\n").indexOf(line) >= 0;
}

bdd.describe("sending changes", function () {
	bdd.describe("who may", function () {
		var OK = {twoWay: true, url: "https://dav.example.org/"};

		bdd.it("needs the user's choice", function () {
			assert.strictEqual(Merge.uploadAllowed(OK, "calendarevent"), true);
			assert.strictEqual(Merge.uploadAllowed(OK, "contact"), true);
			assert.strictEqual(Merge.uploadAllowed(OK, "task"), true);
			assert.strictEqual(Merge.uploadAllowed({url: OK.url}, "contact"), false);
			assert.strictEqual(Merge.uploadAllowed({twoWay: "yes", url: OK.url}, "contact"), false);
		});

		bdd.it("does not send collections", function () {
			assert.strictEqual(Merge.uploadAllowed(OK, "calendar"), false);
			assert.strictEqual(Merge.uploadAllowed(OK, "nonsense"), false);
		});

		[{urlScheme: "google"}, {oauth: {}}, {url: "https://apidata.googleusercontent.com/caldav/v2/"}, {url: "https://www.google.com/calendar/dav/"}].forEach(function (c) {
			bdd.it("never writes to Google " + JSON.stringify(c), function () {
				assert.strictEqual(Merge.uploadAllowed(Object.assign({twoWay: true}, c), "calendarevent"), false);
			});
		});
	});

	bdd.describe("the stored choice", function () {
		[[{returnValue: true, config: {twoWay: true}}, true], [{returnValue: true, config: {twoWay: false}}, false],
			[{returnValue: true, config: {}}, false], [{returnValue: false, config: {twoWay: true}}, false], [undefined, false]].forEach(function (c) {
			bdd.it("gives " + c[1] + " for " + JSON.stringify(c[0]), function () {
				var config = {twoWay: !c[1]};
				Merge.refreshUploadChoice(config, c[0]);
				assert.strictEqual(config.twoWay, c[1]);
			});
		});
	});

	bdd.describe("the upload checkpoint", function () {
		var stored = {returnValue: true, config: {_rev: 500}};

		bdd.it("starts from when uploads were switched on", function () {
			var transport = {modnum: 100};
			assert.strictEqual(Merge.moveUploadCheckpoint(transport, stored, true), true);
			assert.deepStrictEqual(transport, {modnum: 500, uploadsOn: true});
		});

		bdd.it("stays where it is afterwards, so later edits are sent", function () {
			var transport = {modnum: 100, uploadsOn: true};
			assert.strictEqual(Merge.moveUploadCheckpoint(transport, stored, true), false);
			assert.strictEqual(transport.modnum, 100);
		});

		bdd.it("never moves backwards", function () {
			var transport = {modnum: 900};
			Merge.moveUploadCheckpoint(transport, stored, true);
			assert.strictEqual(transport.modnum, 900);
		});

		bdd.it("does not move while uploads are off", function () {
			var transport = {modnum: 100};
			assert.strictEqual(Merge.moveUploadCheckpoint(transport, stored, false), false);
			assert.deepStrictEqual(transport, {modnum: 100});
		});

		bdd.it("moves again when uploads are switched off and on", function () {
			var transport = {modnum: 100, uploadsOn: true};
			assert.strictEqual(Merge.moveUploadCheckpoint(transport, stored, false), true);
			assert.strictEqual(transport.uploadsOn, false);
			assert.strictEqual(Merge.moveUploadCheckpoint(transport, stored, true), true);
			assert.strictEqual(transport.modnum, 500);
		});
	});

	bdd.describe("events", function () {
		var GENERATED = cal("BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:New\r\nDTSTART:20260701T100000Z\r\nDTEND:20260701T110000Z\r\nEND:VEVENT\r\n");

		bdd.it("changes what can be edited", function () {
			var merged = Merge.mergeEvent(SERVER, GENERATED);
			assert.ok(has(merged, "SUMMARY:New"));
			assert.ok(has(merged, "DTSTART:20260701T100000Z"));
			assert.ok(has(merged, "DTEND:20260701T110000Z"));
			assert.ok(!has(merged, "SUMMARY:Old"));
			assert.ok(!has(merged, "DURATION:PT1H"), "an end replaces the duration");
			assert.ok(!/Longtext/.test(merged), "a removed description goes");
		});

		bdd.it("keeps everything else", function () {
			var merged = Merge.mergeEvent(SERVER, GENERATED);
			["ATTENDEE;CN=Someone:mailto:a@example.org", "X-CUSTOM:keep", "TRIGGER:-PT5M", "DESCRIPTION:Alarm text", "X-WR-CALNAME:Mine", "X-OTHER:stay", "SUMMARY:Moved", "DTSTAMP:20260101T000000Z"].forEach(function (line) {
				assert.ok(has(merged, line), line);
			});
		});

		bdd.it("keeps a description only partly stored here", function () {
			var merged = Merge.mergeEvent(SERVER, cal("BEGIN:VEVENT\r\nUID:u\r\nDESCRIPTION:Lo...(truncated)\r\nEND:VEVENT\r\n"));
			assert.ok(has(merged, "DESCRIPTION:Longtext"), merged);
			assert.ok(!/truncated/.test(merged));
		});

		bdd.it("matches changed occurrences", function () {
			var merged = Merge.mergeEvent(SERVER, cal("BEGIN:VEVENT\r\nUID:u\r\nRECURRENCE-ID;TZID=UTC:20260702T090000\r\nSUMMARY:Again\r\nEND:VEVENT\r\n"));
			assert.ok(has(merged, "SUMMARY:Again") && has(merged, "X-OTHER:stay") && has(merged, "SUMMARY:Old"));
		});

		bdd.it("adds a newly changed occurrence", function () {
			var merged = Merge.mergeEvent(SERVER, cal("BEGIN:VEVENT\r\nUID:u\r\nRECURRENCE-ID:20260703T090000Z\r\nSUMMARY:Third\r\nEND:VEVENT\r\n"));
			assert.ok(merged.indexOf("SUMMARY:Third") < merged.indexOf("END:VCALENDAR") && has(merged, "SUMMARY:Third"));
			assert.strictEqual(merged.match(/BEGIN:VEVENT/g).length, 3);
		});

		bdd.it("folds long lines", function () {
			var merged = Merge.mergeEvent(SERVER, cal("BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:" + new Array(200).join("x") + "\r\nEND:VEVENT\r\n"));
			assert.ok(merged.split("\r\n").every(function (line) { return line.length <= 73; }));
		});

		bdd.it("uses the new text when the server has no such component", function () {
			assert.strictEqual(Merge.mergeEvent(cal(""), GENERATED), GENERATED);
		});
	});

	bdd.it("makes new events valid for storing", function () {
		var text = Merge.prepareCalendar("BEGIN:VCALENDAR\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\nSUMMARY:A\r\nBEGIN:VALARM\r\nUID:inner\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:has\r\nDTSTAMP:20200101T000000Z\r\nEND:VEVENT\r\nEND:VCALENDAR", "VEVENT", "new", Date.UTC(2026, 0, 2));
		assert.ok(!/METHOD/.test(text));
		assert.ok(has(text, "UID:new") && has(text, "DTSTAMP:20260102T000000Z"));
		assert.strictEqual(text.match(/DTSTAMP/g).length, 2);
		assert.strictEqual(text.match(/UID:has/g).length, 1);
	});

	bdd.it("changes a task and leaves the rest", function () {
		var merged = Merge.mergeTask(cal("BEGIN:VTODO\r\nUID:t\r\nSUMMARY:Old\r\nSTATUS:NEEDS-ACTION\r\nCATEGORIES:Home\r\nEND:VTODO\r\n"), cal("BEGIN:VTODO\r\nUID:x\r\nSUMMARY:New\r\nSTATUS:COMPLETED\r\nEND:VTODO\r\n"));
		assert.ok(has(merged, "SUMMARY:New") && has(merged, "STATUS:COMPLETED") && has(merged, "CATEGORIES:Home") && has(merged, "UID:t"));
		assert.ok(!has(merged, "STATUS:NEEDS-ACTION") && !has(merged, "UID:x"));
	});

	bdd.describe("contacts", function () {
		var CARD = "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:c\r\nFN:Old\r\nitem1.TEL:1\r\nitem1.X-ABLabel:Work\r\nBDAY:--0412\r\nPHOTO:data:image/png;base64,QUJD\r\nX-X:y\r\nEND:VCARD\r\n";

		bdd.it("changes fields and keeps photo and the rest", function () {
			var merged = Merge.mergeCard(CARD, "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:New\r\nTEL:2\r\nBDAY:1985-04-12\r\nEND:VCARD\r\n");
			["FN:New", "TEL:2", "BDAY:1985-04-12", "VERSION:4.0", "UID:c", "PHOTO:data:image/png;base64,QUJD", "X-X:y"].forEach(function (line) {
				assert.ok(has(merged, line), line);
			});
			assert.ok(!has(merged, "item1.TEL:1") && !has(merged, "FN:Old") && !has(merged, "BDAY:--0412"));
		});

		bdd.it("keeps a birthday without a year", function () {
			var merged = Merge.mergeCard(CARD, "BEGIN:VCARD\r\nFN:Old\r\nBDAY:1900-04-12\r\nEND:VCARD\r\n");
			assert.ok(has(merged, "BDAY:--0412") && !/1900/.test(merged));
		});
	});
});
