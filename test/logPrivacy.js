/*
 * The log must not show what people keep in their calendars and address books.
 * Runs under mocha (make test) or "node --test test/logPrivacy.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var path = require("path");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");
var Log = require(path.join(__dirname, "..", "service", "javascript", "utils", "Log.js"));

function logged() {
	var original = console.error, lines = [];
	console.error = function (line) {
		lines.push(line);
	};
	try {
		Log.log.apply(Log, arguments);
	} finally {
		console.error = original;
	}
	return lines.join("\n");
}

function hides(text, secret) {
	assert.ok(text.indexOf(secret) < 0, secret + " is in: " + text);
}

bdd.describe("what the log shows", function () {
	bdd.it("hides the private fields of an event, nested too", function () {
		var text = logged("Batch: ", [{local: {_id: "id1", subject: "Dentist", location: "Main St", note: "Bring x",
			dtstart: 1234567, rrule: {freq: "DAILY"}, attendees: [{commonName: "Alex"}]}}]);
		["Dentist", "Main St", "Bring x", "1234567", "DAILY", "Alex"].forEach(hides.bind(null, text));
		assert.ok(text.indexOf("id1") >= 0, "the id stays: " + text);
	});

	bdd.it("hides the private fields of a contact", function () {
		var text = logged({name: {givenName: "Sam"}, nickname: "S", phoneNumbers: [{value: "+3161"}],
			addresses: [{city: "Utrecht"}], birthday: "1980-01-02", notes: ["likes tea"]});
		["Sam", "+3161", "Utrecht", "1980-01-02", "likes tea"].forEach(hides.bind(null, text));
	});

	bdd.it("hides them in objects JSON cannot print", function () {
		var o = {subject: "Dentist", ok: 1};
		o.self = o;
		hides(logged(o), "Dentist");
	});

	bdd.it("hides them in text that is already JSON", function () {
		var inner = JSON.stringify({subject: "Dentist", attendees: [{n: "Bo"}, {n: "Alex ] }"}], after: "stays"});
		[logged("x " + inner), logged("x " + JSON.stringify({wrapped: inner}))].forEach(function (text) {
			hides(text, "Dentist");
			hides(text, "Alex");
			assert.ok(text.indexOf("stays") >= 0, "what follows stays: " + text);
		});
	});

	bdd.it("removes a whole calendar or contact", function () {
		[["BEGIN:VCARD\r\nFN:Sam\r\nEND:VCARD\r\nafter", "Sam"], ["BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Dentist\r\nEND:VEVENT\r\nEND:VCALENDAR after", "Dentist"],
			["BEGIN:VTODO\r\nSUMMARY:Buy", "Buy"], ["begin:vcard\nfn:Sam\nend:vcard after", "Sam"]].forEach(function (c) {
			hides(logged(c[0]), c[1]);
		});
		assert.ok(logged("BEGIN:VCARD\nFN:Sam\nEND:VCARD after").indexOf("after") >= 0);
	});

	bdd.it("hides mail addresses, also inside URLs", function () {
		["sam.b+x@example.org", "/caldav/v2/sam.b%40example.org/events/"].forEach(function (s) {
			var text = logged(s);
			hides(text, "sam.b");
			hides(text, "example.org");
		});
	});

	bdd.it("does not print parser detail", function () {
		var original = console.error, called = false;
		console.error = function () {
			called = true;
		};
		try {
			Log.log_icalDebug("Parsing finished, event:", {x: 1});
		} finally {
			console.error = original;
		}
		assert.strictEqual(called, false);
	});

	bdd.it("keeps what is needed to follow a sync", function () {
		var text = logged("Processing change ", 1, " of ", 2, {_id: "a", etag: "e1", uri: "/dav/c/x.ics", returnCode: 412});
		["Processing change 1 of 2", "e1", "/dav/c/x.ics", "412"].forEach(function (s) {
			assert.ok(text.indexOf(s) >= 0, s + " missing: " + text);
		});
	});

	bdd.it("still hides credentials", function () {
		var text = logged({password: "pw1", access_token: "tok1"}, " refresh_token=tok2 Authorization: Bearer abcdefghijkl");
		["pw1", "tok1", "tok2", "abcdefghijkl"].forEach(hides.bind(null, text));
	});
});
