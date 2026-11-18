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

function card(uid) {
	return "BEGIN:VCARD\r\nVERSION:3.0\r\n" + (uid ? "UID:" + uid + "\r\n" : "") + "PHOTO;ENCODING=b;TYPE=JPEG:QUJD\r\nEND:VCARD\r\n";
}

function photoFor(uid, name) {
	written = [];
	global.Contacts = {vCardImporter: importing(name)};
	return new Promise(function (resolve) {
		var future = vCard.parseVCard({account: {name: "me", kind: "kind", accountId: "a"}, vCard: card(uid)});
		future.then(function () {
			var result = global.checkResult(future);
			resolve({file: written[0], stored: result.result.photos[0].localPath});
		});
	});
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
