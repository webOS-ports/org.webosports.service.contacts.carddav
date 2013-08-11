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
		//log("Processing status: " + JSON.stringify(stat));
		return stat[0]; //maybe extract number here?
	}

	function processProp(prop) {
		if (prop.length !== 1) {
			throw {msg: "multiple props... can't process."};
		}
		//log("Processing prop: " + JSON.stringify(prop));
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
		//log("Processing response " + res);
		for (i = 0; i < response.propstats.length; i += 1) {
			response.propstats[i] = processPropstat(response.propstats[i]);
		}
		return response;
	}

	function parseResponseBody(body) {
		var ri, responses = getResponses(body) || [], procRes = [];
		//log("parseResponseBody: " + JSON.stringify(responses));
		for (ri = 0; ri < responses.length; ri += 1) {
			procRes.push(processResponse(responses[ri]));
		}
		return procRes;
	}
	
	function getKeyValueFromResponse(body, searchedKey) {
		var responses = parseResponseBody(body), i, j, prop, key;
		for (i = 0; i < responses.length; i += 1) {
			for (j = 0; j < responses[i].propstats.length; j += 1) {
				prop = responses[i].propstats[j].prop;
				for (key in prop) {
					if (prop.hasOwnProperty(key)) {
						if (key.indexOf(searchedKey) >= 0) {
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
		//log("Etag directory: " + JSON.stringify(eTags));
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
						throw new Error("Message timedout, even after retries. Sync failed.");
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
			options.headers["Content-Length"] = data.length;
		}
		debug("Sending request " + data + " to server.");
		debug("Options: " + JSON.stringify(options));
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
				debug("Body: " + body);
								
				var result = {
					returnValue: (res.statusCode < 400),
					etag: res.headers.Etag,
					returnCode: res.statusCode,
					body: body
				};
				
				if (res.statusCode < 400 && options.parse) { //only parse if status code was ok.
					parser.parseString(body, function(err, parsedBody) {
						if (err) {
							log("Error during parsing: " + JSON.stringify(err));
							log("Parsed Body: " + JSON.stringify(parsedBody));
							throw new Error("Error during parsing: " + JSON.stringify(err));
						}
						result.parsedBody = parsedBody;
						future.result = result;
					});
				} else {
					future.result = result;
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
			method: "PROPFIND",
			headers: {
				//Depth: 0, //used for DAV reports.
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
		//returns pathname, i.e. the not host part of the url.
		setHostAndPort: function(inUrl) {
			var parsedUrl = url.parse(inUrl);
			
			if (!parsedUrl.port) {
				parsedUrl.port = parsedUrl.protocol === "https:" ? 443 : 80;
			}
			
			serverHost = parsedUrl.hostname;
			httpClient = http.createClient(parsedUrl.port, serverHost, parsedUrl.protocol === "https:");
			
			return parsedUrl.pathname;
		},
		
		//checks only authorization.
		//check result.returnValue from feature.
		//this does not really look at the error message. All codes >= 400 return a false => i.e. auth error. But also returns status code.
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
					ctag = getKeyValueFromResponse(result.parsedBody, 'getctag');
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
		},
		
		//discovers folders for contacts and calendars.
		//future.result will contain array folders.
		//folders contain uri, resource = contact/calendar/task
		discovery: function(params) {
			var future = new Future(), options = preProcessOptions(params), data, homes = [], folders = {}, folderCB;
			options.method = "PROPFIND";
			options.parse = true;
			
			//first get user principal:
			data = "<d:propfind xmlns:d='DAV:'><d:prop><d:current-user-principal /></d:prop></d:propfind>";
			future.nest(sendRequest(options, data));
			future.then(this, function principalDataCB() {
				var result = future.result, principal;
				if (result.returnValue === true) {
					principal = getKeyValueFromResponse(result.parsedBody, 'current-user-principal')["d:href"][0];
					log("Got principal: " + principal);
					options.path = principal;
					options.headers.Depth = 0;
					
					//first try to find calendar homes:
					data = "<d:propfind xmlns:d='DAV:' xmlns:c='urn:ietf:params:xml:ns:caldav'><d:calendar-home-set /></d:propfind>";
					future.nest(sendRequest(options, data));
				} else {
					//error, stop, return failure.
					log("Error in getPrincipal: " + JSON.stringify(result));
					future.result = result;
				}
			});
			
			future.then(this, function calendarHomeCB() {
				var result = future.result, home;
				if (result.returnValue === true) {
					//look for either calendar- or addressbook-home-set :)
					home = getKeyValueFromResponse(result.parsedBody, "-home-set")["d:href"][0];
					homes.push(home);
					data = "<d:propfind xmlns:d='DAV:' xmlns:c='urn:ietf:params:xml:ns:carddav'><d:addressbook-home-set /></d:propfind>";
					
					folders.calendarHome = home;
					future.nest(sendRequest(options, data));
				} else {
					//error, stop, return failure.
					log("Error in getCalenderHome: " + JSON.stringify(result));
					future.result = result;
				}
			});
			
			future.then(this, function addressbookHomeCB() {
				var result = future.result, home;
				if (result.returnValue === true) {
					//look for either calendar- or addressbook-home-set :)
					home = getKeyValueFromResponse(result.parsedBody, "-home-set")["d:href"][0];
					if (home !== homes[0]) {
						homes.push(home);
					} else {
						log("Homes identical, ignore second one.");
					}
					folders.addressbookHome = home;

					//start folder search and consume first folder.
					log("Getting folders from " + homes[0]);
					future.nest(this.getFolders(params, homes.shift()));
					future.then(this, folderCB.bind(this));
				} else {
					//error, stop, return failure.
					log("Error in getCalenderHome: " + JSON.stringify(result));
					future.result = result;
				}
			});
			
			folderCB = function() {
				var result = future.result, i, f, fresult = [], key;
				if (result.returnValue === true) {
					//prevent duplicates by URI.
					for (i = 0; i < result.folders.length; i += 1) {
						f = result.folders[i];
						folders[f.uri] = f;
					}
				
					if (homes.length > 0) { //if we still have unsearched home-foders, search them:
						log("Getting folders from " + homes[0]);
						future.nest(this.getFolders(params, homes.shift()));
						future.then(this, folderCB);
					} else {
						future.result = {
							returnValue: true,
							folders: fresult,
							calendarHome: folders.calendarHome,
							contactHome: folders.addressbookHome
						};
						for (key in folders) {
							if (folders.hasOwnProperty(key)) {
								fresult.push(folders[key]);
							}
						}
					}
				} else {
					log("Error during folder-search: " + JSON.stringify(result));
					future.result = result;
				}
			};
			
			return future;
		},
		
		//get's folders below uri. Can filter for addressbook, calendar or tasks.
		//future.result will contain array folders
		getFolders: function (params, uri, filter) {
			var future = new Future(), options = preProcessOptions(params), data, folders,
				getResourceType = function(rt) {
					var key, unspecCal = false;
					for (key in rt) {
						if (rt.hasOwnProperty(key)) {
							if (key.indexOf('vevent-collection') >= 0) {
								return "calendar";
							} 
							if (key.indexOf('vcard-collection') >= 0 || key.indexOf('addressbook') >= 0) {
								return "contact";
							}
							if (key.indexOf('vtodo-collection') >= 0) {
								return "tasks";
							}
							if(key.indexOf('calendar') >= 0) {
								//issue: calendar can be todo or calendar.
								unspecCal = true;
							}
						}
					}	
					
					if (unspecCal) {
						//if only found "calendar" must decide by supported components:
						return "calendar_tasks";
					}
					return "ignore";
				},

				parseSupportedComponents = function(xmlComp) {
					var key, comps = [], array, i;
					for (key in xmlComp) {
						if (xmlComp.hasOwnProperty(key)) {
							if (key.indexOf('comp') >= 0) { //found list of components
								array = xmlComp[key];
								for (i = 0; i < array.length; i += 1) {
									comps.push(array[i].$.name);
								}
								break;
							}
						}
					}
					return comps;
				},

				decideByComponents = function (supComp) {
					var i, calHint = 0, taskHint = 0;
					if (supComp) {
						for (i = 0; i < supComp.length; i += 1) {
							if (supComp[i] === "VEVENT") {
								calHint += 1;
							} else if (supComp[i] === "VTODO") {
								taskHint += 1;
							}
						}
					}

					if (taskHint > calHint) {
						return "task";
					}
					return "calendar"; //if don't have information, try calendar.. ;)
				},

				getFolderList = function(body) {
					var responses = parseResponseBody(body), i, j, prop, key, folders = [], folder;
					for (i = 0; i < responses.length; i += 1) {
						folder = {
							uri: responses[i].href
						};
						for (j = 0; j < responses[i].propstats.length; j += 1) {
							prop = responses[i].propstats[j].prop;
							for (key in prop) {
								if (prop.hasOwnProperty(key)) {
									if (key.indexOf('displayname') >= 0) {
										folder.name = prop[key][0];
									} else if (key.indexOf('resourcetype') >= 0) {
										folder.resource = getResourceType(prop[key][0]);
									} else if (key.indexOf('supported-calendar-component-set') >= 0) {
										folder.supportedComponents = parseSupportedComponents(prop[key][0]);
									} else if (key.indexOf('getctag') >= 0) {
										folder.ctag = prop[key][0];
									}
								}
							}
							if (folder.resource === "calendar_tasks") {
								folder.resource = decideByComponents(folder.supportedComponents);
							}
							//delete supportedComponents;
							if (!filter || folder.resource === filter) {
								folders.push(folder);
							}
						}
					}
					debug("Got folders: ");
					for (i = 0; i < folders.length; i += 1) {
						debug(JSON.stringify(folders[i]));
					}
					return folders;
				};
			
			options.headers.Depth = 1;
			options.path = uri;
			options.parse = true;
			
			data = "<d:propfind xmlns:d='DAV:' xmlns:c='urn:ietf:params:xml:ns:caldav'><d:prop><d:resourcetype /><d:displayname /><c:supported-calendar-component-set /></d:prop></d:propfind>";
			if (params.cardDav) {
				data = "<d:propfind xmlns:d='DAV:' xmlns:c='urn:ietf:params:xml:ns:carddav'><d:prop><d:resourcetype /><d:displayname /><c:supported-calendar-component-set /></d:prop></d:propfind>";
			}
			future.nest(sendRequest(options, data));
			
			future.then(this, function foldersCB() {
				var result = future.result;
				if (result.returnValue === true) {
					folders = getFolderList(result.parsedBody);
					future.result = {
						returnValue: true,
						folders: folders
					};
				} else {
					log("Error during getFolders: " + JSON.stringify(result));
					future.resul = result;
				}
			});
			
			return future;
		}
	};
}());
