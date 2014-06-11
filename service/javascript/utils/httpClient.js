/*global Future, Log, xml, checkResult */

var http = require("http");
var https = require("https");
var url = require("url"); //required to parse urls

if (!console.trace) {
    console.trace = function () {};
}

var httpClient = (function () {
    "use strict";
    var proxy = {port: 0, host: "", valid: false},
        httpsProxy = {port: 0, host: "", valid: false},
        globalReqNum = 0;

    function setProxy(proxyString, inProxy) {
        var proxyParts = process.env.http_proxy.match(/^(https?:\/\/)?([A-Za-z0-9\.\-_]+)(:([0-9]+))?/i);
        if (proxyParts) {
            inProxy.host = proxyParts[2];
            inProxy.port = proxyParts[4] || 80;
            inProxy.valid = true;
        } else {
            inProxy.valid = false;
        }
    }

    //initialize proxy support:
    if (process.env.http_proxy) {
        setProxy(process.env.http_proxy, proxy);
        Log.log("Got http-proxy: ", proxy.host, ":", proxy.port);
    }

    if (process.env.https_proxy) {
        setProxy(process.env.https_proxy, httpsProxy);
        Log.log("Got https-proxy: ", httpsProxy.host, ":", httpsProxy.port);
    }

    function setTimeout(obj, callback) {
        if (obj.setTimeout) {
            obj.setTimeout(60000, callback);
        } else if (obj.connection) {
            obj.connection.setTimeout(60000, callback);
        } else {
            Log.log("Error: Could not setTimeout!!");
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
        options.host = parsedUrl.hostname;
        options.headers.host = parsedUrl.hostname;
        options.port = parsedUrl.port;
        options.protocol = parsedUrl.protocol;

        if (!parsedUrl.port) {
            options.port = parsedUrl.protocol === "https:" ? 443 : 80;
        }

        options.prefix = options.protocol + "//" + options.headers.host + ":" + options.port;
        options.originalUrl = inUrl;
    }

    function prepareProxy(options) {
        var future = new Future(), p, connectReq, returned = false;

        function connReqError(e) {
            Log.debug("Error/Close on proxy request: ", e);
            if (!returned) {
                future.returnValue = {returnValue: false};
                if (connectReq) {
                    connectReq.removeAllListeners(); //make sure we do never hear of this again. :p
                }
            }
        }

        function errorOnSocket(e) {
            Log.debug("Error/Close on proxy socket: ", e);
            delete options.socket;
        }

        //handle proxy connect
        if (((options.protocol === "https:" && httpsProxy.valid) || proxy.valid) && !options.socket) {
            Log.debug("Need to create proxy connection.");
            p = httpsProxy;
            if (options.protocol !== "https" || !p.valid) {
                p = proxy;
                Log.debug("Using http proxy");
            } else {
                Log.debug("Using https proxy");
            }

            Log.debug("Proxy: ", p, ", options: ", options, " path: ", (options.host + ":" + options.port));
            connectReq = http.request({
                host: p.host,
                port: p.port,
                method: "CONNECT",
                path: options.host + ":" + options.port,
                headers: {
                    Host: options.host + ":" + options.port
                },
                agent: false
            });
            connectReq.once("error", connReqError);
            connectReq.once("close", connReqError);
/*            connectReq.once("response", function (res) {
                Log.debug("Got response: ", res);
                res.upgrade = true; //hack
            });
            connectReq.once("upgrade", function (res, socket) {
                Log.debug("Got upgrade.");
                if (res.statusCode <= 300) {
                    Log.log("Connected to proxy successful.");
                    options.socket = socket;
                    options.agent = false;
                    future.result = {returnValue: true, socket: socket};
                } else {
                    future.result = {returnValue: false};
                }
            });*/
            setTimeout(connectReq, connectReq);

            connectReq.on("connect", function proxyConnectCB(res, socket) {
                returned = true;
                if (res.statusCode <= 300) {
                    Log.log("Connected to proxy successful.");
                    options.socket = socket;
                    options.agent = false;

                    socket.once("error", errorOnSocket);
                    socket.once("close", errorOnSocket);

                    future.result = {returnValue: true, socket: socket};
                } else {
                    Log.debug("Connection to proxy failed: ", res.statusCode);
                    future.result = {returnValue: false};
                }
            });

            connectReq.end();
        } else {
            future.result = {returnValue: true};
        }
        return future;
    }

    function sendRequestImpl(options, data, retry) {
        var body = "",
            future = new Future(),
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

            var result = {
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
                            ) && res.headers.location === options.protocol + "//" + options.headers.host + options.path
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
            Log.log_calDavDebug("close cb: ", e);
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
            res.on("data", dataCB);
            res.on("end", function (e) { //sometimes this does not happen. One reason are empty responses..?
                Log.log_calDavDebug("res-end successful: ", e);
                endCB();
            });

            res.once("error", errorCB);
            res.once("close", closeCB);
            setTimeout(res, timeoutCB);

            //in theory we do not need them. Need to test.
            //res.socket.once("error", errorCB);
            //res.socket.once("close", closeCB);
            //res.socket.once("timeout", timeoutCB);
        }

        function doSendRequest() {
            future.nest(prepareProxy(options, errorCB, closeCB, timeoutCB));

            future.then(function () {
                var result = checkResult(future), req;
                if (result.returnValue) {
                    options.headers["Content-Length"] = Buffer.byteLength(data, "utf8"); //get length of string encoded as utf8 string.

                    Log.log_calDavDebug("Sending request ", reqNum, " with data ", data, " to server.");
                    //Log.log_calDavDebug("Options: ", options);
                    Log.debug("Sending request ", reqNum, " to " + options.prefix + options.path);

                    if (options.protocol === "https:") {
                        req = https.request(options, responseCB);
                    } else {
                        req = http.request(options, responseCB);
                    }
                    setTimeout(req, timeoutCB);
                    req.once("error", errorCB);

                    //hopefuly we do not need that with newer node versions, need to test.
                    //            if (options.socket) {
                    //                options.socket.once("error", errorCB);
                    //                options.socket.once("close", closeCB);
                    //                options.socket.once("timeout", timeoutCB);
                    //            } else {
                    //                req.once("socket", function (socket) {
                    //                    socket.once("error", errorCB);
                    //                    socket.once("close", closeCB);
                    //                    socket.once("timeout", timeoutCB);
                    //                }
                    //            }

                    // write data to request body
                    req.write(data, "utf8");
                    req.end();
                } else {
                    future.result = { returnValue: false, msg: "Proxy connection failed." };
                }
            });
        }

        doSendRequest();

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
