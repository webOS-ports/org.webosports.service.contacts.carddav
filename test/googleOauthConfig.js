/*
 * The Google OAuth client id and secret come from the build, not the repository:
 * app-enyo/GoogleOauth/CrossAppTarget.js carries placeholders that meta-luneos'
 * org.webosports.cdav.bb fills in. Runs under mocha (make test) or plain
 * "node --test test/googleOauthConfig.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");

var root = path.join(__dirname, "..");
var crossAppTarget = path.join(root, "app-enyo", "GoogleOauth", "CrossAppTarget.js");

/* Loads CrossAppTarget.js with the placeholders replaced as the build does (null: left as they are),
   runs the kind's create() and reports what it did. */
function runCreate(fill) {
	var source = fs.readFileSync(crossAppTarget, "utf8"),
		kind,
		opened = [],
		errors = [],
		instance,
		context;

	if (fill) {
		source = source.split("\"PLACEHOLDER_GOOGLE_CDAV_CLIENT_ID\"").join(JSON.stringify(fill.id));
		source = source.split("\"PLACEHOLDER_GOOGLE_CDAV_CLIENT_SECRET\"").join(JSON.stringify(fill.secret));
	}
	context = {
		console: {error: function () {}},
		setTimeout: setTimeout,
		$L: function (s) { return s; },
		enyo: {kind: function (k) { kind = k; }},
		PalmSystem: {
			launchParams: JSON.stringify({mode: "create"}),
			deviceInfo: JSON.stringify({modelName: "LuneOS Device"})
		},
		navigator: {InAppBrowser: {open: function (url) { opened.push(url); }}}
	};
	context.window = context;
	vm.createContext(context);
	vm.runInContext(source, context, {filename: crossAppTarget});

	instance = Object.create(kind);
	instance.inherited = function () {};
	instance.log = function () {};
	instance.showLoginError = function (msg) { errors.push(msg); };
	instance.create();
	return {opened: opened, errors: errors};
}

bdd.describe("Google OAuth client configuration", function () {
	bdd.it("does not start sign-in without a client from the build", function () {
		var r = runCreate(null);
		assert.deepStrictEqual(r.opened, []);
		assert.strictEqual(r.errors.length, 1);
	});

	bdd.it("does not start sign-in when only one of id and secret is set", function () {
		assert.deepStrictEqual(runCreate({id: "id.apps.googleusercontent.com", secret: ""}).opened, []);
		assert.deepStrictEqual(runCreate({id: "", secret: "s3cret"}).opened, []);
	});

	bdd.it("signs in with the client id the build fills in", function () {
		var r = runCreate({id: "test-id.apps.googleusercontent.com", secret: "test-secret"});
		assert.deepStrictEqual(r.errors, []);
		assert.strictEqual(r.opened.length, 1);
		assert.strictEqual(new URL(r.opened[0]).searchParams.get("client_id"), "test-id.apps.googleusercontent.com");
	});

	bdd.it("keeps no client id or secret in the sources", function () {
		var found = [];
		function walk(dir) {
			fs.readdirSync(dir, {withFileTypes: true}).forEach(function (entry) {
				var full = path.join(dir, entry.name), text, re, m;
				if (entry.isDirectory()) {
					if (entry.name !== "node_modules" && entry.name !== ".git") {
						walk(full);
					}
					return;
				}
				if (!/\.js$/.test(entry.name) || full === __filename) {
					return;
				}
				text = fs.readFileSync(full, "utf8");
				re = /\bCLIENT_(ID|SECRET)\s*=\s*"([^"]*)"/g;
				while ((m = re.exec(text)) !== null) {
					if (m[2].indexOf("PLACEHOLDER_") !== 0) {
						found.push(path.relative(root, full) + ": CLIENT_" + m[1]);
					}
				}
				if (/GOCSPX-|\.apps\.googleusercontent\.com"/.test(text)) {
					found.push(path.relative(root, full) + ": Google client literal");
				}
			});
		}
		["app-enyo", "app", "service", "accounts-google", "accounts-google-mojo"].forEach(function (d) {
			if (fs.existsSync(path.join(root, d))) {
				walk(path.join(root, d));
			}
		});
		assert.deepStrictEqual(found, []);
	});
});
