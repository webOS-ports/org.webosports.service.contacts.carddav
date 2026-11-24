/*
 * Account templates: the icons they name exist, and each has the 48x48 one that the
 * sync dashboard ("Removing account...") and the account settings header show.
 * Runs under mocha (make test) or plain "node --test test/accountTemplates.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");

var root = path.join(__dirname, "..");
var dirs = fs.readdirSync(root).filter(function (d) {
	return /^accounts/.test(d) && fs.existsSync(path.join(root, d, "account-template.json"));
});

bdd.describe("account templates", function () {
	bdd.it("are found", function () {
		assert.ok(dirs.length >= 6, dirs.join(", "));
	});

	dirs.forEach(function (dir) {
		var template = JSON.parse(fs.readFileSync(path.join(root, dir, "account-template.json"), "utf8"));

		bdd.it(dir + ": has a 48x48 icon", function () {
			assert.ok(template.icon && template.icon.loc_48x48, "no icon.loc_48x48");
		});

		bdd.it(dir + ": every icon it names exists", function () {
			var missing = Object.keys(template.icon || {}).filter(function (size) {
				return !fs.existsSync(path.join(root, dir, template.icon[size]));
			});
			assert.deepStrictEqual(missing, []);
		});
	});
});
