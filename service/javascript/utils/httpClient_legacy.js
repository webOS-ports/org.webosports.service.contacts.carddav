/*global Future, Log, IMPORTS, checkResult */

var xml = IMPORTS["foundations.xml"];
var http = require("http");
var url = require("url"); //required to parse urls
var dns = require("dns"); //resolve dns manually, because some errors are not caught by httpClient in 0.2.3.

var httpClient = (function () {
    "use strict";
    var httpClientCache = {},
        dnsCache = {},
        proxyHost,
        proxyPort,
        haveProxy = false,
        proxyParts,
        globalReqNum = 0;

    //initialize proxy support:
    if (process.env.http_proxy) {
        Log.log_calDavDebug("http_proxy variable: ", process.env.http_proxy);
        proxyParts = process.env.http_proxy.match(/^(http:\/\/)?([A-Za-z0-9\.\-_]+)(:([0-9]+))?/i);
        Log.log_calDavDebug("proxy match: ", proxyParts);
        if (proxyParts) {
            proxyHost = proxyParts[2];
            proxyPort = proxyParts[4] || 80;
            haveProxy = true;
            Log.log("Using proxy ", proxyHost, ":", proxyPort);
        } else {
            haveProxy = false;
        }
    }

    function parseURLIntoOptionsImpl(inUrl, options) {
        if (!inUrl) {
            return;
        }

        var parsedUrl = url.parse(inUrl);
        if (!parsedUrl.hostname) {
            parsedUrl = url.parse(inUrl.replace(":/", "://")); //somehow SOGo returns uri with only one / => this breaks URL parsing.
        }
        options.path = parsedUrl.pathname || "/";
        if (!options.headers) {
            options.headers = {};
        }
        options.headers.host = parsedUrl.hostname;
        options.port = parsedUrl.port;
        options.protocol = parsedUrl.protocol;

        if (!parsedUrl.port) {
            options.port = parsedUrl.protocol === "https:" ? 443 : 80;
        }

        options.prefix = options.protocol + "//" + options.headers.host + ":" + options.port;

        if (haveProxy) {
            options.path = inUrl; //for proxy need the complete url in path.
        }
    }

    function addListenerOnlyOnce(emitter, type, callback) {
        var listeners = emitter.listeners(type), i, strCB = callback.toString();
        for (i = listeners.length - 1; i >= 0; i -= 1) {
            if (listeners[i].toString() === strCB) {
                listeners.splice(i, 1);
            }
        }
        emitter.on(type, callback);
    }

    function resolveDomain(host) {
        var future = new Future();
        if (haveProxy) {
            host = proxyHost;
        }

        if (dnsCache[host]) {
            future.result = {returnValue: true, ip: dnsCache[host]};
        } else {
            dns.lookup(host, function (err, address) {
                if (err) {
                    future.result = {returnValue: false};
                } else {
                    dnsCache[host] = address;
                    future.result = {returnValue: true, ip: address};
                }
            });
        }

        return future;
    }

    function getHttpClient(options, host) {
        var key = options.prefix;
        if (haveProxy) {
            key = proxyHost + ":" + proxyPort;
        }

        function errorCB(e) {
            Log.log_calDavDebug("Error in http connection: ", e);
            httpClientCache[key].connected = false;
        }

        if (!httpClientCache[key]) {
            httpClientCache[key] = {};
        }

        if (httpClientCache[key].connected) {
            Log.log_calDavDebug("Already connected");
        } else {
            if (haveProxy) {
                Log.log_calDavDebug("Creatring connection to proxy ", proxyPort, proxyHost, false);
                httpClientCache[key].client = http.createClient(proxyPort, proxyHost, false);
                httpClientCache[key].connected = true; //connected is not 100% true anymore. But can't really check for connection without adding unnecessary requests.
            } else {
                Log.log_calDavDebug("Creating connection from ", options.port, options.headers.host, options.protocol === "https:");
                httpClientCache[key].client = http.createClient(options.port, host || options.headers.host, options.protocol === "https:");
                httpClientCache[key].connected = true; //connected is not 100% true anymore. But can't really check for connection without adding unnecessary requests.
            }

            addListenerOnlyOnce(httpClientCache[key].client, "error", errorCB);
        }
        return httpClientCache[key].client;
    }

    function sendRequestImpl(options, data, retry) {
        var body = "",
            future = new Future(),
            httpClient,
            req,
            res,
            reqNum = globalReqNum,
            received = false,
            retrying = false;

        globalReqNum += 1;

        function checkRetry(error, override) {
            if (!received && !retrying) {
                retrying = true; //set to true always to prevent further actions.
                Log.log("Message ", reqNum, " had error: ", error);
                if (retry <= 5 && !override) {
                    Log.log_calDavDebug("Trying to resend message ", reqNum, ".");
                    sendRequestImpl(options, data, retry + 1).then(function (f) {
                        future.result = f.result; //transfer future result.
                    });
                } else {
                    if (override) {
                        Log.log("Error for request ", reqNum, " makes retries senseless.");
                    } else {
                        Log.log("Already tried message ", reqNum, " 5 times. Seems as if server won't answer? Sync seems broken.");
                    }
                    future.result = { returnValue: false, msg: error };
                }
            } else {
                if (retrying) {
                    Log.log_calDavDebug("Already retrying message ", reqNum, ", don't do this twice.");
                } else {
                    Log.log_calDavDebug("Message ", reqNum, " already received, returning.");
                }
            }
        }

        function timeoutCB() {
            Log.log_calDavDebug("Timeout for ", reqNum);
            checkRetry("Timeout");
        }

        function errorCB(e) {
            Log.log("Error in connection for ", reqNum, ": ", e);
            //errno === 4 => EDOMAINNOTFOUND error
            checkRetry("Error:" + e.message, e.code === "ECONNREFUSED" || e.errno === 4);
        }

        function dataCB(chunk) {
            Log.log_calDavDebug("res", reqNum, "-chunk:", chunk.length);
            body += chunk;
        }

        function endCB() {
            var result;
            Log.debug("Answer for ", reqNum, " received."); //does this also happen on timeout??
            if (received) {
                Log.log_calDavDebug("Request ", reqNum, " to ", options.path, " was already received... exiting without callbacks.");
                return;
            }
            if (retrying) {
                Log.log_calDavDebug("Request ", reqNum, " to ", options.path, " is already retrying... exiting without callbacks.");
                return;
            }
            received = true;
            Log.log_calDavDebug("Body: " + body);

            result = {
                returnValue: (res.statusCode < 400),
                etag: res.headers.etag,
                returnCode: res.statusCode,
                body: body,
                uri: options.prefix + options.path
            };

            if (res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307 || res.statusCode === 308) {
                Log.log_calDavDebug("Location: ", res.headers.location);
                if (res.headers.location.indexOf("http") < 0) {
                    res.headers.location = options.prefix + res.headers.location;
                }

                //check if redirected to identical location
                if (res.headers.location === options.prefix + options.path || //if strings really are identical
                    //or we have default port and string without port is identical:
                        (
                            (
                                (options.port === 80 && options.protocol === "http:") ||
                                (options.port === 443 && options.protocol === "https:")
                            ) &&
                                res.headers.location === options.protocol + "//" + options.headers.host + options.path
                        )) {
                    //don't run into redirection endless loop:
                    Log.log("Preventing enless redirect loop, because of redirection to identical location: " + res.headers.location + " === " + options.prefix + options.path);
                    result.returnValue = false;
                    future.result = result;
                    return future;
                }
                parseURLIntoOptionsImpl(res.headers.location, options);
                Log.log_calDavDebug("Redirected to ", res.headers.location);
                sendRequestImpl(options, data).then(function (f) {
                    future.result = f.result; //transfer future result.
                });
            } else if (res.statusCode < 300 && options.parse) { //only parse if status code was ok.
                result.parsedBody = xml.xmlstr2json(body);
                Log.log_calDavParsingDebug("Parsed Body: ", result.parsedBody);
                future.result = result;
            } else {
                future.result = result;
            }
        }

        function closeCB(e) {
            Log.log_calDavDebug("connection-closed for ", reqNum, e ? " with error." : " without error.");
            if (!e && res) { //close also happens if no res is there, yet. Hm. Catch this here and retry.
                endCB(res);
            } else {
                checkRetry("Connection closed " + (e ? " with error." : " without error."));
            }
        }

        function responseCB(inRes) {
            res = inRes;
            Log.log_calDavDebug("STATUS: ", res.statusCode, " for ", reqNum);
            Log.log_calDavDebug("HEADERS: ", res.headers, " for ", reqNum);
            res.setEncoding("utf8");
            addListenerOnlyOnce(res, "data", dataCB);
            addListenerOnlyOnce(res, "end", function (e) { //sometimes this does not happen. One reason are empty responses..?
                Log.log_calDavDebug("res-end successful: ", e);
                endCB(res);
            });

            try {
                var con = res;
                if (!con.setTimeout) {
                    con = res.connection;
                }
                if (con && con.setTimeout) {
                    con.setTimeout(60000);
                    if (con.setKeepAlive) {
                        con.setKeepAlive(true);
                    }
                    addListenerOnlyOnce(con, "timeout", timeoutCB);
                } else {
                    Log.log_calDavDebug("No setTimeout method on response...?");
                }
            } catch (e) {
                Log.log("Error during response setup: ", e);
            }

            addListenerOnlyOnce(res, "error", errorCB);
            addListenerOnlyOnce(res, "close", closeCB);
            addListenerOnlyOnce(res, "end", closeCB); //if connection is directly closed, something went wrong.
            res.resume(); //just a try ;)
        }

        function connectCB(e) { Log.log_calDavDebug("request", reqNum, "-connected:", e); }
        function secureCB(e) { Log.log_calDavDebug("request", reqNum, "-secure:", e); }
        function dataCBCon(e) { Log.log_calDavDebug("request", reqNum, "-data:", e.length); }
        function drainCB(e) { Log.log_calDavDebug("request", reqNum, "-drain:", e); }

        function doSendRequest() {
            options.headers["Content-Length"] = Buffer.byteLength(data, "utf8"); //get length of string encoded as utf8 string.

            Log.log_calDavDebug("Sending request ", reqNum, " with data ", data, " to server.");
            Log.log_calDavDebug("Options: ", options);
            Log.debug("Sending request ", reqNum, " to " + options.prefix + options.path);

            //make sure path includes domain if using proxy.
            if (haveProxy && options.path.indexOf("http") < 0) {
                options.path = options.prefix + options.path;
            }
            req = httpClient.request(options.method, options.path, options.headers);
            addListenerOnlyOnce(req, "response", responseCB);

            addListenerOnlyOnce(req, "error", errorCB);

            try {
                addListenerOnlyOnce(req, "close", closeCB);

                var con = req.connection;
                if (con && con.setTimeout) {
                    Log.log_calDavDebug("Set timeout on request to 60000");
                    con.setTimeout(60000);
                    if (con.setKeepAlive) {
                        con.setKeepAlive(true);
                    }
                    addListenerOnlyOnce(con, "timeout", timeoutCB);
                } else {
                    Log.log_calDavDebug("No setTimeout method on request?");
                }

                //what does our socket do?
                if (req.connection) {
                    addListenerOnlyOnce(req.connection, "connect", connectCB);
                    addListenerOnlyOnce(req.connection, "secure", secureCB);
                    addListenerOnlyOnce(req.connection, "data", dataCBCon);
                    addListenerOnlyOnce(req.connection, "drain", drainCB);

                    //those really seem to happen and not propagate to the httpClient, sometimes.
                    //=> keep them!
                    addListenerOnlyOnce(req.connection, "timeout", timeoutCB);
                    addListenerOnlyOnce(req.connection, "error", errorCB);
                    addListenerOnlyOnce(req.connection, "close", closeCB);
                    addListenerOnlyOnce(req.connection, "end", closeCB); //somehow we lose the response object here? => Error.
                }
            } catch (e) {
                Log.log("Error during request setup: ", e);
            }

            // write data to request body
            req.write(data, "utf8");
            req.end();
        }

        future.nest(resolveDomain(options.headers.host));
        future.then(function () {
            var result = checkResult(future);
            if (result.returnValue === true) {
                httpClient = getHttpClient(options, result.ip);
                addListenerOnlyOnce(httpClient, "error", errorCB);

                doSendRequest();
            } else {
                future.result = { returnValue: false, msg: "DNS lookup failed." };
            }
        });

        return future;
    }

    return {
        sendRequest: function (options, data) {
            return sendRequestImpl(options, data, 0);
        },

        parseURLIntoOptions: function (inUrl, options) {
            return parseURLIntoOptionsImpl(inUrl, options);
        }
    };
}());

module.exports = httpClient;
