/*jslint node: true*/
/*global Future, Log, xml, checkResult */

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
		globalReqNum = 0,
		retries = {};

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
		if (parsedUrl.search) {
			options.path += parsedUrl.search;
		}
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
			options.path = options.prefix + options.path; //for proxy need the complete url in path.
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
			Log.log_calDavDebug("Deactivating: ", key);
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

	function reqName(originalRequest, retry) {
		if (retry) {
			return originalRequest + "." + retry;
		} else {
			return originalRequest;
		}
	}

	function sendRequestImpl(options, data, retry, origin, authretry) {
		var body = new Buffer(0),
			future = new Future(),
			httpClient,
			req,
			res,
			reqNum = globalReqNum;

		if (!retry && !origin) { //exclude redirects here!
			globalReqNum += 1;
			retries[reqNum] = { retry: 0, received: false, abort: false};
			origin = reqNum;
			retry = 0;
		} else {
			retries[origin].retry = retry;
		}

		function checkRetry(error, override) {
			if (!retries[origin].received && retries[origin].retry === retry && !retries[origin].abort) { //not yet received and not yet retried again.
				Log.log("Message ", reqName(origin, retry), " had error: ", error);
				if (retries[origin].retry < 5 && !override) {
					Log.log_calDavDebug("Trying to resend message ", reqName(origin, retry), ".");
					sendRequestImpl(options, data, retry + 1, origin).then(function (f) {
						future.result = f.result; //transfer future result.
					});
				} else {
					retries[origin].abort = true;
					if (override) {
						Log.log("Error for request ", reqName(origin, retry), " makes retries senseless.");
					} else {
						Log.log("Already tried message ", reqName(origin, retry), " 5 times. Seems as if server won't answer? Sync seems broken.");
					}
					future.result = { returnValue: false, msg: error };
				}
			} else {
				if (retries[origin].retry > retry) {
					Log.log_calDavDebug("Already retrying message ", reqName(origin, retry), ", don't do this twice.");
				} else if (retries[origin].abort) {
					Log.log_calDavDebug("Recieving of message ", reqName(origin, retry), " was aborted.");
				} else {
					Log.log_calDavDebug("Message ", reqName(origin, retry), " already received, returning.");
				}
			}
		}

		function timeoutCB() {
			Log.log_calDavDebug("Timeout for ", reqName(origin, retry));
			checkRetry("Timeout");
		}

		function errorCB(e) {
			Log.log("Error in connection for ", reqName(origin, retry), ": ", e);
			//errno === 4 => EDOMAINNOTFOUND error
			//errno === 113 => EHOSTUNREACH error
			//errno === 111 => ECONNREFUSED
			//errno === 22 => EINVAL
			checkRetry("Error:" + e.message, e.code === "ECONNREFUSED" || e.errno === 4 || e.errno === 113 || e.errno === 111 || e.errno === 22);
		}

		function dataCB(chunk) {
			Log.log_calDavDebug("res", reqName(origin, retry), "-chunk:", chunk.length);
			var buffer = new Buffer(chunk.length + body.length);
			body.copy(buffer, 0, 0);
			chunk.copy(buffer, body.length, 0);
			body = buffer;
		}

		function endCB() {
			var result;
			Log.debug("Answer for ", reqName(origin, retry), " received."); //does this also happen on timeout??
			if (retries[origin].received) {
				Log.log_calDavDebug("Request ", reqName(origin, retry), " to ", options.path, " was already received... exiting without callbacks.");
				return;
			}
			if (retries[origin].abort) {
				Log.log_calDavDebug("Recieving of message ", reqName(origin, retry), " was aborted, exiting without callbacks");
				return;
			}

			retries[origin].received = true;
			if (!options.binary) {
				Log.log_calDavDebug("Body: " + body.toString("utf8"));
			}

			result = {
				returnValue: (res.statusCode < 400),
				etag: res.headers.etag,
				returnCode: res.statusCode,
				body: options.binary ? body : body.toString("utf8"),
				headers: res.headers,
				uri: options.prefix + options.path,
				method: options.method
			};
			if (options.path.indexOf(":/") >= 0) {
				result.uri = options.path; //path already was complete, maybe because of proxy usage.
			}

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
				retries[origin].received = false; //we did not recieve this request yet, but only the redirection!
				sendRequestImpl(options, data, 0, origin).then(function (f) {
					future.result = f.result; //transfer future result.
				});
			} else if (res.statusCode < 300 && options.parse) { //only parse if status code was ok.
				result.parsedBody = xml.xmlstr2json(body.toString("utf8"));
				Log.log_calDavParsingDebug("Parsed Body: ", result.parsedBody);
				future.result = result;
			} else if (res.statusCode === 401 && typeof options.authCallback === "function") {
				future.nest(options.authCallback(result));

				future.then(function authFailureCBResultHandling() {
					var cbResult = future.result;
					if (cbResult.returnValue === true && !authretry) {
						if (cbResult.newAuthHeader) {
							options.headers.Authorization = cbResult.newAuthHeader;
						}
						Log.debug("Retrying request with new auth data.");
						future.nest(sendRequestImpl(options, data, 0, origin, true)); //retry request once with new auth.
					} else {
						future.result = result; //just give back the old, failed, result non the less?
					}
				});
			} else {
				future.result = result;
			}
		}

		function closeCB(e) {
			Log.log_calDavDebug("connection-closed for ", reqName(origin, retry), e ? " with error." : " without error.");
			if (!e && res) { //close also happens if no res is there, yet. Hm. Catch this here and retry.
				endCB(res);
			} else if (e) {
				checkRetry("Connection closed " + (e ? " with error." : " without error."));
			} else {
				Log.log("Connection ", reqName(origin, retry), " closed, but no answer, yet? Wait a minute.");
				setTimeout(timeoutCB, 60000);
			}
		}

		function responseCB(inRes) {
			res = inRes;
			Log.log_calDavDebug("STATUS: ", res.statusCode, " for ", reqName(origin, retry));
			Log.log_calDavDebug("HEADERS: ", res.headers, " for ", reqName(origin, retry));
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
		}

		function connectCB(e) { Log.log_calDavDebug("request", reqName(origin, retry), "-connected:", e); }
		function secureCB(e) { Log.log_calDavDebug("request", reqName(origin, retry), "-secure:", e); }
		function dataCBCon(e) { Log.log_calDavDebug("request", reqName(origin, retry), "-data:", e.length); }
		function drainCB(e) { Log.log_calDavDebug("request", reqName(origin, retry), "-drain:", e); }

		function doSendRequest() {
			if (data) {
				if (data instanceof Buffer) {
					options.headers["Content-Length"] = data.length; //write length of buffer to header.
				} else if (typeof data === "object") {
					//uhm?
					data = JSON.stringify(data);
				}
				if (typeof data === "string") {
					options.headers["Content-Length"] = Buffer.byteLength(data, "utf8"); //get length of string encoded as utf8 string.
				}
			}

			Log.log_calDavDebug("Sending request ", reqName(origin, retry), " with data ", data, " to server.");
			Log.log_calDavDebug("Options: ", options);
			Log.debug("Sending request ", reqName(origin, retry), " to " + options.prefix + options.path);

			//make sure path includes domain if using proxy.
			if (haveProxy && options.path.indexOf("http") < 0) {
				options.path = options.prefix + options.path;
			}
			req = httpClient.request(options.method || "GET", options.path, options.headers);
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
			if (data) {
				if (data instanceof Buffer) {
					req.write(data);
				} else {
					req.write(data, "utf8");
				}
			}
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
			//Log.debug("before encode: ", options.path);
			//options.path = encodeURI(decodeURI(options.path)); //make sure URI is properly encoded.
			//Log.debug("After encode: ", options.path);
			return sendRequestImpl(options, data);
		},

		parseURLIntoOptions: function (inUrl, options) {
			return parseURLIntoOptionsImpl(inUrl, options);
		}
	};
}());

module.exports = httpClient;
