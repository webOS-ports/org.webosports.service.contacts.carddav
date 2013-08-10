/*global debug, log, http, url, Future, xml2js */

var CalDav = (function () {
	var httpClient,
		serverHost,
		parser = new xml2js.Parser({
		trim: true, //trims whitespaces from text nodes.
		normalizeTags: true, //all tags lowercase
		explicitArray: true //all child nodes are in arrays. Is a bit annoying at times, but more secure if multiple results are received.
	});
	
	function getResponses(body) {
		return body["d:multistatus"]["d:response"];
	}

	function processStatus(stat) {
		if (stat.length !== 1) {
			throw {msg: "multiple stati... can't process."};
		}
		log("Processing status: " + JSON.stringify(stat));
		return stat[0]; //maybe extract number here?
	}

	function processProp(prop) {
		if (prop.length !== 1) {
			throw {msg: "multiple props... can't process."};
		}
		log("Processing prop: " + JSON.stringify(prop));
		return prop[0];
	}

	function processPropstat(ps) {
		var propstat = {
			status: processStatus(ps["d:status"]),
			prop: processProp(ps["d:prop"])
		};
		return propstat;
	}

	function processResponse(res) {
		var response = {
			href: res["d:href"][0],
			propstats: res["d:propstat"]
		}, i;
		log("Processing response " + res);
		for (i = 0; i < response.propstats.length; i += 1) {
			response.propstats[i] = processPropstat(response.propstats[i]);
		}
		return response;
	}

	function parseResponseBody(body) {
		var ri, responses = getResponses(body) || [], procRes = [];
		log("parseResponseBody: " + JSON.stringify(responses));
		for (ri = 0; ri < responses.length; ri += 1) {
			procRes.push(processResponse(responses[ri]));
		}
		return procRes;
	}

	function getCTagFromResponse(body) {
		var responses = parseResponseBody(body), i, j, prop, key;
		for (i = 0; i < responses.length; i += 1) {
			for (j = 0; j < responses[i].propstats.length; j += 1) {
				prop = responses[i].propstats[j].prop;
				for (key in prop) {
					if (prop.hasOwnProperty(key)) {
						if (key.indexOf('getctag') >= 0) {
							log("got ctag: " + prop[key][0]);
							return prop[key][0];
						}
					}
				}
			}
		}
	}
	
	function getETags (body) {
		var responses = parseResponseBody(body), i, j, prop, key, eTags = [], etag;
		for (i = 0; i < responses.length; i += 1) {
			for (j = 0; j < responses[i].propstats.length; j += 1) {
				prop = responses[i].propstats[j].prop;
				for (key in prop) {
					if (prop.hasOwnProperty(key)) {
						if (key.indexOf('getetag') >= 0) {
							etag = prop[key][0];
						}
					}
				}
				if (etag) { //add found etags with uri
					eTags.push({etag: etag, uri: responses[i].href});
				}
			}
		}
		log("Etag directory: " + JSON.stringify(eTags));
		return eTags;
	}
	
	function sendRequest(options, data, retry) {
		var body = "", future = new Future(), req, received = false, lastSend, timeoutID;
		if (retry === undefined) {
			retry = 0;
		}
		
		function checkTimeout() {
			var now;
			if (!received) {
				now = Date.now();
				log ("Message was send last before " + ((now - lastSend) / 1000) + " seconds, was not yet received.");
				if (now - lastSend > 5*1000) { //last send before 5 seconds.. is that too fast?
					clearTimeout(timeoutID);
					if (retry <= 5) {
						log("Trying to resend message.");
						sendRequest(options, data, retry + 1).then(function(f) {
							future.result = f.result; //transfer future result.
						});
					} else {
						log("Already tried 5 times. Seems as if server won't answer? Sync seems broken.");
						throw ({msg: "Message timedout, even after retries. Sync failed."});
					}
				} else {
					timeoutID = setTimeout(checkTimeout, 1000);
				}
			} else {
				clearTimeout(timeoutID);
				log ("Message received, returning.");
			}
		}
		
		if (data.length > 0) {
			options.headers["Content-Length"] = data.length; //TODO: is that always correct? Have a look in syncml!
		}
		log("Sending request " + data + " to server.");
		log("Options: " + JSON.stringify(options));
		timeoutID = setTimeout(checkTimeout, 1000);
		lastSend = Date.now();
		req =  httpClient.request(options.method, options.path, options.headers);
		req.on('response', function(res) {
			log('STATUS: ' + res.statusCode);
			//log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			res.on('data', function (chunk) {
				log("got partial data.");
				lastSend = Date.now();
				body += chunk;
			});
			res.on('end', function() {
				if (received) {
					log(options.path + " was already received... exiting without callbacks.");
				}
				received = true;
				clearTimeout(timeoutID);
				log("Body: " + body);
				if (options.parse) {
					parser.parseString(body, function(err, parsedBody) {
						if (!err) {
							log("Parsed Body: " + JSON.stringify(parsedBody));
						}
						future.result = { returnValue: (res.statusCode < 400), parsedBody: parsedBody, etag: res.headers.Etag, returnCode: res.statusCode };
					});
				} else {
					future.result = { returnValue: (res.statusCode < 400), body: body, etag: res.headers.Etag, returnCode: res.statusCode };
				}
			});
		});

		req.on('error', function(e) {
			log('problem with request: ' + e.message);
			future.result = { returnValue: false };
		});

		// write data to request body
		req.write(data);
		req.end();
		
		return future;
	}
	
	function preProcessOptions(params) {
		var options = {
			path: params.path,
			method: "REPORT",
			headers: {
				Depth: 1, //used for DAV reports.
				Prefer: "return-minimal", //don't really know why that is.
				"Content-Type": "application/xml; charset=utf-8", //necessary
				Connection: "keep-alive",
				"Authorization": params.authToken,
				"host": serverHost
			}
		};
		return options;
	}

	//define public interface
	return {
		//configures internal httpClient for new host/port
		setHostAndPort: function(inUrl) {
			var parsedUrl = url.parse(inUrl);
			
			if (!parsedUrl.port) {
				parsedUrl.port = parsedUrl.protocol === "https:" ? 443 : 80;
			}
			
			serverHost = parsedUrl.hostname;
			httpClient = http.createClient(parsedUrl.port, serverHost, parsedUrl.protocol === "https:");
		},
		
		//checks only authorization.
		//check result.returnValue from feature.
		//TODO: does not really look at the error message. All codes >= 400 return a false => i.e. auth error.
		checkCredentials: function(params) {
			var options = preProcessOptions(params), future = new Future();
			options.method = "GET";
			
			future.nest(sendRequest(options, ""));			
			return future;
		},
		
		//determines if a sync is necessary for datastore given by url.
		//needs: { username, password, url, ctag }
		//returns future, which will eventually get result which contains ctag and 
		checkForChanges: function (params) {
			var options = preProcessOptions(params), future = new Future(), data;
			options.method = "PROPFIND";
			options.headers.Depth = 0;
			options.parse = true;
			
			//seems to be identical for caldav and carddav. RFC of carddav does not talk about this.
			data = "<d:propfind xmlns:d=\"DAV:\" xmlns:cs=\"http://calendarserver.org/ns/\">";
			data += "<d:prop>";
			data += "<d:displayname />";
			data += "<cs:getctag />";
			data += "</d:prop>";
			data += "</d:propfind>";
			
			future.nest(sendRequest(options, data));
			
			future.then(function() {
				var result = future.result, ctag;
				if (result.returnValue) {
					ctag = getCTagFromResponse(result.parsedBody);
				} else {
					log("Could not receive ctag.");
				}
				log("New ctag: " + ctag + ", old ctag: " + params.ctag);
				future.result = { success: result.returnValue, needsUpdate: ctag !== params.ctag, ctag: ctag };
			});
			
			return future;
		},
				
		downloadEtags: function(params) {
			var options = preProcessOptions(params), future = new Future(), data;
			options.method = "REPORT";
			options.headers.Depth = 1;
			options.parse = true;
			
			//maybe add sensible timerange here: <C:time-range start="20040902T000000Z" end="20040903T000000Z"/>
			//be sure to not delete local objects that are beyond that timerange! ;)
			//TODO: Hmpf.. why is this different for caldav and carddav? This sucks! :( Does any server really care about that?
			data = "<c:calendar-query xmlns:d='DAV:' xmlns:c='urn:ietf:params:xml:ns:caldav'><d:prop><d:getetag /></d:prop><c:filter><c:comp-filter name='VCALENDAR'><c:comp-filter name='VEVENT'></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";
			
			if (params.cardDav) {
				 data = "<c:addressbook-query xmlns:d='DAV:' xmlns:c='urn:ietf:params:xml:ns:carddav'><d:prop><d:getetag /></d:prop><c:filter><c:comp-filter name='VCARD'></c:comp-filter></c:filter></c:addressbook-query>";
			}
			
			future.nest(sendRequest(options, data));
			
			future.then(function() {
				var result = future.result, etags;
				if (result.returnValue) {
					etags = getETags(result.parsedBody);
					future.result = { returnValue: true, etags: etags } ;
				} else {
					future.result = { returnValue: false } ;
					log("Could not get eTags.");
				}
			});
						
			return future;
		},
		
		/*
		 * Downloadds a single object, whose uri is in obj.uri. 
		 * Future will contain data member which contains the body, i.e. the complete data of the object.
		 */
		downloadObject: function(params, obj) {
			var future = new Future(), options = preProcessOptions(params);
			options.method = "GET";
			options.path = obj.uri;
			
			future.nest(sendRequest(options, ""));
			
			future.then(function() {
				var result = future.result;
				future.result = { returnValue: result.returnValue, data: result.body };
			});
			
			return future;
		},
		
		/*
		 * Sends delete request to the server.
		 * Future will cotain uri member with old uri for reference.
		 */
		 deleteObject: function(params, uri, etag) {
		  var future = new Future(), options = preProcessOptions(params);
		  options.method = "DELETE";
		  options.path = uri;
		  
		  //prevent overriding remote changes.
			if (etag) {
				options.headers["If-Match"] = etag;
			}
		  
		  future.nest(sendRequest(options, ""));

		  return future;
		 },
		
		/*
		 * Puts an object to server.
		 * If server delivers etag in response, will also add etag to future.result.
		 */
		putObject: function(params, data) {
			var future = new Future(), options = preProcessOptions(params);
			options.method = "PUT";
			options.headers["Content-Type"] = "text/calendar; charset=utf-8";
			if (params.cardDav) {
				options.headers["Content-Type"] = "text/vcard; charset=utf-8";
			}
			
			//prevent overriding remote changes.
			if (params.etag) {
				options.headers["If-Match"] = params.etag;
			} else {
				options.headers["If-None-Match"] = "*";
			}
			
			future.nest(sendRequest(options, data));
						
			return future;
		}
	};	
}());
