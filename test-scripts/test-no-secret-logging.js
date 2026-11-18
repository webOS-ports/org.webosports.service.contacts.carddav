/*global require, console, global, process, setTimeout, setImmediate, Proxy, __dirname */
/*
 * Credentials must not reach the log. Log.debug always writes (Log.js), and
 * when a proxy is configured httpClient used to dump the whole request options
 * object, headers.Authorization included. Response headers (Set-Cookie) were
 * dumped raw as well. HTTP bodies carry tokens and synced data, a token refresh
 * sends the refresh token and client secret, and the account pages used to log
 * everything they were handed.
 *
 * Run from this directory: node test-no-secret-logging.js
 * Exits 0 when nothing secret was logged, 1 otherwise.
 */

var fs = require("fs");
var http = require("http");
var path = require("path");
var vm = require("vm");

// Before httpClient is loaded: it reads the proxy settings once, at load.
// Port 9 (discard) on loopback: nothing listens, so the CONNECT fails fast.
process.env.http_proxy = "http://127.0.0.1:9";
process.env.https_proxy = "http://127.0.0.1:9";

var SECRET = "c2VjcmV0LXVzZXI6aHVudGVyMg";   // stands in for Basic credentials
var COOKIE = "sessionid=s3cr3t-c00kie";
var TOKEN = "ya29-fake-access-token-value";      // any token, code or secret
var PRIVATE = "Jane-Private-Contact";            // synced content in an HTTP body
var captured = [];
var realError = console.error;
console.error = function () {
    "use strict";
    captured.push(Array.prototype.slice.call(arguments).join(" "));
};

global.Log = require("./../service/javascript/utils/Log.js");
global.Future = require("./foundations/future");
global.checkResult = require("./../service/javascript/utils/checkResult.js");

var failures = [];
var finished = false;

// A Future swallows exceptions, which would otherwise end the run silently with 0.
process.on("exit", function () {
    "use strict";
    if (!finished) {
        console.log("FAIL: the test did not run to the end");
        process.exitCode = 1;
    }
});
function check(name, haystack) {
    "use strict";
    [SECRET, COOKIE, TOKEN, PRIVATE].forEach(function (needle) {
        if (haystack.indexOf(needle) !== -1) {
            failures.push(name + " leaked " + needle);
        }
    });
}

function expect(name, haystack, wanted) {
    "use strict";
    if (haystack.indexOf(wanted) === -1) {
        failures.push(name + ": missing " + wanted);
    }
}

function proxyCase(file, done) {
    "use strict";
    captured = [];
    var httpClient = require("./../service/javascript/utils/" + file);
    var options = {
        method: "GET",
        headers: { Authorization: "Basic " + SECRET, Cookie: COOKIE }
    };
    httpClient.parseURLIntoOptions("http://127.0.0.1:9/dav/", options);
    try {
        httpClient.sendRequest(options, "");
    } catch (e) {
        captured.push("threw: " + e.message);
    }
    setTimeout(function () {
        var text = captured.join("\n");
        if (file === "httpClient.js" && text.indexOf("Proxy: ") === -1) {
            failures.push(file + ": proxy path was not exercised");
        }
        check(file + " request/proxy logging", text);
        done();
    }, 500);
}

function responseCase(done) {
    "use strict";
    // A real server, reached without a proxy, that answers with a cookie.
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    var key = require.resolve("./../service/javascript/utils/httpClient.js");
    delete require.cache[key];
    var httpClient = require(key);
    var server = http.createServer(function (req, res) {
        res.setHeader("Set-Cookie", COOKIE);
        res.end("ok");
    });
    server.listen(0, "127.0.0.1", function () {
        captured = [];
        var options = { method: "GET", headers: { Authorization: "Basic " + SECRET } };
        httpClient.parseURLIntoOptions("http://127.0.0.1:" + server.address().port + "/", options);
        var f = httpClient.sendRequest(options, "");
        f.then(function () {
            var text = captured.join("\n");
            if (text.indexOf("HEADERS: ") === -1) {
                failures.push("response headers were not logged at all");
            }
            check("response header logging", text);
            server.close();
            done();
        });
    });
}

function bodyCase(done) {
    "use strict";
    var httpClient = require("./../service/javascript/utils/httpClient.js");
    var answer = JSON.stringify({access_token: TOKEN, name: PRIVATE});
    var server = http.createServer(function (req, res) {
        req.resume();
        res.end(answer);
    });
    server.listen(0, "127.0.0.1", function () {
        captured = [];
        var options = { method: "POST", headers: {} };
        var data = "client_secret=" + TOKEN + "&refresh_token=" + TOKEN;
        httpClient.parseURLIntoOptions("http://127.0.0.1:" + server.address().port + "/token", options);
        httpClient.sendRequest(options, data).then(function (f) {
            var text = captured.join("\n"), result = f.result;
            check("request and response bodies", text);
            expect("request size", text, data.length + " bytes of data");
            expect("response size", text, "Body: " + answer.length + " bytes");
            if (result.body.toString().indexOf(TOKEN) === -1) {
                failures.push("the caller no longer gets the response body");
            }
            server.close();
            setImmediate(done); // out of the Future, which would swallow exceptions
        });
    });
}

// httpClient_legacy.js needs an old node to run, so only its source is checked.
function legacySourceCase() {
    "use strict";
    var file = path.join(__dirname, "..", "service", "javascript", "utils", "httpClient_legacy.js");
    var text = fs.readFileSync(file, "utf8");
    if (text.indexOf("\"Body: \" + body.toString") !== -1 || text.indexOf("\" with data \", data") !== -1) {
        failures.push("httpClient_legacy.js logs HTTP bodies");
    }
}

function logCase() {
    "use strict";
    var Log = global.Log, circular = {password: TOKEN, keep: "visible-circular"};
    circular.self = circular;
    captured = [];
    Log.log("object: ", {returnCode: 207, nested: [{credentials: {password: TOKEN}, body: PRIVATE,
        parsedBody: {name: PRIVATE}, authToken: "Bearer " + TOKEN, keep: "visible-object"}]});
    Log.debug("circular: ", circular);
    Log.log("json: {\"access_token\":\"" + TOKEN + "\",\"keep\":\"visible-json\"}");
    Log.log("quote in value: {\"password\":\"a\\\"" + TOKEN + "\",\"keep\":\"visible-quote\"}");
    Log.log("escaped: " + JSON.stringify({keydata: JSON.stringify({refresh_token: TOKEN})}));
    Log.log("form: client_secret=" + TOKEN + "&refresh_token=" + TOKEN + "&keep=visible-form");
    Log.log("headers: Bearer " + TOKEN + " Basic " + SECRET);
    Log.log("Digest username=\"u\", response=\"" + TOKEN + "\"");
    Log.log("unterminated: \"password\":\"" + TOKEN);
    var text = captured.join("\n");
    check("Log", text);
    ["\"returnCode\":207", "visible-object", "visible-circular", "visible-json", "visible-quote",
        "keep=visible-form"].forEach(function (wanted) {
        expect("Log", text, wanted);
    });
    captured = [];
    Log.log("Authorization: Basic auth");
    expect("Log", captured.join("\n"), "Basic auth");
}

function loadPage(dir, params) {
    "use strict";
    var file = path.join(__dirname, "..", "app-enyo", dir, "CrossAppTarget.js");
    var source = fs.readFileSync(file, "utf8").split("\"PLACEHOLDER_GOOGLE_CDAV_CLIENT_ID\"").join(JSON.stringify(TOKEN))
        .split("\"PLACEHOLDER_GOOGLE_CDAV_CLIENT_SECRET\"").join(JSON.stringify(TOKEN));
    var kind, instance, stub = function () { return ""; };
    var record = function () { captured.push(Array.prototype.slice.call(arguments).join(" ")); };
    var widget = new Proxy({}, {get: function () { return stub; }});
    var context = {
        console: {error: record, log: record, warn: record},
        setTimeout: function () {},
        $L: function (s) { return s; },
        enyo: {kind: function (k) { kind = k; }, windowParams: params, scrim: {show: stub, hide: stub}},
        UrlSchemes: {urlSchemes: {}},
        PalmSystem: {launchParams: JSON.stringify(params), deviceInfo: JSON.stringify({modelName: "LuneOS Device"})},
        navigator: {InAppBrowser: {open: stub, close: stub}}
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context, {filename: file});
    instance = Object.create(kind);
    instance.inherited = stub;
    instance.log = record;
    instance.showLoginError = stub;
    instance.$ = new Proxy({}, {get: function () { return widget; }});
    instance.params = params;
    return instance;
}

function pagesCase() {
    "use strict";
    var params = {
        mode: "create",
        template: {capabilityProviders: [], config: {}, secret: TOKEN},
        account: {username: "u", alias: "a", credentials: {password: TOKEN, refresh_token: TOKEN}}
    };
    var failed = {error: "invalid_grant", access_token: TOKEN};
    var google, plain;

    captured = [];
    google = loadPage("GoogleOauth", params);
    google.create();
    google.gotAuthToken({}, "Success code=" + TOKEN);
    google.gotAccessToken({}, {access_token: TOKEN, refresh_token: TOKEN, token_type: "Bearer"});
    google.gotName({}, {email: "user@example.org", id_token: TOKEN});
    google.getAccessTokenFailed({}, failed);
    google.windowParamsChangeHandler({}, {params: params});
    google.credentialsCameBack({}, {returnValue: true, credentials: TOKEN});
    check("Google sign-in page", captured.join("\n"));
    expect("Google sign-in page", captured.join("\n"), "invalid_grant");

    captured = [];
    plain = loadPage("CrossAppTarget", params);
    plain.create();
    plain.account = {name: "n", credentials: {user: "u", password: TOKEN}};
    plain.credentialsOK({}, {success: true, password: TOKEN});
    plain.credentialsWrong({}, {reason: "wrong", password: TOKEN});
    plain.windowParamsChangeHandler({}, {params: params});
    check("account page", captured.join("\n"));
}

proxyCase("httpClient.js", function () {
    "use strict";
    responseCase(function () {
        bodyCase(function () {
        legacySourceCase();
        logCase();
        pagesCase();
        console.error = realError;
        finished = true;
        if (failures.length) {
            console.log("FAIL: " + failures.join("; "));
            process.exit(1);
        }
        console.log("PASS: no credentials in the log");
        process.exit(0);
        });
    });
});
