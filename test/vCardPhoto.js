/*
 * Where a contact's photo is stored.
 * Runs under mocha (make test) or "node --test test/vCardPhoto.js".
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
global.Log = {log: quiet, debug: quiet, log_icalDebug: quiet};

var written;
global.httpClient = {
	parseURLIntoOptions: function (url, options) { options.host = require("url").parse(url).hostname; },
	sendRequest: function (options) {
		fetched.push(options);
		return new global.Future(photoAnswer);
	}
};
var fetched = [], photoAnswer;

global.fs = {
	mkdir: function (dir, mode, callback) { callback(); },
	writeFile: function (file, data, callback) {
		written.push(file);
		setImmediate(callback);
	}
};

function importing(name) {
	return function Importer() {
		this.setVCardFileReader = quiet;
		this.readVCard = function () {
			return new global.Future([{
				getDBObject: function () { return {name: name, photos: []}; }
			}]);
		};
	};
}

var vCard = require(utils + "vCard.js");
var Reader = require(utils + "vCardReader.js");

function read(lines, version) {
	var reader = new Reader();
	reader.processString("BEGIN:VCARD\r\nVERSION:" + (version || "3.0") + "\r\n" + lines.join("\r\n") + "\r\nEND:VCARD\r\n", version || "3.0");
	return reader;
}

function allLines(reader) {
	var result = [], line = reader.readLine();
	while (line !== null) {
		result.push(line);
		line = reader.readLine();
	}
	return result;
}

bdd.describe("reading a vCard", function () {
	bdd.it("joins lines folded with a tab or a space", function () {
		var lines = allLines(read(["NOTE:one\r\n\ttwo\r\n three"]));
		assert.ok(lines.indexOf("NOTE:onetwothree") >= 0, lines.join("|"));
	});

	bdd.it("finds fields in any case and in groups", function () {
		var reader = read(["uid:lower", "item1.CATEGORIES:A,B", "fn:Solo Name", "ANNIVERSARY:20100601"]);
		assert.strictEqual(reader.extractUID(), "lower");
		assert.strictEqual(reader.extractCategories(), "A,B");
		assert.strictEqual(reader.extractFullName(), "Solo Name");
		assert.strictEqual(reader.extractAnniversary(), "2010-06-01");
	});

	[["--04-12", "1900-04-12"], ["--0412", "1900-04-12"], ["19850412", "1985-04-12"], ["1985-04-12T00:00:00Z", "1985-04-12"], ["19850412T1030", "1985-04-12"]].forEach(function (c) {
		bdd.it("reads the birthday " + c[0], function () {
			assert.ok(allLines(read(["BDAY:" + c[0]])).indexOf("BDAY:" + c[1]) >= 0);
		});
	});

	bdd.it("removes the uri form of a phone number", function () {
		var lines = allLines(read(["TEL;VALUE=uri;TYPE=\"voice,home\":tel:+31-6-1;ext=5"], "4.0"));
		assert.ok(lines.indexOf("TEL;VALUE=uri;TYPE=\"voice,home\":+31-6-1 x5") >= 0, lines.join("|"));
	});

	[
		["PHOTO;ENCODING=b;TYPE=JPEG:QUJD", "QUJD", ".jpeg", undefined],
		["item1.PHOTO;ENCODING=b;TYPE=PNG:QUJD", "QUJD", ".png", undefined],
		["PHOTO:data:image/png;base64,QUJD", "QUJD", ".png", undefined],
		["PHOTO;VALUE=uri:https://example.org/p.jpg", "", ".jpeg", "https://example.org/p.jpg"],
		["PHOTO:https://example.org/p.jpg", "", ".jpeg", "https://example.org/p.jpg"],
		["PHOTO:cid:part1", "", ".jpeg", undefined]
	].forEach(function (c) {
		bdd.it("reads " + c[0].substr(0, 26), function () {
			var photo = read([c[0]]).extractPhoto();
			assert.strictEqual(photo.photoData, c[1]);
			assert.strictEqual(photo.photoType, c[2]);
			assert.strictEqual(photo.photoUrl, c[3]);
		});
	});
});

function card(uid) {
	return "BEGIN:VCARD\r\nVERSION:3.0\r\n" + (uid ? "UID:" + uid + "\r\n" : "") + "PHOTO;ENCODING=b;TYPE=JPEG:QUJD\r\nEND:VCARD\r\n";
}

function parsed(text, name) {
	written = [];
	global.Contacts = {vCardImporter: importing(name)};
	return new Promise(function (resolve) {
		var future = vCard.parseVCard({account: {name: "me", kind: "kind", accountId: "a"}, vCard: text});
		future.then(function () {
			resolve(global.checkResult(future).result);
		});
	});
}

function photoFor(uid, name) {
	return parsed(card(uid), name).then(function (result) {
		return {file: written[0], stored: result.photos[0].localPath};
	});
}

var NO_NAME = {givenName: "", familyName: ""};
function linked(url) {
	return "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:u\r\nPHOTO;VALUE=uri:" + url + "\r\nEND:VCARD\r\n";
}

bdd.describe("contact photos", function () {
	bdd.it("stays in one file when the contact is renamed", function () {
		return photoFor("id-1", {givenName: "Ann", familyName: "Old"}).then(function (before) {
			assert.strictEqual(before.stored, before.file);
			return photoFor("id-1", {givenName: "Ann", familyName: "New"}).then(function (after) {
				assert.strictEqual(after.file, before.file);
			});
		});
	});

	bdd.it("downloads a photo given as a link, without credentials", function () {
		fetched = [];
		photoAnswer = {returnValue: true, headers: {"content-type": "image/png"}, body: Buffer.from("x")};
		return parsed(linked("https://example.org/p"), NO_NAME).then(function (result) {
			assert.strictEqual(result.photos.length, 3);
			assert.ok(/\.png$/.test(written[0]), written[0]);
			assert.strictEqual(fetched[0].headers.Authorization, undefined);
		});
	});

	[["a web page", {returnValue: true, headers: {"content-type": "text/html"}, body: Buffer.from("x")}],
		["a failure", {returnValue: false, returnCode: 404, headers: {}}]].forEach(function (c) {
		bdd.it("ignores " + c[0] + " instead of a photo", function () {
			photoAnswer = c[1];
			return parsed(linked("https://example.org/p"), NO_NAME).then(function (result) {
				assert.deepStrictEqual(result.photos, []);
				assert.deepStrictEqual(written, []);
			});
		});
	});

	bdd.it("limits where a photo may come from and how large it is", function () {
		fetched = [];
		photoAnswer = {returnValue: false, headers: {}};
		return parsed(linked("https://example.org/p"), NO_NAME).then(function () {
			assert.strictEqual(fetched[0].publicOnly, true);
			assert.strictEqual(fetched[0].maxBytes, 2097152);
		});
	});

	bdd.it("uses the full name when there is no other", function () {
		var text = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Solo Name\r\nN:;;;;\r\nANNIVERSARY:2010-06-01\r\nEND:VCARD\r\n";
		return parsed(text, {givenName: "", familyName: ""}).then(function (result) {
			assert.strictEqual(result.name.givenName, "Solo Name");
			assert.strictEqual(result.anniversary, "2010-06-01");
		});
	});

	bdd.it("gives two people with one name their own files", function () {
		var name = {givenName: "Ann", familyName: "Lee"};
		return photoFor("id-1", name).then(function (first) {
			return photoFor("id-2", name).then(function (second) {
				assert.notStrictEqual(first.file, second.file);
			});
		});
	});

	bdd.it("keeps every file directly in the photo folder", function () {
		var file = vCard.photoFileName("a/b", "../../uid", {givenName: "x", familyName: "y"}, ".jpeg");
		assert.ok(/^\/media\/internal\/\.caldav_photos\/[0-9a-f]{32}\.jpeg$/.test(file), file);
	});

	bdd.it("falls back on the name without a UID", function () {
		var one = vCard.photoFileName("me", undefined, {givenName: "Ann", familyName: "Lee"}, ".jpeg"),
			two = vCard.photoFileName("me", undefined, {givenName: "Bob", familyName: "Lee"}, ".jpeg");
		assert.notStrictEqual(one, two);
	});
});
