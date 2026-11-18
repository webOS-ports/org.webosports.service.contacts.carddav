/*
 * The service's half of the Google sign-in, and how the account page treats the
 * redirect. Runs under mocha (make test) or "node --test test/googleOAuth.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var bdd = typeof describe === "function" ? {describe: describe, it: it} : require("node:test");
var root = path.join(__dirname, "..");

global.Future = require(path.join(root, "test-scripts", "foundations", "future"));
global.checkResult = require(path.join(root, "service", "javascript", "utils", "checkResult.js"));

var answers, requests;
global.httpClient = {
	parseURLIntoOptions: function (url, options) { options.url = url; },
	sendRequest: function (options, data) {
		var future = new global.Future();
		requests.push({options: options, data: data});
		future.result = answers.shift();
		return future;
	}
};
var GoogleOAuth = require(path.join(root, "service", "javascript", "utils", "GoogleOAuth.js"));

function exchange(args) {
	return new Promise(function (resolve) {
		GoogleOAuth.exchange(args).then(function (f) { resolve(f.result); });
	});
}

function reply(code, body) {
	return {returnValue: code < 400, returnCode: code, body: Buffer.from(JSON.stringify(body))};
}

var good = {code: "c/1", codeVerifier: "v", clientId: "id", clientSecret: "secret"};

function page() {
	var file = path.join(root, "app-enyo", "GoogleOauth", "CrossAppTarget.js"), kind, instance, context;
	context = {
		console: {error: function () {}},
		$L: function (s) { return s; },
		enyo: {kind: function (k) { kind = k; }},
		PalmSystem: {}
	};
	context.window = context;
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(file, "utf8"), context, {filename: file});
	instance = Object.create(kind);
	instance.calls = [];
	instance.errors = [];
	instance.signIn = {state: "right", codeVerifier: "verifier"};
	instance.showLoginError = function (msg) { instance.errors.push(msg); };
	instance.$ = {
		pageHeader: {setContent: function () {}},
		googleOAuthExchange: {call: function (args) { instance.calls.push(args); }}
	};
	return instance;
}

bdd.describe("Google sign-in", function () {
	bdd.it("builds an authorize URL with PKCE, offline access and a loopback redirect", function () {
		var r = GoogleOAuth.start({clientId: "id", loginHint: "a@b.c"}), q = new URL(r.url).searchParams;
		assert.strictEqual(q.get("client_id"), "id");
		assert.strictEqual(q.get("redirect_uri"), r.redirectUri);
		assert.ok(r.redirectUri.indexOf("http://localhost/") === 0);
		assert.strictEqual(q.get("state"), r.state);
		assert.strictEqual(q.get("code_challenge_method"), "S256");
		assert.strictEqual(q.get("code_challenge"),
			crypto.createHash("sha256").update(r.codeVerifier).digest("base64url"));
		assert.strictEqual(q.get("access_type"), "offline");
		assert.strictEqual(q.get("prompt"), "consent");
		assert.strictEqual(q.get("login_hint"), "a@b.c");
		assert.ok(q.get("scope").indexOf("auth/carddav") > 0);
	});

	bdd.it("uses a new state and verifier each time", function () {
		var a = GoogleOAuth.start({clientId: "id"}), b = GoogleOAuth.start({clientId: "id"});
		assert.notStrictEqual(a.state, b.state);
		assert.notStrictEqual(a.codeVerifier, b.codeVerifier);
	});

	bdd.it("refuses to start without a client", function () {
		assert.strictEqual(GoogleOAuth.start({}).returnValue, false);
	});

	bdd.it("exchanges the code and returns the tokens with the email", async function () {
		var r, sent;
		requests = [];
		answers = [reply(200, {access_token: "at", refresh_token: "rt", token_type: "Bearer", expires_in: 3599}),
			reply(200, {email: "a@b.c"})];
		r = await exchange(good);
		sent = new URLSearchParams(requests[0].data);
		assert.strictEqual(sent.get("grant_type"), "authorization_code");
		assert.strictEqual(sent.get("code"), "c/1");
		assert.strictEqual(sent.get("code_verifier"), "v");
		assert.strictEqual(sent.get("client_secret"), "secret");
		assert.strictEqual(sent.get("redirect_uri"), GoogleOAuth.redirectUri);
		assert.strictEqual(requests[1].options.headers.Authorization, "Bearer at");
		assert.strictEqual(r.returnValue, true);
		assert.strictEqual(r.refresh_token, "rt");
		assert.strictEqual(r.email, "a@b.c");
		assert.ok(/^https:/.test(r.refresh_url));
	});

	bdd.it("returns only the OAuth error code when the exchange fails", async function () {
		var r;
		requests = [];
		answers = [reply(400, {error: "invalid_grant", error_description: "details"})];
		r = await exchange(good);
		assert.deepStrictEqual(r, {returnValue: false, error: "invalid_grant"});
		assert.strictEqual(requests.length, 1);
	});

	bdd.it("fails when the user info cannot be read", async function () {
		answers = [reply(200, {access_token: "at"}), reply(401, {})];
		requests = [];
		assert.deepStrictEqual(await exchange(good), {returnValue: false, error: "userinfo_failed"});
	});

	bdd.it("does not call Google with missing parameters", async function () {
		requests = [];
		assert.strictEqual((await exchange({code: "c"})).returnValue, false);
		assert.strictEqual(requests.length, 0);
	});

	bdd.it("exchanges a redirect with the right state", function () {
		var p = page();
		p.gotRedirect("http://localhost/cdav/oauth2callback?state=right&code=a%2Fb&scope=x");
		assert.strictEqual(p.calls.length, 1);
		assert.strictEqual(p.calls[0].code, "a/b");
		assert.strictEqual(p.calls[0].codeVerifier, "verifier");
	});

	bdd.it("ignores a code that comes with the wrong state", function () {
		var p = page();
		p.gotRedirect("http://localhost/cdav/oauth2callback?state=wrong&code=abc");
		assert.strictEqual(p.calls.length, 0);
		assert.strictEqual(p.errors.length, 1);
	});

	bdd.it("reports a refused sign-in", function () {
		var p = page();
		p.gotRedirect("http://localhost/cdav/oauth2callback?state=right&error=access_denied");
		assert.strictEqual(p.calls.length, 0);
		assert.strictEqual(p.errors.length, 1);
	});
});
