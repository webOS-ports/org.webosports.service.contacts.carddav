/*global require, console, global, process, setTimeout */
/*
 * Credentials must not reach the log. Log.debug always writes (Log.js), and
 * when a proxy is configured httpClient used to dump the whole request options
 * object, headers.Authorization included. Response headers (Set-Cookie) were
 * dumped raw as well.
 *
 * Run from this directory: node test-no-secret-logging.js
 * Exits 0 when nothing secret was logged, 1 otherwise.
 */

var http = require("http");

// Before httpClient is loaded: it reads the proxy settings once, at load.
// Port 9 (discard) on loopback: nothing listens, so the CONNECT fails fast.
process.env.http_proxy = "http://127.0.0.1:9";
process.env.https_proxy = "http://127.0.0.1:9";

var SECRET = "c2VjcmV0LXVzZXI6aHVudGVyMg";   // stands in for Basic credentials
var COOKIE = "sessionid=s3cr3t-c00kie";
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
function check(name, haystack) {
    "use strict";
    if (haystack.indexOf(SECRET) !== -1 || haystack.indexOf(COOKIE) !== -1) {
        failures.push(name);
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

proxyCase("httpClient.js", function () {
    "use strict";
    responseCase(function () {
        console.error = realError;
        if (failures.length) {
            console.log("FAIL: " + failures.join("; "));
            process.exit(1);
        }
        console.log("PASS: no credentials in the log");
        process.exit(0);
    });
});
