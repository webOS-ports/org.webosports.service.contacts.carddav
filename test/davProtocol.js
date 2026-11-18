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

	bdd.describe("task lists", function () {
		function calendar(href, comps) {
			return response(href, found("<d:displayname>" + href + "</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>" +
				"<c:supported-calendar-component-set>" + comps.map(function (comp) {
					return "<c:comp name=\"" + comp + "\"/>";
				}).join("") + "</c:supported-calendar-component-set>"));
		}

		bdd.it("finds collections that can hold tasks", function () {
			fresh({"/h/": {code: 207, body: multistatus(calendar("/h/ev/", ["VEVENT"]) + calendar("/h/both/", ["VEVENT", "VTODO"]) + calendar("/h/todo/", ["VTODO"]))}});
			return done(CalDav.getFolders(params("/h/"), "task")).then(function (result) {
				assert.deepStrictEqual(result.folders.map(function (f) { return f.uri.replace(/^.*\/h/, "/h"); }), ["/h/both/", "/h/todo/"]);
				return done(CalDav.getFolders(params("/h/"), "calendar"));
			}).then(function (result) {
				assert.deepStrictEqual(result.folders.map(function (f) { return f.uri.replace(/^.*\/h/, "/h"); }), ["/h/ev/", "/h/both/"]);
			});
		});

		bdd.it("asks for all tasks of a list", function () {
			fresh({"/c/": {code: 207, body: multistatus(response("/c/1", found(etag("a"))))}});
			return done(CalDav.downloadEtags(params("/c/", {tasks: true}))).then(function (result) {
				assert.strictEqual(result.etags.length, 1);
				assert.ok(seen[0].body.indexOf("name=\"VTODO\"") > 0);
				assert.ok(seen[0].body.indexOf("VEVENT") < 0 && seen[0].body.indexOf("time-range") < 0);
			});
		});
	});

	bdd.describe("batch downloads and changes", function () {
		var CAL = "<c:calendar-data>BEGIN:VCALENDAR\nSUMMARY:A &amp; B\nEND:VCALENDAR\n</c:calendar-data>";

		bdd.it("fetches several objects with one request", function () {
			fresh({"/c/": {code: 207, body: multistatus(
				response("/c/a%20b.ics", found(etag("e1") + CAL)) +
					response("/c/gone.ics", missing("<c:calendar-data>old</c:calendar-data>")) +
					response("/c/empty.ics", found(etag("e2")))
			)}});
			return done(CalDav.downloadObjects(params("/c/"), [{uri: "/c/a%20b.ics"}, {uri: "/c/gone.ics"}, {uri: "/c/empty.ics"}, {uri: "/c/x&y.ics"}])).then(function (result) {
				assert.deepStrictEqual(Object.keys(result.objects), ["/c/a%20b.ics"]);
				assert.strictEqual(result.objects["/c/a%20b.ics"].data, "BEGIN:VCALENDAR\r\nSUMMARY:A & B\r\nEND:VCALENDAR\r\n");
				assert.strictEqual(result.objects["/c/a%20b.ics"].etag, "\"e1\"");
				assert.strictEqual(seen.length, 1);
				assert.strictEqual(seen[0].method, "REPORT");
				assert.ok(seen[0].body.indexOf("calendar-multiget") > 0);
				assert.ok(seen[0].body.indexOf("<d:href>/c/x&amp;y.ics</d:href>") > 0, seen[0].body);
			});
		});

		bdd.it("asks for vCard 3 in a batch", function () {
			fresh({"/c/": {code: 207, body: multistatus("")}});
			return done(CalDav.downloadObjects(params("/c/", {cardDav: true}), [{uri: "/c/1"}])).then(function () {
				assert.ok(/addressbook-multiget/.test(seen[0].body) && /version="3.0"/.test(seen[0].body));
			});
		});

		bdd.it("fails on a batch answer that is no listing", function () {
			fresh({"/c/": {code: 200, body: "<html></html>"}});
			return done(CalDav.downloadObjects(params("/c/"), [{uri: "/c/1"}])).then(function (result) {
				assert.strictEqual(result.returnValue, false);
			});
		});

		function changes(extra) {
			return multistatus(response("/c/new", found(etag("n"))) +
				"<d:response><d:href>/c/old</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>" + (extra || "") +
				"<d:sync-token>t2</d:sync-token>");
		}

		bdd.it("reads what changed since a token", function () {
			fresh({"/c/": {code: 207, body: changes()}});
			return done(CalDav.syncCollection(params("/c/", {syncToken: "t<1"}))).then(function (result) {
				assert.deepStrictEqual(result.changed, [{uri: "/c/new", etag: "\"n\""}]);
				assert.deepStrictEqual(result.removed, ["/c/old"]);
				assert.strictEqual(result.syncToken, "t2");
				assert.strictEqual(result.truncated, false);
				assert.strictEqual(seen[0].headers.depth, "0");
				assert.ok(seen[0].body.indexOf("t&lt;1") > 0);
			});
		});

		bdd.it("notices a cut off list of changes", function () {
			fresh({"/c/": {code: 207, body: changes("<d:response><d:href>/c/</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response>")}});
			return done(CalDav.syncCollection(params("/c/", {syncToken: "t1"}))).then(function (result) {
				assert.strictEqual(result.truncated, true);
				assert.deepStrictEqual(result.removed, ["/c/old"]);
			});
		});

		[[403, "<error/>"], [207, multistatus("")]].forEach(function (c) {
			bdd.it("fails on a rejected token or no new token (" + c[0] + ")", function () {
				fresh({"/c/": {code: c[0], body: c[1]}});
				return done(CalDav.syncCollection(params("/c/", {syncToken: "t1"}))).then(function (result) {
					assert.strictEqual(result.returnValue, false);
				});
			});
		});

		bdd.it("builds the listing from local objects and the changes", function () {
			var local = [
				{uri: "/c/same", etag: "s", calendarId: "C"},
				{uri: "/c/old", etag: "o", calendarId: "C"},
				{uri: "/c/edited", etag: "e", calendarId: "C"},
				{uri: "/d/other", etag: "x", calendarId: "D"}
			];
			assert.deepStrictEqual(ETag.applyChanges(local, {changed: [{uri: "/c/edited", etag: "e2"}, {uri: "/c/new", etag: "n"}], removed: ["/c/old"]}, "C", CalDav.samePath),
				[{uri: "/c/same", etag: "s"}, {uri: "/c/edited", etag: "e2"}, {uri: "/c/new", etag: "n"}]);
		});
	});

	bdd.describe("finding a server from a mail address", function () {
		var real = CalDav.dns;

		function withDns(srv, txt) {
			CalDav.dns = {
				resolveSrv: function (name, cb) {
					setImmediate(cb, srv[name] ? null : new Error("none"), srv[name]);
				},
				resolveTxt: function (name, cb) {
					setImmediate(cb, txt[name] ? null : new Error("none"), txt[name]);
				}
			};
		}

		bdd.it("uses the SRV and TXT records", function () {
			withDns({"_caldavs._tcp.example.org": [{name: "backup.example.org.", port: 1, priority: 20, weight: 1},
				{name: "dav.example.org.", port: 8443, priority: 10, weight: 1}]},
				{"_caldavs._tcp.example.org": [["path=/dav/"]]});
			return done(CalDav.findServer("example.org")).then(function (result) {
				CalDav.dns = real;
				assert.strictEqual(result.url, "https://dav.example.org:8443/dav/");
			});
		});

		bdd.it("falls back on contacts, then the well-known address", function () {
			withDns({"_carddavs._tcp.example.org": [{name: "c.example.org", port: 443, priority: 0, weight: 0}]}, {});
			return done(CalDav.findServer("example.org")).then(function (result) {
				assert.strictEqual(result.url, "https://c.example.org:443/.well-known/carddav");
				withDns({"_caldavs._tcp.example.org": [{name: ".", port: 0, priority: 0, weight: 0}]}, {});
				return done(CalDav.findServer("example.org"));
			}).then(function (result) {
				CalDav.dns = real;
				assert.strictEqual(result.url, "https://example.org/.well-known/caldav");
			});
		});
	});

	bdd.describe("requests to addresses from other people", function () {
		function get(p, extra) {
			var options = Object.assign({method: "GET", headers: {}}, extra);
			global.httpClient.parseURLIntoOptions(url(p), options);
			return done(global.httpClient.sendRequest(options, ""));
		}

		bdd.it("does not connect to a local address", function () {
			fresh({"/p": {code: 200, body: "x"}});
			return get("/p", {publicOnly: true}).then(function (result) {
				assert.strictEqual(result.returnValue, false);
				assert.deepStrictEqual(seen, []);
			});
		});

		[{}, {all: true}].forEach(function (lookupOptions) {
			bdd.it("refuses a name that points inwards " + JSON.stringify(lookupOptions), function () {
				return new Promise(function (resolve) {
					global.httpClient.publicLookup("localhost", lookupOptions, function (error) {
						assert.strictEqual(error && error.code, "EPRIVATEADDRESS");
						resolve();
					});
				});
			});
		});

		bdd.it("knows private addresses", function () {
			["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.5", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1"].forEach(function (ip) {
				assert.strictEqual(global.httpClient.isPrivateAddress(ip), true, ip);
			});
			["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860::1", "::ffff:8.8.8.8"].forEach(function (ip) {
				assert.strictEqual(global.httpClient.isPrivateAddress(ip), false, ip);
			});
		});

		bdd.it("stops reading an answer that is too large", function () {
			fresh({"/p": {code: 200, body: "0123456789"}});
			return get("/p", {maxBytes: 9}).then(function (result) {
				assert.strictEqual(result.returnValue, false);
				return get("/p", {maxBytes: 10});
			}).then(function (result) {
				assert.strictEqual(result.returnValue, true);
				assert.strictEqual(result.body, "0123456789");
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
