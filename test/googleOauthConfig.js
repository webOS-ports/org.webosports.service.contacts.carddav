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
   runs the kind's create() with the given launch parameters (default: creating an account) and
   reports what it did. */
function runCreate(fill, params) {
	var source = fs.readFileSync(crossAppTarget, "utf8"),
		kind,
		opened = [],
		started = [],
		errors = [],
		results = [],
		closed = [],
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
			launchParams: JSON.stringify(params || {mode: "create"}),
			deviceInfo: JSON.stringify({modelName: "LuneOS Device"})
		},
		OAuthWindow: {open: function (opts) { opened.push(opts); return {close: function () { closed.push(opts); }}; }}
	};
	context.window = context;
	vm.createContext(context);
	vm.runInContext(source, context, {filename: crossAppTarget});

	instance = Object.create(kind);
	instance.inherited = function () {};
	instance.log = function () {};
	instance.showLoginError = function (msg) { errors.push(msg); };
	instance.$ = {
		googleOAuthStart: {call: function (args) { started.push(args); }},
		signInButton: {
			hidden: false,
			disabled: false,
			hide: function () { this.hidden = true; },
			setDisabled: function (value) { this.disabled = value; }
		},
		alert: {hide: function () {}},
		doneButton: {disabled: false, setDisabled: function (value) { this.disabled = value; }},
		crossAppResult: {sendResult: function (r) { results.push(r); }},
		removeAccountButton: {
			showing: false,
			inits: [],
			init: function (account, capability) { this.inits.push({account: account, capability: capability}); },
			show: function () { this.showing = true; }
		}
	};
	instance.create();
	return {instance: instance, started: started, opened: opened, errors: errors, results: results, closed: closed};
}

bdd.describe("Google OAuth client configuration", function () {
	bdd.it("does not start sign-in without a client from the build", function () {
		var r = runCreate(null);
		assert.deepStrictEqual(r.started, []);
		assert.strictEqual(r.errors.length, 1);
		assert.strictEqual(r.instance.$.signInButton.hidden, true);
	});

	bdd.it("does not start sign-in when only one of id and secret is set", function () {
		assert.deepStrictEqual(runCreate({id: "id.apps.googleusercontent.com", secret: ""}).started, []);
		assert.deepStrictEqual(runCreate({id: "", secret: "s3cret"}).started, []);
	});

	bdd.it("signs in with the client id the build fills in", function () {
		var r = runCreate({id: "test-id.apps.googleusercontent.com", secret: "test-secret"});
		assert.deepStrictEqual(r.errors, []);
		assert.deepStrictEqual(r.started, []);
		assert.deepStrictEqual(r.opened, []);
		r.instance.startSignIn();
		assert.strictEqual(r.instance.$.signInButton.disabled, true);
		assert.strictEqual(r.started.length, 1);
		assert.strictEqual(r.started[0].clientId, "test-id.apps.googleusercontent.com");
		r.instance.signInReady({}, {url: "https://accounts.example/", redirectUri: "http://localhost/cb", state: "s"});
		assert.strictEqual(r.opened.length, 1);
		assert.strictEqual(r.opened[0].url, "https://accounts.example/");
		assert.strictEqual(r.opened[0].redirectPrefix, "http://localhost/cb");;
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

bdd.describe("Google sign-in screen: removing the account", function () {
	var CLIENT = {id: "test-id.apps.googleusercontent.com", secret: "test-secret"},
		ACCOUNT = {_id: "acc1", templateId: "org.webosports.cdav.account.google",
			capabilityProviders: [{id: "org.webosports.cdav.contact", capability: "CONTACTS", _id: "c1"}]};

	function withError() {
		var a = JSON.parse(JSON.stringify(ACCOUNT));
		a.credentialError = true;
		return a;
	}

	bdd.it("offers Remove for an account with a credentials error, for the whole account", function () {
		var b = runCreate(CLIENT, {mode: "modify", account: withError()}).instance.$.removeAccountButton;
		assert.strictEqual(b.showing, true);
		assert.strictEqual(b.inits.length, 1);
		assert.strictEqual(b.inits[0].account._id, "acc1");
		assert.strictEqual(b.inits[0].capability, undefined);
	});

	bdd.it("offers Remove when opened from Contacts or Calendar, for that capability", function () {
		var b = runCreate(CLIENT, {mode: "modify", account: ACCOUNT, capability: "CONTACTS"}).instance.$.removeAccountButton;
		assert.strictEqual(b.showing, true);
		assert.strictEqual(b.inits[0].capability, "CONTACTS");
	});

	bdd.it("does not offer Remove for Change Login from the account's own settings screen", function () {
		var b = runCreate(CLIENT, {mode: "modify", account: ACCOUNT}).instance.$.removeAccountButton;
		assert.strictEqual(b.showing, false);
		assert.deepStrictEqual(b.inits, []);
	});

	bdd.it("does not offer Remove while creating an account", function () {
		var b = runCreate(CLIENT, {mode: "create", capability: "CONTACTS"}).instance.$.removeAccountButton;
		assert.strictEqual(b.showing, false);
		assert.deepStrictEqual(b.inits, []);
	});

	bdd.it("offers Remove in a build without a Google client", function () {
		var r = runCreate(null, {mode: "modify", account: withError()});
		assert.strictEqual(r.instance.$.signInButton.hidden, true);
		assert.strictEqual(r.instance.$.removeAccountButton.showing, true);
		assert.strictEqual(r.instance.$.removeAccountButton.inits.length, 1);
	});

	bdd.it("stops sign-in while removing and returns to the caller when removed", function () {
		var r = runCreate(CLIENT, {mode: "modify", account: withError()}),
			i = r.instance;
		i.startSignIn();
		i.signInReady({}, {url: "https://accounts.example/", redirectUri: "http://localhost/cb", state: "s"});
		i.removingAccount();
		assert.strictEqual(r.closed.length, 1);
		assert.strictEqual(i.$.signInButton.disabled, true);
		assert.strictEqual(i.$.doneButton.disabled, true);
		assert.deepStrictEqual(r.results, []);
		i.accountRemoved();
		assert.strictEqual(JSON.stringify(r.results), JSON.stringify([{returnValue: false}]));
	});
});
