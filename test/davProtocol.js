/*
 * What the service does with answers from a server: real HTTP against a small
 * server on this machine, through httpClient, CalDav and ETag.
 * Runs under mocha (make test) or "node --test test/davProtocol.js".
 */
/*jslint node: true */
"use strict";

var assert = require("assert");
var http = require("http");
var path = require("path");

var bdd = typeof describe === "function" ? {describe: describe, it: it, before: before, after: after} : require("node:test");
var root = path.join(__dirname, "..");
var utils = path.join(root, "service", "javascript", "utils") + path.sep;

function quiet() {
	return undefined;
}

global.Future = require(path.join(root, "test-scripts", "foundations", "future"));
global.xml = require(path.join(root, "test-scripts", "foundations", "xml.js"));
global.checkResult = require(utils + "checkResult.js");
global.libPath = utils;
global.Log = {log: quiet, debug: quiet, log_icalDebug: quiet, log_httpClient: quiet, log_calDavDebug: quiet,
	log_calDavParsingDebug: quiet, printObj: function () { return ""; }};
global.UrlSchemes = {resolveURL: quiet};
global.Kinds = require(path.join(root, "service", "javascript", "kinds.js")).Kinds;
global.httpClient = require(utils + "httpClient.js");

var CalDav = require(utils + "CalDav.js");
var ETag = require(utils + "ETag.js");

var routes, seen, main, other, PORT, OTHER;
var AUTH = {authToken: "Basic dGVzdA=="};

function multistatus(inner) {
	return "<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\" " +
		"xmlns:cs=\"http://calendarserver.org/ns/\">" + inner + "</d:multistatus>";
}
function found(prop) {
	return "<d:propstat><d:prop>" + prop + "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>";
}
function missing(prop) {
	return "<d:propstat><d:prop>" + prop + "</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>";
}
function response(href, body) {
	return "<d:response><d:href>" + href + "</d:href>" + body + "</d:response>";
}
function etag(value) {
	return "<d:getetag>\"" + value + "\"</d:getetag>";
}
var COLLECTION = "<d:resourcetype><d:collection/></d:resourcetype>";

function handler(tag) {
	return function (req, res) {
		var body = "";
		req.on("data", function (d) { body += d; });
		req.on("end", function () {
			var route = routes[req.url], answer;
			seen.push({server: tag, url: req.url, method: req.method, headers: req.headers, body: body});
			answer = typeof route === "function" ? route(req, body) : route || {code: 404};
			res.writeHead(answer.code, answer.headers || {"content-type": "text/xml"});
			res.end(answer.body || "");
		});
	};
}

function done(future) {
	return new Promise(function (resolve) {
		future.then(function (f) {
			resolve(global.checkResult(f));
		});
	});
}
function url(p, port) {
	return "http://127.0.0.1:" + (port || PORT) + p;
}
function params(p, extra) {
	return Object.assign({path: url(p), userAuth: AUTH}, extra || {});
}
function ask(p) {
	return done(CalDav.checkCredentials(params(p)));
}
function deletions(listing) {
	var folders = {forEachFolder: function (kind, cb) { cb({collectionId: "C"}); }},
		local = ["/c/0", "/c/1", "/c/2"].map(function (uri, i) {
			return {_id: "l" + i, remoteId: uri, uri: uri, etag: "\"e" + i + "\"", calendarId: "C"};
		});
	listing.forEach(function (entry) { entry.remoteId = entry.uri; });
	return ETag.parseEtags(listing, local, "C", folders).filter(function (entry) { return entry.doDelete; }).length;
}

bdd.describe("talking to a DAV server", function () {
	bdd.before(function () {
		return new Promise(function (resolve) {
			main = http.createServer(handler("main")).listen(0, "127.0.0.1", function () {
				PORT = main.address().port;
				other = http.createServer(handler("other")).listen(0, "127.0.0.1", function () {
					OTHER = other.address().port;
					resolve();
				});
			});
		});
	});
	bdd.after(function () {
		main.close();
		other.close();
	});

	function fresh(r) {
		routes = r;
		seen = [];
	}

	bdd.describe("object listings", function () {
		[
			["a web page", 200, "<html><body>Log in</body></html>"],
			["other XML", 200, "<?xml version=\"1.0\"?><error/>"],
			["an empty answer", 200, ""]
		].forEach(function (c) {
			[true, false].forEach(function (cardDav) {
				bdd.it("fails on " + c[0] + (cardDav ? " for contacts" : " for calendars"), function () {
					fresh({"/c/": {code: c[1], body: c[2]}});
					return done(CalDav.downloadEtags(params("/c/", {cardDav: cardDav}))).then(function (result) {
						assert.strictEqual(result.returnValue, false);
					});
				});
			});
		});

		bdd.it("fails when a PROPFIND does not even list the collection", function () {
			fresh({"/c/": {code: 207, body: multistatus("")}});
			return done(CalDav.downloadEtags(params("/c/", {cardDav: true}))).then(function (result) {
				assert.strictEqual(result.returnValue, false);
			});
		});

		bdd.it("accepts an empty calendar query, a calendar can be empty", function () {
			fresh({"/c/": {code: 207, body: multistatus("")}});
			return done(CalDav.downloadEtags(params("/c/"))).then(function (result) {
				assert.deepStrictEqual(result, {returnValue: true, etags: []});
			});
		});

		bdd.it("fails when the server says it cut the list short", function () {
			var body = multistatus(response("/c/0", found(etag("e0"))) +
				"<d:response><d:href>/c/</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response>");
			fresh({"/c/": {code: 207, body: body}});
			return done(CalDav.downloadEtags(params("/c/", {cardDav: true}))).then(function (result) {
				assert.strictEqual(result.returnValue, false);
			});
		});

		bdd.it("lists each object once and leaves collections out", function () {
			fresh({"/c/": {code: 207, body: multistatus(
				response("/c/", found(etag("self"))) +
					response("/c/sub/", found(COLLECTION + etag("sub"))) +
					response("/c/0", found(etag("e0")) + missing("<d:displayname/>")) +
					response("/c/gone", missing(etag("stale"))) +
					response("/c/1", found(etag("e1")))
			)}});
			return done(CalDav.downloadEtags(params("/c/", {cardDav: true}))).then(function (result) {
				assert.deepStrictEqual(result.etags.map(function (e) { return e.uri; }), ["/c/0", "/c/1"]);
				assert.strictEqual(deletions(result.etags), 1);
			});
		});
	});

	bdd.describe("change detection", function () {
		bdd.it("does not trust an unchanged etag of the collection", function () {
			fresh({"/c/": {code: 207, body: multistatus(response("/c/", found(etag("same"))))}});
			return done(CalDav.checkForChanges(params("/c/", {ctag: "\"same\""}))).then(function (result) {
				assert.strictEqual(result.needsUpdate, true);
				assert.strictEqual(result.ctag, false);
			});
		});

		bdd.it("uses the sync token when there is no ctag", function () {
			fresh({"/c/": {code: 207, body: multistatus(response("/c/", found("<d:sync-token>t1</d:sync-token>")))}});
			return done(CalDav.checkForChanges(params("/c/", {ctag: "t1"}))).then(function (result) {
				assert.strictEqual(result.needsUpdate, false);
				assert.strictEqual(result.syncToken, "t1");
			});
		});
	});

	bdd.describe("folders", function () {
		var CALENDAR = "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>";

		bdd.it("keeps a % in a calendar name", function () {
			fresh({"/h/": {code: 207, body: multistatus(response("/h/a/", found(CALENDAR + "<d:displayname>100% work</d:displayname>")))}});
			return done(CalDav.getFolders(params("/h/"))).then(function (result) {
				assert.strictEqual(result.folders[0].name, "100% work");
			});
		});

		bdd.it("fails on a web page instead of reporting no folders", function () {
			fresh({"/h/": {code: 200, body: "<html></html>"}});
			return done(CalDav.getFolders(params("/h/"))).then(function (result) {
				assert.strictEqual(result.returnValue, false);
			});
		});

		bdd.it("uses every home the server names", function () {
			var folder = function (href, name) {
				return {code: 207, body: multistatus(response(href, found(CALENDAR + "<d:displayname>" + name + "</d:displayname>")))};
			};
			fresh({
				"/d/": function (req, body) {
					if (body.indexOf("current-user-principal") >= 0) {
						return {code: 207, body: multistatus(response("/d/", found("<d:current-user-principal><d:href>/p/</d:href></d:current-user-principal>")))};
					}
					return {code: 404};
				},
				"/p/": function (req, body) {
					if (body.indexOf("calendar-home-set") >= 0) {
						return {code: 207, body: multistatus(response("/p/", found("<c:calendar-home-set><d:href>/h1/</d:href><d:href>/h2/</d:href></c:calendar-home-set>")))};
					}
					return {code: 207, body: multistatus(response("/p/", missing("<x/>")))};
				},
				"/h1/": folder("/h1/a/", "One"),
				"/h2/": folder("/h2/b/", "Two")
			});
			return done(CalDav.discovery(params("/d/", {originalUrl: url("/d/")}))).then(function (result) {
				assert.strictEqual(result.calendarHome, url("/h1/"));
				assert.strictEqual(result.calendarHomes.length, 2);
				assert.deepStrictEqual(result.folders.map(function (f) { return f.name; }).sort(), ["One", "Two"]);
			});
		});

		bdd.it("does not report folders when one of several homes fails", function () {
			fresh({"/h1/": {code: 207, body: multistatus(response("/h1/a/", found(CALENDAR)))}, "/h2/": {code: 404}});
			return done(CalDav.getFoldersOfHomes(params("/h1/"), [url("/h1/"), url("/h2/")], "calendar")).then(function (result) {
				assert.strictEqual(result.returnValue, false);
			});
		});
	});

	bdd.describe("redirects", function () {
		var OK = {code: 207, body: multistatus("")};

		function moved(location, code) {
			return {code: code || 302, headers: {location: location}};
		}

		[301, 302, 307, 308].forEach(function (code) {
			bdd.it("follows " + code + " with the same method and credentials", function () {
				fresh({"/a": moved("/b", code), "/b": OK});
				return ask("/a").then(function (result) {
					assert.strictEqual(result.returnCode, 207);
					assert.strictEqual(seen[1].method, "PROPFIND");
					assert.strictEqual(seen[1].headers.authorization, AUTH.authToken);
				});
			});
		});

		bdd.it("understands a relative location", function () {
			fresh({"/x/a": moved("b"), "/x/b": OK});
			return ask("/x/a").then(function (result) {
				assert.strictEqual(result.returnCode, 207);
			});
		});

		bdd.it("does not hand credentials to another address", function () {
			fresh({"/a": function () { return moved(url("/b", OTHER)); }, "/b": OK});
			return ask("/a").then(function (result) {
				assert.strictEqual(result.returnCode, 207);
				assert.strictEqual(seen[1].server, "other");
				assert.strictEqual(seen[1].headers.authorization, undefined);
			});
		});

		bdd.it("gives up on a redirect loop", function () {
			fresh({"/a": moved("/b"), "/b": moved("/a")});
			return ask("/a").then(function (result) {
				assert.strictEqual(result.returnValue, false);
				assert.ok(seen.length <= 11, String(seen.length));
			});
		});

		bdd.it("fails on a redirect without a location", function () {
			fresh({"/a": {code: 301}});
			return ask("/a").then(function (result) {
				assert.strictEqual(result.returnValue, false);
				assert.strictEqual(seen.length, 1);
			});
		});
	});

	bdd.describe("requests", function () {
		bdd.it("names a non-default port in the Host header", function () {
			fresh({"/a": {code: 207, body: multistatus("")}});
			return ask("/a").then(function () {
				assert.strictEqual(seen[0].headers.host, "127.0.0.1:" + PORT);
			});
		});

		bdd.it("waits as long as the server asks and tries again", function () {
			var calls = 0;
			fresh({"/a": function () {
				calls += 1;
				return calls === 1 ? {code: 429, headers: {"retry-after": "0"}} : {code: 207, body: multistatus("")};
			}});
			return ask("/a").then(function (result) {
				assert.strictEqual(result.returnCode, 207);
				assert.strictEqual(calls, 2);
			});
		});

		bdd.it("stops waiting for a server that keeps refusing", function () {
			fresh({"/a": {code: 429, headers: {"retry-after": "0"}}});
			return ask("/a").then(function (result) {
				assert.strictEqual(result.returnCode, 429);
				assert.strictEqual(seen.length, 3);
			});
		});

		bdd.it("asks for vCard 3 and sends no body type on a download", function () {
			fresh({"/c/1": {code: 200, body: "x"}});
			return done(CalDav.downloadObject(params("/c/", {cardDav: true}), {uri: "/c/1"})).then(function () {
				assert.ok(/version=3\.0/.test(seen[0].headers.accept));
				assert.strictEqual(seen[0].headers["content-type"], undefined);
			});
		});

		bdd.it("does not send a password unencrypted across the internet", function () {
			fresh({});
			return done(CalDav.checkCredentials({path: "http://example.invalid/", userAuth: AUTH})).then(function (result) {
				assert.strictEqual(result.returnValue, false);
				assert.ok(/unencrypted/.test(result.msg), String(result.msg));
				assert.strictEqual(seen.length, 0);
			});
		});

		bdd.it("treats addresses on the local network as local", function () {
			["localhost", "127.0.0.1", "10.1.2.3", "192.168.1.5", "172.20.0.1", "nas", "nas.local"].forEach(function (host) {
				assert.strictEqual(global.httpClient.isLocalHost(host), true, host);
			});
			["example.org", "8.8.8.8", "172.32.0.1"].forEach(function (host) {
				assert.strictEqual(global.httpClient.isLocalHost(host), false, host);
			});
		});
	});
});
