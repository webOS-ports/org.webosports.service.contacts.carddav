/*jslint node: true */
/*global Future, Log, xml, checkResult */

var http = require("http");
var https = require("https");
var url = require("url"); //required to parse urls

if (!console.trace) {
	console.trace = function () { "use strict"; };
}

var httpClient = (function () {
	"use strict";
	var proxy = {port: 0, host: "", valid: false},
		httpsProxy = {port: 0, host: "", valid: false},
		globalReqNum = 0,
		retries = {};

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
		if (parsedUrl.search) {
			options.path += parsedUrl.search;
		}
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

		if (options.ignoreSSLCertificateErrors && options.protocol === "https:") {
			options.rejectUnauthorized = false;
			options.requestCert = true;
		}
	}

	function prepareProxy(options, errorCB, closeCB, timeoutCB) {
		var future = new Future(), p, connectReq, returned = false;

		function connReqError(e) {
			Log.debug("Error/Close on proxy request: ", e);
			delete options.socket;
			if (!returned) {
				future.result = {returnValue: false};
				if (connectReq) {
					connectReq.removeAllListeners(); //make sure we do never hear of this again. :p
				}
			} else {
				Log.debug("Proxy already connected ok?");
			}
		}

		function errorSocketCB(e) {
			Log.debug("Error on socket: ", e);
			delete options.socket;
			if (errorCB) {
				errorCB(e);
			}
		}

		function closeSocketCB(e) {
			Log.debug("Close on socket: ", e);
			delete options.socket;
			if (closeCB) {
				closeCB(e);
			}
		}

		function timeoutSocketCB(e) {
			Log.debug("Timeout on socket: ", e);
			delete options.socket;
			if (timeoutCB) {
				timeoutCB(e);
			}
		}

		//handle proxy connect
		if (((options.protocol === "https:" && httpsProxy.valid) || proxy.valid) && !options.socket) {
			Log.debug("Need to create proxy connection.");
			p = httpsProxy;
			if (options.protocol !== "https:" || !p.valid) {
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
			connectReq.on("error", connReqError);
			connectReq.on("close", connReqError);
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
			setTimeout(connectReq, connReqError);

			connectReq.on("connect", function proxyConnectCB(res, socket) {
				returned = true;
				if (res.statusCode <= 300) {
					Log.log("Connected to proxy successful.");
					options.socket = socket;
					options.agent = false;

					socket.on("error", errorSocketCB);
					socket.on("close", closeSocketCB);

					setTimeout(socket, timeoutSocketCB);

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
			if (!retries[origin].received && retries[origin].retry === retry && !retries[origin].abort) {
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

			var result = {
				returnValue: (res.statusCode < 400),
				etag: res.headers.etag,
				returnCode: res.statusCode,
				headers: res.headers,
				body: options.binary ? body : body.toString("utf8"),
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
			Log.log_calDavDebug("close cb: ", e);
			Log.log_calDavDebug("connection-closed for ", reqName(origin, retry), e ? " with error." : " without error.");
			if (!e && res) { //close also happens if no res is there, yet. Hm. Catch this here and retry.
				endCB(res);
			} else if (e) {
				checkRetry("Connection closed " + (e ? " with error." : " without error."));
			} else {
				Log.log("Connection ", reqName(origin, retry), " closed, but no answer, yet? Wait a little longer.");
				setTimeout(timeoutCB, 60000);
			}
		}

		function responseCB(inRes) {
			res = inRes;
			Log.log_calDavDebug("STATUS: ", res.statusCode, " for ", reqName(origin, retry));
			Log.log_calDavDebug("HEADERS: ", res.headers, " for ", reqName(origin, retry));
			res.on("data", dataCB);
			res.on("end", function (e) { //sometimes this does not happen. One reason are empty responses..?
				Log.log_calDavDebug("res-end successful: ", e);
				endCB();
			});

			res.on("error", errorCB);
			res.on("close", closeCB);
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
					Log.log_calDavDebug("Method: ", options.method, " Headers: ", options.headers);
					Log.debug("Sending request ", reqName(origin, retry), " to " + options.prefix + options.path);

					if (options.protocol === "https:") {
						req = https.request(options, responseCB);
					} else {
						req = http.request(options, responseCB);
					}
					setTimeout(req, timeoutCB);
					req.on("error", errorCB);

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
					if (data) {
						if (data instanceof Buffer) {
							req.write(data);
						} else {
							req.write(data, "utf8");
						}
					}
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
