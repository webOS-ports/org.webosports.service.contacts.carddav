/*jslint sloppy: true, node: true */
/*global debug, log, http, url, Future, xml */

var CalDav = (function () {
	var httpClient,
		serverHost;

	function endsWith(str, suffix) {
		return str.indexOf(suffix, str.length - suffix.length) !== -1;
	}
	
	function getValue(obj, field) {
		var f, f2 = field.toLowerCase();
		for (f in obj) {
			if (obj.hasOwnProperty(f)) {
				if (endsWith(f.toLowerCase(), f2.toLowerCase())) {
					return obj[f];
				}
			}
		}
	}

	function getResponses(body) {
		var multistatus = getValue(body, "$multistatus");
		if (multistatus) {
			return getValue(multistatus, "$response") || [];
		}
	}

	function processStatus(stat) {
		//debug("Processing stat: " + JSON.stringify(stat));
		if (stat.length >= 0) {
			if (stat.length !== 1) {
				throw {msg: "multiple stati... can't process."};
			} else {
				return getValue(stat[0], "$t"); //maybe extract number here?
			}
		} else {
			//debug("Got single stat.");
			return getValue(stat, "$t");
		}
	}

	function processProp(prop) {
		//debug("Processing prop: " + JSON.stringify(prop));
		if (prop && prop.length >= 0) {
			if (prop.length !== 1) {
				throw {msg: "multiple props... can't process."};
			} else {
				return prop[0];
			}
		}
		return prop;
	}

	function processPropstat(ps) {
		//debug("Processing propstat: " + JSON.stringify(ps));
		var propstat = {
			status: processStatus(getValue(ps, "$status")),
			prop: processProp(getValue(ps, "$prop"))
		};
		return propstat;
	}

	function processResponse(res) {
		//debug("Processing response " + JSON.stringify(res));
		var response = {
			href: getValue(getValue(res, "$href"), "$t"),
			propstats: getValue(res, "$propstat")
		}, i;
		if (!response.propstats) {
			response.propstats = [];
		} else if (response.propstats.length >= 0) {
			for (i = 0; i < response.propstats.length; i += 1) {
				response.propstats[i] = processPropstat(response.propstats[i]);
			}
		} else {
			response.propstats = [processPropstat(response.propstats)];
		}
		return response;
	}

	function parseResponseBody(body) {
		var ri, responses = getResponses(body) || [], procRes = [];
		if (responses.length >= 0) {
			for (ri = 0; ri < responses.length; ri += 1) {
				//debug("Got response array: " + JSON.stringify(responses));
				procRes.push(processResponse(responses[ri]));
			}
		} else { //got only one response
			//debug("Got single response: " + JSON.stringify(responses));
			procRes.push(processResponse(responses));
		}
		return procRes;
	}

	function getKeyValueFromResponse(body, searchedKey, notResolveText) {
		var responses = parseResponseBody(body), i, j, prop, key, text;
		for (i = 0; i < responses.length; i += 1) {
			for (j = 0; j < responses[i].propstats.length; j += 1) {
				prop = responses[i].propstats[j].prop || {};
				for (key in prop) {
					if (prop.hasOwnProperty(key)) {
						if (key.toLowerCase().indexOf(searchedKey) >= 0) {
							//debug("Returning " + prop[key].$t + " for " + key);
							text = getValue(prop[key], "$t");
							if (notResolveText || !text) {
								return prop[key];
							} else {
								return text;
							}
						}
					}
				}
			}
		}
	}

	function getETags(body) {
		var responses = parseResponseBody(body), i, j, prop, key, eTags = [], etag;
		for (i = 0; i < responses.length; i += 1) {
			for (j = 0; j < responses[i].propstats.length; j += 1) {
				prop = responses[i].propstats[j].prop;
				for (key in prop) {
					if (prop.hasOwnProperty(key)) {
						if (key.toLowerCase().indexOf('getetag') >= 0) {
							etag = getValue(prop[key], "$t");
						}
					}
				}
				if (etag) { //add found etags with uri
					eTags.push({etag: etag, uri: responses[i].href});
				}
			}
		}
		//debug("Etag directory: " + JSON.stringify(eTags));
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
				log("Message was send last before " + ((now - lastSend) / 1000) + " seconds, was not yet received.");
				if (now - lastSend > 60 * 1000) { //last send before 5 seconds.. is that too fast?
					clearTimeout(timeoutID);
					if (retry <= 5) {
						log("Trying to resend message.");
						sendRequest(options, data, retry + 1).then(function (f) {
							future.result = f.result; //transfer future result.
						});
					} else {
						log("Already tried 5 times. Seems as if server won't answer? Sync seems broken.");
						future.result = { returnValue: true, msg: "Message timedout, even after retries. Sync failed." };
					}
				} else {
					timeoutID = setTimeout(checkTimeout, 1000);
				}
			} else {
				clearTimeout(timeoutID);
				log("Message received, returning.");
			}
		}

		options.headers["Content-Length"] = Buffer.byteLength(data, 'utf8'); //get length of string encoded as utf8 string.

		debug("Sending request " + data + " to server.");
		debug("Options: " + JSON.stringify(options));
		timeoutID = setTimeout(checkTimeout, 1000);
		lastSend = Date.now();
		req =  httpClient.request(options.method, options.path, options.headers);
		req.on('response', function (res) {
			var result, newPath;
			log('STATUS: ' + res.statusCode);
			log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			res.on('data', function (chunk) {
				lastSend = Date.now();
				body += chunk;
			});
			res.on('end', function () {
				if (received) {
					log(options.path + " was already received... exiting without callbacks.");
				}
				received = true;
				clearTimeout(timeoutID);
				//debug("Body: " + body);

				result = {
					returnValue: (res.statusCode < 400),
					etag: res.headers.etag,
					returnCode: res.statusCode,
					body: body,
					uri: options.path
				};

				if (res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307 || res.statusCode === 308) {
					newPath = CalDav.setHostAndPort(res.headers.location);
					log("Redirected to " + newPath);
					options.path = newPath;
					options.headers.host = serverHost;
					sendRequest(options, data).then(function (f) {
						future.result = f.result; //transfer future result.
					});
				} else if (res.statusCode < 300 && options.parse) { //only parse if status code was ok.
					result.parsedBody = xml.xmlstr2json(body);
					log("Parsed Body: " + JSON.stringify(result.parsedBody));
					future.result = result;
				} else {
					future.result = result;
				}
			});
		});

		req.on('error', function (e) {
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

	function generateMoreTestPaths(folder, tryFolders) {
		var newFolders = [], i, j, duplicate;
		if (folder.path.toLowerCase().indexOf("caldav") >= 0) {
			newFolders.push({path: folder.path.toLowerCase().replace("caldav", "carddav"), host: folder.host});
		}
		if (folder.host.toLowerCase().indexOf("caldav") >= 0) {
			newFolders.push({path: folder.path, host: folder.host.toLowerCase().replace("caldav", "carddav")});
		}
		if (folder.path.toLowerCase().indexOf("carddav") >= 0) {
			newFolders.push({path: folder.path.toLowerCase().replace("carddav", "caldav"), host: folder.host});
		}
		if (folder.host.toLowerCase().indexOf("carddav") >= 0) {
			newFolders.push({path: folder.path, host: folder.host.toLowerCase().replace("carddav", "caldav")});
		}
		
		//check for duplicates:
		for (j = 0; j < newFolders.length; j += 1) {
			debug("j: " + j);
			duplicate = false;
			for (i = 0; i < tryFolders.length; i += 1) {
				debug("i: " + i);
				if (newFolders[j].path.toLowerCase() === tryFolders[i].path.toLowerCase() &&
						newFolders[j].host.toLowerCase() === tryFolders[i].host.toLowerCase()) {
					duplicate = true;
					break;
				}
			}
			if (!duplicate) {
				tryFolders.push(newFolders[j]);
			}
		}
	}

	//define public interface
	return {
		//configures internal httpClient for new host/port
		//returns pathname, i.e. the not host part of the url.
		setHostAndPort: function (inUrl) {
			var parsedUrl = url.parse(inUrl);

			if (!parsedUrl.port) {
				parsedUrl.port = parsedUrl.protocol === "https:" ? 443 : 80;
			}

			if (parsedUrl.hostname && serverHost !== parsedUrl.hostname) {
				serverHost = parsedUrl.hostname;
				httpClient = http.createClient(parsedUrl.port, serverHost, parsedUrl.protocol === "https:");
			}

			return parsedUrl.pathname || "/"; //if no path, return / as root path.
		},

		//checks only authorization.
		//But does that with propfind user principal now, instead of GET.
		//Issue was that one can get the login screen without (and also with wrong) credentials.
		//check result.returnValue from feature.
		//this does not really look at the error message. All codes >= 400 return a false => i.e. auth error. But also returns status code.
		checkCredentials: function (params) {
			var options = preProcessOptions(params), future = new Future(), data;

			options.method = "PROPFIND";
			data = "<d:propfind xmlns:d='DAV:'><d:prop><d:current-user-principal /></d:prop></d:propfind>";

			future.nest(sendRequest(options, data));
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

			future.then(function () {
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

		downloadEtags: function (params) {
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

			future.then(function () {
				var result = future.result, etags;
				if (result.returnValue) {
					etags = getETags(result.parsedBody);
					future.result = { returnValue: true, etags: etags };
				} else {
					future.result = { returnValue: false };
					log("Could not get eTags.");
				}
			});

			return future;
		},

		/*
		 * Downloadds a single object, whose uri is in obj.uri.
		 * Future will contain data member which contains the body, i.e. the complete data of the object.
		 */
		downloadObject: function (params, obj) {
			var future = new Future(), options = preProcessOptions(params);
			options.method = "GET";
			options.path = obj.uri;

			future.nest(sendRequest(options, ""));

			future.then(function () {
				var result = future.result;
				future.result = { returnValue: result.returnValue, data: result.body };
			});

			return future;
		},

		/*
		 * Sends delete request to the server.
		 * Future will cotain uri member with old uri for reference.
		 */
		deleteObject: function (params, uri, etag) {
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
		putObject: function (params, data) {
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
		discovery: function (params) {
			var future = new Future(), options = preProcessOptions(params), data, homes = [], folders = { subFolders: {} }, folderCB,
				tryFolders = [], principals = [];

			function setNextUrl(folder) {
				if (folder.url) {
					options.path = CalDav.setHostAndPort(folder.url);
				} else {
					options.path = folder.path;
					options.headers.host = folder.host;
				}
			}

			function principalCB(index) {
				var result = future.result, principal, folder, i;
				if (result.returnValue === true) {
					principal = getKeyValueFromResponse(result.parsedBody, 'current-user-principal', true);
					if (principal) {
						principal = getValue(getValue(principal, "$href"), "$t");
						log("Got principal: " + principal);
						if (principal) {
							folder = {host: options.headers.host, path: principal};
							principals.push(folder); //try to find homes in principal folder, later.
							generateMoreTestPaths(folder, principals);
						}
					}
				} else {
					//error, stop, return failure.
					log("Error in getPrincipal: " + JSON.stringify(result));
					//future.result = result;	
				}

				if (index < tryFolders.length) {
					setNextUrl(tryFolders[index]);
					future.nest(sendRequest(options, data));
					future.then(principalCB.bind(this, index + 1));
				} else {
					if (principals.length === 0) {
						log("Could not get any principal at all.");
					}
	
					//prepare home folder search:
					options.headers.Depth = 0;
					data = "<d:propfind xmlns:d='DAV:' xmlns:c='urn:ietf:params:xml:ns:caldav'><d:prop><c:calendar-home-set/></d:prop></d:propfind>";
					
					//reorder array, so that principal folders are tried first:
					tryFolders = principals.concat(tryFolders);
					
					setNextUrl(tryFolders[0]);
					future.nest(sendRequest(options, data));
				}
			}

			function getHomeCB(addressbook, index) {
				var result = future.result, home;
				if (result.returnValue === true) {
					//look for either calendar- or addressbook-home-set :)
					home = getValue(getValue(getKeyValueFromResponse(result.parsedBody, "-home-set", true), "$href"), "$t");
					if (!home) {
						log("Could not get " + (addressbook ? "addressbook" : "calendar") + " home folder.");
					} else {
						log("Got " + (addressbook ? "addressbook" : "calendar") + "-home: " + home);
					}
				} else {
					//error, stop, return failure.
					log("Error in getHomeCB: " + JSON.stringify(result));
					//future.result = result;
				}
				
				if (!home) {
					if (index < tryFolders.length) {
						log("Trying to ask for " + (addressbook ? "addressbook" : "calendar") + "-home-set on next url: " + JSON.stringify(tryFolders[index]) + " index: " + index);
						setNextUrl(tryFolders[index]);
						future.nest(sendRequest(options, data));
						future.then(getHomeCB.bind(this, addressbook, index + 1));
						return;
					} else {
						log("Tried all folders. Will try to get " + (addressbook ? "addressbook" : "calendar") + " folders from original url.");
						home = CalDav.setHostAndPort(params.originalUrl);
					}
				}
				
				if (homes.length > 0 && homes[0] === home) {
					log("Homes identical, ignore second one.");
				} else {
					homes.push(home);
				}

				if (!addressbook) {
					data = "<d:propfind xmlns:d='DAV:' xmlns:c='urn:ietf:params:xml:ns:carddav'><d:prop><c:addressbook-home-set/></d:prop></d:propfind>";
					folders.calendarHome = home;
					setNextUrl(tryFolders[0]);
					future.nest(sendRequest(options, data));
					future.then(getHomeCB.bind(this, true, 1)); //calendar done, start with addressbook
				} else {
					folders.addressbookHome = home;
					//start folder search and consume first folder.
					log("Getting folders from " + homes[0]);
					params.cardDav = false;
					future.nest(this.getFolders(params, homes.shift()));
					future.then(this, folderCB);
				}
			}

			//some folders to probe for:
			tryFolders.push({url: params.originalUrl, path: options.path, host: options.headers.host}); //push original URL to test-for-home-folders.
			generateMoreTestPaths(tryFolders[0], tryFolders);
			tryFolders.push({path: "/.well-known/caldav", host: serverHost});
			tryFolders.push({path: "/.well-known/carddav", host: serverHost});

			//first get user principal:
			options.method = "PROPFIND";
			options.parse = true;
			setNextUrl(tryFolders[0]);
			data = "<d:propfind xmlns:d='DAV:'><d:prop><d:current-user-principal /></d:prop></d:propfind>";
			future.nest(sendRequest(options, data));
			future.then(principalCB.bind(this, 1));

			future.then(getHomeCB.bind(this, false, 1));

			folderCB = function () {
				var result = future.result, i, f, fresult = [], key;
				if (result.returnValue === true) {
					//prevent duplicates by URI.
					for (i = 0; i < result.folders.length; i += 1) {
						f = result.folders[i];
						folders.subFolders[f.uri] = f;
					}
				} else {
					log("Error during folder-search: " + JSON.stringify(result));
					//future.result = result;
				}
				
				if (homes.length > 0) { //if we still have unsearched home-foders, search them:
					log("Getting folders from " + homes[0]);
					params.cardDav = true; //bad hack.
					future.nest(this.getFolders(params, homes.shift()));
					future.then(this, folderCB);
				} else {
					for (key in folders.subFolders) {
						if (folders.subFolders.hasOwnProperty(key)) {
							fresult.push(folders.subFolders[key]);
						}
					}
					future.result = {
						returnValue: true,
						folders: fresult,
						calendarHome: folders.calendarHome,
						contactHome: folders.addressbookHome
					};
				}
			};

			return future;
		},

		//get's folders below uri. Can filter for addressbook, calendar or tasks.
		//future.result will contain array folders
		getFolders: function (params, uri, filter) {
			var future = new Future(), options = preProcessOptions(params), data, folders,
				getResourceType = function (rt) {
					var key, unspecCal = false;
					for (key in rt) {
						if (rt.hasOwnProperty(key)) {
							if (key.toLowerCase().indexOf('vevent-collection') >= 0) {
								return "calendar";
							}
							if (key.toLowerCase().indexOf('vcard-collection') >= 0 || key.toLowerCase().indexOf('addressbook') >= 0) {
								return "contact";
							}
							if (key.toLowerCase().indexOf('vtodo-collection') >= 0) {
								return "task";
							}
							if (key.toLowerCase().indexOf('calendar') >= 0) {
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

				parseSupportedComponents = function (xmlComp) {
					var key, comps = [], array, i;
					for (key in xmlComp) {
						if (xmlComp.hasOwnProperty(key)) {
							if (key.toLowerCase().indexOf('comp') >= 0) { //found list of components
								array = xmlComp[key];
								if (array.name) {
									comps.push(array.name);
								} else {
									for (i = 0; i < array.length; i += 1) {
										comps.push(array[i].name);
									}
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

				getFolderList = function (body) {
					var responses = parseResponseBody(body), i, j, prop, key, folders = [], folder;
					for (i = 0; i < responses.length; i += 1) {
						folder = {
							uri: responses[i].href,
							remoteId: responses[i].href
						};
						for (j = 0; j < responses[i].propstats.length; j += 1) {
							prop = responses[i].propstats[j].prop;
							for (key in prop) {
								if (prop.hasOwnProperty(key)) {
									if (key.toLowerCase().indexOf('displayname') >= 0) {
										folder.name = getValue(prop[key], "$t");
									} else if (key.toLowerCase().indexOf('resourcetype') >= 0) {
										folder.resource = getResourceType(prop[key]);
									} else if (key.toLowerCase().indexOf('supported-calendar-component-set') >= 0) {
										folder.supportedComponents = parseSupportedComponents(prop[key]);
									} else if (key.toLowerCase().indexOf('getctag') >= 0) {
										folder.ctag = getValue(prop[key], "$t");
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
					future.resul = {returnValue: false, success: result.returnValue, retunCode: result.returnCode};
				}
			});

			return future;
		}
	};
}());
