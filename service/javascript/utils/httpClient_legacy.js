/*jslint node: true */
/*global Future, Log, url, xml, http */

var httpClient = (function () {
    "use strict";
    var httpClientCache = {},
        proxyHost,
        proxyPort,
        haveProxy = false,
        proxyParts;

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

    function getHttpClient(options) {
        var key = options.prefix;
        if (haveProxy) {
            key = proxyHost + ":" + proxyPort;
        }
        
        if (!httpClientCache[key]) {
            httpClientCache[key] = {};
        }

        if (httpClientCache[key].connected) {
            Log.log_calDavDebug("Already connected");
            httpClientCache[key].client.removeAllListeners("error"); //remove previous listeners.
        } else {
            if (haveProxy) {
                Log.log_calDavDebug("Creatring connection to proxy ", proxyPort, proxyHost, false);
                httpClientCache[key].client = http.createClient(proxyPort, proxyHost, false);
                httpClientCache[key].connected = true; //connected is not 100% true anymore. But can't really check for connection without adding unnecessary requests.
            } else {
                Log.log_calDavDebug("Creating connection from ", options.port, options.headers.host, options.protocol === "https:");
                httpClientCache[key].client = http.createClient(options.port, options.headers.host, options.protocol === "https:");
                httpClientCache[key].connected = true; //connected is not 100% true anymore. But can't really check for connection without adding unnecessary requests.
            }
        }
        return httpClientCache[key].client;
    }

    function sendRequestImpl(options, data, retry) {
        var body = "",
            future = new Future(),
            httpClient,
            req,
            received = false,
            lastSend = 0,
            timeoutID,
            dataBuffer = new Buffer(data, 'utf8');

        if (retry === undefined) {
            retry = 0;
        }

        function checkTimeout() {
            var now;
            if (!received) {
                now = Date.now();
                Log.debug("Message was send last before " + ((now - lastSend) / 1000) + " seconds, was not yet received.");
                if (now - lastSend > 300 * 1000) { //last send before 30 seconds.. is that too fast?
                    clearTimeout(timeoutID);
                    if (retry <= 5) {
                        Log.log_calDavDebug("Trying to resend message.");
                        sendRequestImpl(options, data, retry + 1).then(function (f) {
                            future.result = f.result; //transfer future result.
                        });
                    } else {
                        Log.log("Already tried 5 times. Seems as if server won't answer? Sync seems broken.");
                        future.result = { returnValue: false, msg: "Message timedout, even after retries. Sync failed." };
                    }
                } else {
                    timeoutID = setTimeout(checkTimeout, 1000);
                }
            } else {
                clearTimeout(timeoutID);
                Log.log_calDavDebug("Message received, returning.");
            }
        }

        function endCB(res) {
            var result;
            Log.debug("Answer received."); //does this also happen on timeout??
            if (received) {
                Log.log_calDavDebug(options.path, " was already received... exiting without callbacks.");
            }
            received = true;
            clearTimeout(timeoutID);
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
                    if (timeoutID) {
                        clearTimeout(timeoutID);
                    }
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

        function responseCB(res) {
            Log.log_calDavDebug('STATUS: ', res.statusCode);
            Log.log_calDavDebug('HEADERS: ', res.headers);
            res.setEncoding('utf8');
            res.on('data', function dataCB(chunk) {
                Log.log_calDavDebug("chunk...");
                lastSend = Date.now();
                body += chunk;
            });
            res.on('end', function () { //sometimes this does not happen. One reason are empty responses..
                endCB(res);
            });
            
            var con = res;
            if (!con.setTimeout) {
                con = res.connection;
            }
            if (con && con.setTimeout) {
                Log.log_calDavDebug("Set timeout to 60000");
                con.setTimeout(60000);
                con.setKeepAlive(true);
                con.on('timeout', function () {
                    Log.log("Timeout while receiving.");
                    endCB(res);
                });
            } else {
                Log.log_calDavDebug("No setTimeout method on response.");
            }

            res.on('error', function (error) {
                Log.log("Error while receiving:", error);
                endCB(res);
            });
            res.on('close', function () {
                endCB(res);
            });
            res.resume(); //just a try ;)
        }

        function doSendRequest() {
            options.headers["Content-Length"] = Buffer.byteLength(data, 'utf8'); //get length of string encoded as utf8 string.

            Log.log_calDavDebug("Sending request ", data, " to server.");
            Log.log_calDavDebug("Options: ", options);
            Log.debug("Sending request to " + options.prefix + options.path);
            lastSend = Date.now();
            
            //make sure path includes domain if using proxy.
            if (haveProxy && options.path.indexOf("http") < 0) {
                options.path = options.prefix + options.path;
            }
            req = httpClient.request(options.method, options.path, options.headers);
            req.on('response', responseCB);

            req.on('error', function (e) {
                Log.log('problem with request: ', e);
                lastSend = 0; //let's trigger retry.
                //future.exception = { code: e.errno, msg: "httpRequest error " + e.message };
            });

            try {
                req.on('close', function (incomming) {
                    Log.log('Other side did hang up?', incomming);
                });

                var con = req;
                if (!con.setTimeout) {
                    con = req.connection;
                }
                if (con && con.setTimeout) {
                    Log.log_calDavDebug("Set timeout to 60000");
                    con.setTimeout(60000);
                    con.setKeepAlive(true);
                    con.on("timeout", function (e) {
                        Log.log("Request timedout: ", e);
                        lastSend = 0; //will retry.
                        //clearTimeout(timeoutID);
                        //future.result = { returnValue: false, msg: "Connection timedout: " + JSON.stringify(e) };
                    });
                } else {
                    Log.log_calDavDebug("No setTimeout method on request?");
                }

                //what does our socket do?
                if (req.connection) {
                    req.connection.on("connect", function (e) { Log.log_calDavDebug("request-connected:", e); });
                    req.connection.on("secure", function (e) { Log.log_calDavDebug("request-secure:", e); });
                    req.connection.on("data", function (e) { Log.log_calDavDebug("request-data:", e.length); });
                    req.connection.on("end", function (e) { Log.log_calDavDebug("request-end:", e); });
                    req.connection.on("timeout", function (e) { Log.log_calDavDebug("request-timeout:", e); });
                    req.connection.on("drain", function (e) { Log.log_calDavDebug("request-drain:", e); });
                    req.connection.on("error", function (e) { Log.log_calDavDebug("request-error:", e); });
                    req.connection.on("close", function (e) { Log.log_calDavDebug("request-close:", e); });
                }
            } catch (e) {
                Log.log("Error during response setup:", e);
            }

            // write data to request body
            req.write(data, "utf8");
            req.end();
        }

        timeoutID = setTimeout(checkTimeout, 1000);
        lastSend = Date.now();
        httpClient = getHttpClient(options);

        httpClient.on("error", function (e) {
            Log.log("Error with http connection: ", e);
            //TODO: check for unrecoverable errors here, i.e. dns errors.
            //if so do not retry but return:
            if (false) {
                clearTimeout(timeoutID);
                future.result = { returnValue: false, msg: "No connection possible: " + JSON.stringify(e) };
            } else {
                httpClientCache[options.prefix].connected = false;
                lastSend = 0; //trigger retry.
            }
        });

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