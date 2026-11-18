/*jslint node: true  */
/*global Log, httpClient, Future, checkResult, libPath */

var AuthManager = require(libPath + "AuthManager.js");
var urlParser = require("url");
var dns = require("dns");

var CalDav = (function () {
	"use strict";

	//A failed listing makes the sync skip the whole kind, on a new account that means
	//no data until the next periodic sync. These answers usually pass within seconds.
	var TEMPORARY_SERVER_ERRORS = [502, 503, 504],
		FOLDER_RETRY_DELAYS = [2000, 5000, 10000];

	function endsWith(str, suffix) {
		return str.indexOf(suffix, str.length - suffix.length) !== -1;
	}

	function getValue(obj, field) {
		var f, f2 = field.toLowerCase();
		if (!obj) {
			return;
		}

		for (f in obj) {
			if (obj.hasOwnProperty(f)) {
				if (endsWith(f.toLowerCase(), f2.toLowerCase())) {
					//XML text is what it says: "100% work" is a name, not an encoded URL.
					return obj[f];
				}
			}
		}
	}

	function getResponses(body) {
		var multistatus = getValue(body, "multistatus");
		if (multistatus) {
			return getValue(multistatus, "response") || [];
		}
	}

	function isMultistatus(body) {
		return getValue(body, "multistatus") !== undefined;
	}

	function isSuccessStatus(status) {
		return !status || (/\b2[0-9][0-9]\b/).test(status);
	}

	//All hrefs below an element. Some properties may hold any number of them.
	function getHrefs(element) {
		var hrefs = getValue(element, "href");
		if (!hrefs) {
			return [];
		}
		return (hrefs.length >= 0 && typeof hrefs !== "string" ? hrefs : [hrefs]).map(function (href) {
			return typeof href === "string" ? href : getValue(href, "$t");
		}).filter(function (href) {
			return !!href;
		});
	}

	function absoluteUrl(href, prefix, base) {
		if ((/^[a-z][a-z0-9+.\-]*:/i).test(href)) {
			return href;
		}
		if (href.charAt(0) === "/") {
			return prefix + href;
		}
		return urlParser.resolve(base || (prefix + "/"), href);
	}

	function comparablePath(href) {
		var path = urlParser.parse(href).pathname || "/";
		try {
			path = decodeURIComponent(path);
		} catch (e) {
			Log.debug("Path is not URL encoded: ", path);
		}
		return path.replace(/\/+$/, "");
	}

	function processStatus(stat) {
		Log.log_calDavParsingDebug("Processing stat: ", stat, " type: ", typeof stat);
		if (typeof stat === "string") {
			return stat;
		}

		if (stat.length >= 0) {
			if (stat.length !== 1) {
				Log.log("Multiple stati: ", stat, ". Not allowed.");
				throw {msg: "multiple stati... can't process."};
			} else {
				return getValue(stat[0], "$t"); //maybe extract number here?
			}
		} else {
			Log.log_calDavParsingDebug("Got single stat.");
			return getValue(stat, "$t");
		}
	}

	function processProp(prop) {
		Log.log_calDavParsingDebug("Processing prop: ", prop);
		if (prop && prop.length >= 0) {
			if (prop.length !== 1) {
				throw {msg: "multiple props... can't process."};
			} else {
				return prop[0];
			}
		}
		Log.log_calDavParsingDebug("Resulting prop: ", prop);
		return prop;
	}

	function processPropstat(ps) {
		Log.log_calDavParsingDebug("Processing propstat: ", ps);
		var propstat = {
			status: processStatus(getValue(ps, "status")),
			prop: processProp(getValue(ps, "prop"))
		};
		Log.log_calDavParsingDebug("Resulting propstat: ", propstat);
		return propstat;
	}

	function processResponse(res) {
		Log.log_calDavParsingDebug("Processing response ", res);
		var response = {
			href: getHrefs(res)[0],
			status: getValue(res, "status") ? processStatus(getValue(res, "status")) : undefined,
			propstats: getValue(res, "propstat")
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

		Log.log_calDavParsingDebug("Resulting response: ", response);
		return response;
	}

	function parseResponseBody(body) {
		var ri, responses = getResponses(body) || [], procRes = [];
		Log.log_calDavParsingDebug("Parsing from: ", body);
		if (responses.length >= 0) {
			for (ri = 0; ri < responses.length; ri += 1) {
				Log.log_calDavParsingDebug("Got response array: ", responses);
				procRes.push(processResponse(responses[ri]));
			}
		} else { //got only one response
			Log.log_calDavParsingDebug("Got single response: ", responses);
			procRes.push(processResponse(responses));
		}
		return procRes;
	}

	function getKeyValueFromResponse(body, searchedKey) {
		var responses = parseResponseBody(body), i, j, prop, stat, key;
		for (i = 0; i < responses.length; i += 1) {
			for (j = 0; j < responses[i].propstats.length; j += 1) {
				stat = responses[i].propstats[j].status || "";
				prop = responses[i].propstats[j].prop || {};
				if (stat.indexOf("404") >= 0) {
					Log.log_calDavDebug("Prop ", prop, " not found on server. During search for ", searchedKey, ". Skipping.");
				} else {
					for (key in prop) {
						if (prop.hasOwnProperty(key)) {
							Log.log_calDavParsingDebug("Comparing ", key, " to ", searchedKey);
							if (key.toLowerCase().indexOf(searchedKey) >= 0) {
								Log.log_calDavParsingDebug("Returning ", prop[key], " for ", key);
								return prop[key];
							}
						}
					}
				}
			}
		}
	}

	/**
	 * Reads uri and etag of the objects in a listing of the collection at requestPath.
	 * The collection itself and collections inside it are not objects.
	 * @return {complete, etags}. A listing that is not complete must not be compared to local
	 *         objects, everything missing from it would count as deleted on the server.
	 */
	function getETags(body, blacklisted, requestPath) {
		var responses = parseResponseBody(body), etags = [], complete = isMultistatus(body), self = comparablePath(requestPath);

		function etagOfResponse(response) {
			var etag, isCollection = false;
			response.propstats.forEach(function (propstat) {
				var prop = propstat.prop, key;
				if (!isSuccessStatus(propstat.status)) {
					return;
				}
				for (key in prop) {
					if (prop.hasOwnProperty(key)) {
						if (key.toLowerCase().indexOf("getetag") >= 0) {
							etag = getValue(prop[key], "$t") || etag;
						} else if (key.toLowerCase().indexOf("resourcetype") >= 0 && getValue(prop[key], "collection") !== undefined) {
							isCollection = true;
						}
					}
				}
			});
			return isCollection ? undefined : etag;
		}

		responses.forEach(function (response) {
			var isSelf = !!response.href && comparablePath(response.href) === self, etag;
			if (!isSuccessStatus(response.status) && (isSelf || (/\b507\b/).test(response.status))) {
				Log.log("Server did not list everything: ", response.status);
				complete = false;
			}
			if (isSelf || !response.href) {
				return;
			}
			etag = etagOfResponse(response);
			if (etag && (blacklisted || []).indexOf(response.href) < 0) {
				etags.push({etag: etag, uri: response.href});
			}
		});
		Log.log_calDavDebug("Etag directory: ", etags.length);
		return {complete: complete, etags: etags, responses: responses.length};
	}

	function escapeXml(text) {
		return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	//The objects in a multiget answer, by path. XML has normalized their line ends.
	function getObjectData(body) {
		var objects = {};
		parseResponseBody(body).forEach(function (response) {
			response.propstats.forEach(function (propstat) {
				var prop = propstat.prop, key, entry = objects[comparablePath(response.href || "")] || {};
				if (!isSuccessStatus(propstat.status) || !response.href) {
					return;
				}
				for (key in prop) {
					if (prop.hasOwnProperty(key)) {
						if (key.toLowerCase().indexOf("getetag") >= 0) {
							entry.etag = getValue(prop[key], "$t");
						} else if ((/(calendar|address)-data$/i).test(key)) {
							entry.data = (getValue(prop[key], "$t") || "").replace(/\r?\n/g, "\r\n");
						}
					}
				}
				objects[comparablePath(response.href)] = entry;
			});
		});
		return objects;
	}

	/**
	 * Parses a multistatus-body into a list of folders.
	 * Filter can be "calendar", "contact" or similar to filter
	 * only folders that support this type of component.
	 * Prefix is an optional prefix for the folder URLs, i.e. the home-folder URL.
	 */
	function getFolderList(body, filter, prefix) {
		/**
		 * Used during folder parsing. Decides by ressource type which kind of folder rt is.
		 * Returns "calendar", "contact", "task", "calendar_tasks", or "ignored".
		 */
		function getResourceType(rt) {
			var key, unspecCal = false;
			for (key in rt) {
				if (rt.hasOwnProperty(key)) {
					if (key.toLowerCase().indexOf("vevent-collection") >= 0) {
						return "calendar";
					}
					if (key.toLowerCase().indexOf("vcard-collection") >= 0 || key.toLowerCase().indexOf("addressbook") >= 0) {
						return "contact";
					}
					if (key.toLowerCase().indexOf("vtodo-collection") >= 0) {
						return "task";
					}
					if (key.toLowerCase().indexOf("calendar") >= 0) {
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
		}

		/**
		 * Used during folder detection. Parses which components a folder supports,
		 * usual results are ["VEVENT", "VTODO", "VCARD"] or a subset of this.
		 * Returned as array of strings.
		 */
		function parseSupportedComponents(xmlComp) {
			var key, comps = [], array, i;
			for (key in xmlComp) {
				if (xmlComp.hasOwnProperty(key)) {
					if (key.toLowerCase().indexOf("comp") >= 0) { //found list of components
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
		}

		/**
		 * Decides type of folder by component.
		 */
		function decideByComponents(supComp) {
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
		}

		var responses = parseResponseBody(body), i, j, prop, key, folders = [], folder, tmpVal;
		for (i = 0; i < responses.length; i += 1) {
			folder = {
				uri: responses[i].href,
				remoteId: responses[i].href,
				supportedComponents: []
			};
			for (j = 0; j < responses[i].propstats.length; j += 1) {
				prop = responses[i].propstats[j].prop;
				for (key in prop) {
					if (prop.hasOwnProperty(key)) {
						Log.log_calDavParsingDebug("Processing key ", key);
						if (key.toLowerCase().indexOf("displayname") >= 0) {
							folder.name = folder.name || getValue(prop[key], "$t");
							Log.log_calDavParsingDebug("is displayname, result: ", folder.name);
						} else if (key.toLowerCase().indexOf("resourcetype") >= 0) {
							tmpVal = getResourceType(prop[key]);
							if (!folder.resource || tmpVal !== "ignore") {
								folder.resource = tmpVal;
							}
							Log.log_calDavParsingDebug("is resourcetype, result: ", folder.resource);
						} else if (key.toLowerCase().indexOf("supported-calendar-component-set") >= 0) {
							tmpVal = parseSupportedComponents(prop[key]);
							if (tmpVal) {
								folder.supportedComponents = folder.supportedComponents.concat(tmpVal);
							}
							Log.log_calDavParsingDebug("is supported-calendar-component-set, result: ", folder.supportedComponents);
						} else if (key.toLowerCase().indexOf("getctag") >= 0) {
							folder.ctag = getValue(prop[key], "$t");
						}
					}
				}
				if (folder.resource === "calendar_tasks") {
					folder.resource = decideByComponents(folder.supportedComponents);
					Log.log_calDavParsingDebug("Decided ", folder.resource, " for ", folder.name);
				}
			}

			//a calendar can hold tasks as well, then it is both.
			if (!filter || folder.resource === filter || (filter === "task" && folder.resource === "calendar" &&
					folder.supportedComponents.indexOf("VTODO") >= 0)) {
				if (!(/^https?:/i).test(folder.uri)) {
					folder.uri = (prefix || "") + folder.uri;
				}
				folder.remoteId = folder.uri;
				folders.push(folder);
			}
			Log.log_calDavParsingDebug("New folders: ", folders);
			Log.log_calDavParsingDebug("================================================================================");
		}
		Log.log_calDavDebug("Got folders: ");
		for (i = 0; i < folders.length; i += 1) {
			Log.log_calDavDebug(folders[i]);
		}
		return folders;
	}

	function changePath(options, userAuth, path) {
		if (path.indexOf(":/") >= 0) { //have full url
			httpClient.parseURLIntoOptions(path, options);
		} else {
			options.path = path;
		}
		options.headers.Authorization = AuthManager.getAuthToken(options.method, userAuth, options.path);
	}

	function preProcessOptions(params, inMethod, inPath) {
		var method = inMethod || "PROPFIND",
			path = inPath || params.path,
			options = {
				method: method,
				headers: {
					Prefer: "return-minimal", //don't really know why that is.
					"Content-Type": "text/xml; charset=utf-8", //necessary
					Connection: "keep-alive",
					"User-Agent": "org.webosports.service.cdav-connector"
				},
				ignoreSSLCertificateErrors: params.ignoreSSLCertificateErrors,
				authCallback: params.authCallback
			};

		Log.debug("Path: ", params.path);
		httpClient.parseURLIntoOptions(params.path, options); //fill prefix and stuff.
		changePath(options, params.userAuth, path);
		Log.debug("Result path: ", options.path);
		return options;
	}

	function generateMoreTestPaths(folder, tryFolders) {
		var newFolders = [folder], i, j, duplicate, tmp,
			replacePart = function (data, searchString, replacement) {
				var tmpStr;
				if (data.indexOf(searchString) >= 0) {
					return data.replace(searchString, replacement);
				}
				if (data.toLowerCase().indexOf(searchString) >= 0) {
					tmpStr = data.substr(data.toLowerCase().indexOf(searchString), searchString.length);
					return data.replace(tmpStr, replacement); //could theoretically screw up path.
				}
				return false;
			},
			stringReplacements = [
				{search: "caldav", replace: "carddav"},
				{search: "caldav", replace: "contacts"},
				{search: "calendar", replace: "carddav"},
				{search: "calendar", replace: "contacts"},
				{search: "carddav", replace: "calendar"},
				{search: "contacts", replace: "caldav"},
				{search: "contacts", replace: "calendar"}
			];

		for (i = 0; i < stringReplacements.length; i += 1) {
			tmp = replacePart(folder, stringReplacements[i].search, stringReplacements[i].replace);
			while (tmp !== false) {
				newFolders.push(tmp);
				tmp = replacePart(tmp, stringReplacements[i].search, stringReplacements[i].replace);
			}
		}

		//check for duplicates:
		for (j = 0; j < newFolders.length; j += 1) {
			duplicate = false;
			for (i = 0; i < tryFolders.length; i += 1) {
				if (newFolders[j] === tryFolders[i]) {
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
		/**
		 * Checks authorization. It does that with propfind user principal now, instead of a simple GET.
		 * Issue was that one can get the login screen without (and also with wrong) credentials.
		 * @param params usual param object with path, credentials, ...
		 * @return future, result.returnValue can be used to determine if login was ok or not.
		 *                  of course network errors can also happen. Also all status codes < 400 are
		 *                  accepted as ok (redirects are processed) all >= 400 are rejected as error.
		 */
		checkCredentials: function (params) {
			if (!params) {
				return new Future({returnValue: false});
			}
			var options = preProcessOptions(params, "PROPFIND"), future = new Future(), data;

			options.headers.Depth = 0;
			data = "<d:propfind xmlns:d=\"DAV:\"><d:prop><d:current-user-principal /></d:prop></d:propfind>";

			delete options.authCallback; //make sure we don't run into endless loop. AuthManager might call checkCredentials.
			future.nest(httpClient.sendRequest(options, data));
			return future;
		},

		/**
		 * Determines if a sync is necessary for datastore given by url.
		 * @param params usual param object with path, credentials, ...
		 * @return future, result contains ctag and needsUpdate == if update is necessary
		 */
		checkForChanges: function (params) {
			var options = preProcessOptions(params, "PROPFIND"), future = new Future(), data;
			options.headers.Depth = 0;
			options.parse = true;

			//getctag is an extension, sync-token is the standard for this (RFC 6578). The etag of
			//a collection is not used: nothing says it changes when the content does.
			data = "<d:propfind xmlns:d=\"DAV:\" xmlns:cs=\"http://calendarserver.org/ns/\">";
			data += "<d:prop>";
			data += "<d:displayname />";
			data += "<cs:getctag />";
			data += "<d:sync-token />";
			data += "</d:prop>";
			data += "</d:propfind>";

			future.nest(httpClient.sendRequest(options, data));

			future.then(function () {
				var result = checkResult(future), ctag = false, syncToken, needsUpdate = false;
				if (result.returnValue && isMultistatus(result.parsedBody)) {
					syncToken = getValue(getKeyValueFromResponse(result.parsedBody, "sync-token"), "$t");
					ctag = getValue(getKeyValueFromResponse(result.parsedBody, "getctag"), "$t") || syncToken || false;
				} else {
					Log.log("Could not receive ctag.");
				}
				Log.log_calDavDebug("New ctag: ", ctag, ", old ctag: ", params.ctag);
				if (!ctag || !params.ctag || ctag !== params.ctag) {
					needsUpdate = true;
				}
				future.result = { success: result.returnValue, needsUpdate: needsUpdate, ctag: ctag, syncToken: syncToken };
			});

			return future;
		},

		/**
		 * Downloads etags from all childs of a directory
		 * @param params usual param object with path, credentials, ...
		 * @return future result.etags will contain the etag directory of uri<=>etag objects
		 */
		downloadEtags: function (params, disableFilters) {
			var options = preProcessOptions(params, "REPORT"), future = new Future(), data, date = new Date(), startVal, blacklist = params.blacklist || [];
			options.headers.Depth = 1;
			options.parse = true;

			//maybe add sensible timerange here: <C:time-range start="20040902T000000Z" end="20040903T000000Z"/>
			//be sure to not delete local objects that are beyond that timerange! ;)
			startVal = String(date.getUTCFullYear() - 1) + (date.getUTCMonth() < 9 ? "0" : "") + String(date.getUTCMonth() + 1) + (date.getUTCDate() < 10 ? "0" : "") + String(date.getUTCDate()) + "T000000Z";

			data = "<?xml version=\"1.0\" encoding=\"utf-8\" ?><c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:getetag /></d:prop><c:filter><c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\"><c:time-range start=\"" + startVal + "\" /></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";
			if (params.tasks) {
				//all of them: unlike events, tasks do not end up in the past.
				data = data.replace(/<c:comp-filter name="VEVENT">.*?<\/c:comp-filter>/, "<c:comp-filter name=\"VTODO\" />");
			}
			if (disableFilters || params.cardDav) {
				//no filtering required for contacts, i.e. do propfind request.
				options.method = "PROPFIND";
				options.headers.Authorization = AuthManager.getAuthToken("PROPFIND", params.userAuth, options.path);
				data = "<?xml version=\"1.0\" encoding=\"utf-8\" ?><D:propfind xmlns:D=\"DAV:\"><D:prop><D:getetag/><D:resourcetype/></D:prop></D:propfind>";
			}

			future.nest(httpClient.sendRequest(options, data));

			future.then(function () {
				var result = checkResult(future), listing;
				if (result.returnValue) {
					listing = getETags(result.parsedBody, blacklist, options.path);
					//A PROPFIND always lists at least the collection. Anything else, a login page
					//from a Wi-Fi network for example, says nothing about what the server holds.
					if (!listing.complete || (options.method === "PROPFIND" && listing.responses === 0)) {
						Log.log("Answer is not a complete listing.");
						result = {returnValue: false};
					}
				}
				if (result.returnValue) {
					future.result = { returnValue: true, etags: listing.etags };
				} else {
					if (!params.cardDav && !disableFilters) {
						Log.log("Retry to get etags without filtering.");
						future.nest(CalDav.downloadEtags(params, true));
					} else {
						future.result = { returnValue: false, exception: result };
						Log.log("Could not get eTags.");
					}
				}
			});

			return future;
		},

		/**
		 * Downloadds a single object, whose uri is in obj.uri.
		 * @param params usual param object with path, credentials, ...
		 * @param obj, data object with uri field.
		 * @return future result.data contains the body, i.e. the complete data of the object.
		 */
		downloadObject: function (params, obj) {
			var future = new Future(), options = preProcessOptions(params, "GET", obj.uri);
			delete options.headers["Content-Type"]; //a GET has no body.
			//RFC 6352 section 5.1: vCard 3 is what every server has and what the importer knows.
			options.headers.Accept = params.cardDav ? "text/vcard; version=3.0, text/vcard; q=0.8" : "text/calendar";

			future.nest(httpClient.sendRequest(options, ""));

			future.then(function () {
				var result = checkResult(future);
				future.result = { returnValue: result.returnValue, returnCode: result.returnCode, data: result.body, etag: result.etag };
			});

			return future;
		},

		/**
		 * Downloads several objects with one request (RFC 4791 section 7.9, RFC 6352 section 8.7).
		 * @param params usual param object with path of the collection, credentials, ...
		 * @param objs objects with uri fields
		 * @return future, result.objects has {data, etag} for each uri the server delivered.
		 */
		downloadObjects: function (params, objs) {
			var future = new Future(), options = preProcessOptions(params, "REPORT"), data, hrefs;
			options.headers.Depth = 1;
			options.parse = true;

			hrefs = objs.map(function (obj) {
				return "<d:href>" + escapeXml(urlParser.parse(obj.uri).path) + "</d:href>";
			}).join("");
			if (params.cardDav) {
				data = "<?xml version=\"1.0\" encoding=\"utf-8\" ?><c:addressbook-multiget xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:carddav\">" +
					"<d:prop><d:getetag /><c:address-data content-type=\"text/vcard\" version=\"3.0\" /></d:prop>" + hrefs + "</c:addressbook-multiget>";
			} else {
				data = "<?xml version=\"1.0\" encoding=\"utf-8\" ?><c:calendar-multiget xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\">" +
					"<d:prop><d:getetag /><c:calendar-data /></d:prop>" + hrefs + "</c:calendar-multiget>";
			}

			future.nest(httpClient.sendRequest(options, data));
			future.then(function () {
				var result = checkResult(future), objects = {};
				if (result.returnValue && isMultistatus(result.parsedBody)) {
					objects = getObjectData(result.parsedBody);
					future.result = {
						returnValue: true,
						objects: objs.reduce(function (found, obj) {
							var entry = objects[comparablePath(obj.uri)];
							if (entry && entry.data) {
								found[obj.uri] = entry;
							}
							return found;
						}, {})
					};
				} else {
					future.result = {returnValue: false, returnCode: result.returnCode};
				}
			});
			return future;
		},

		/**
		 * Asks what changed in a collection since a sync token (RFC 6578).
		 * @param params usual param object with path of the collection and syncToken
		 * @return future with changed: [{uri, etag}], removed: [uri], syncToken and truncated.
		 *         returnValue is false if the token is not valid anymore, or on any other failure.
		 */
		syncCollection: function (params) {
			var future = new Future(), options = preProcessOptions(params, "REPORT"), data;
			options.headers.Depth = 0;
			options.parse = true;
			data = "<?xml version=\"1.0\" encoding=\"utf-8\" ?><d:sync-collection xmlns:d=\"DAV:\"><d:sync-token>" + escapeXml(params.syncToken) +
				"</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag /></d:prop></d:sync-collection>";

			future.nest(httpClient.sendRequest(options, data));
			future.then(function () {
				var result = checkResult(future), changes, multistatus, self = comparablePath(options.path);
				multistatus = result.returnValue ? getValue(result.parsedBody, "multistatus") : undefined;
				if (multistatus === undefined || !getValue(getValue(multistatus, "sync-token"), "$t")) {
					Log.log("No changes from the sync token, status ", result.returnCode);
					future.result = {returnValue: false, returnCode: result.returnCode};
					return;
				}
				changes = {returnValue: true, changed: [], removed: [], truncated: false,
					syncToken: getValue(getValue(multistatus, "sync-token"), "$t")};
				parseResponseBody(result.parsedBody).forEach(function (response) {
					var etag;
					if (!response.href) {
						return;
					}
					if (comparablePath(response.href) === self) {
						changes.truncated = changes.truncated || (/\b507\b/).test(response.status || "");
					} else if (!isSuccessStatus(response.status)) {
						changes.removed.push(response.href);
					} else {
						response.propstats.forEach(function (propstat) {
							if (isSuccessStatus(propstat.status) && propstat.prop) {
								etag = getValue(getValue(propstat.prop, "getetag"), "$t") || etag;
							}
						});
						if (etag) {
							changes.changed.push({uri: response.href, etag: etag});
						}
					}
				});
				future.result = changes;
			});
			return future;
		},

		/**
		 * Finds the server for a mail domain as RFC 6764 section 6 describes it: an SRV record
		 * for the service over TLS, a TXT record for its path, then the well-known address.
		 * @param domain the part of the mail address after the @
		 * @return future, result.url is the address to start discovery from
		 */
		findServer: function (domain) {
			var future = new Future(), services = ["caldavs", "carddavs"];

			function wellKnown() {
				future.result = {returnValue: true, url: "https://" + domain + "/.well-known/caldav"};
			}

			//lowest priority first, among equals by weight (RFC 2782).
			function pick(records) {
				var lowest = Math.min.apply(null, records.map(function (r) { return r.priority; })),
					candidates = records.filter(function (r) { return r.priority === lowest; }),
					total = candidates.reduce(function (sum, r) { return sum + r.weight; }, 0),
					point = Math.random() * total, i;
				for (i = 0; i < candidates.length; i += 1) {
					point -= candidates[i].weight;
					if (point < 0) {
						return candidates[i];
					}
				}
				return candidates[0];
			}

			function next() {
				var service = services.shift(), name;
				if (!service) {
					wellKnown();
					return;
				}
				name = "_" + service + "._tcp." + domain;
				CalDav.dns.resolveSrv(name, function (error, records) {
					var record = !error && records && records.length ? pick(records) : undefined;
					if (!record || !record.name || record.name === ".") { //"." says: no such service here.
						next();
						return;
					}
					CalDav.dns.resolveTxt(name, function (txtError, texts) {
						var path = "/.well-known/" + service.replace(/s$/, "");
						(txtError ? [] : texts || []).forEach(function (text) {
							var parts = (/^path=(\/.*)$/).exec([].concat(text).join(""));
							if (parts) {
								path = parts[1];
							}
						});
						future.result = {returnValue: true, url: "https://" + record.name.replace(/\.$/, "") + ":" + record.port + path};
					});
				});
			}

			next();
			return future;
		},

		dns: dns,

		/**
		 * Tells if two hrefs name the same resource.
		 */
		samePath: function (a, b) {
			return comparablePath(a) === comparablePath(b);
		},

		/**
		 * Sends delete request to the server.
		 * @param params usual param object with path, credentials, ...
		 * @param obj, with uri and etag fields.
		 * @return future which will cotain uri member with old uri for reference.
		 */
		deleteObject: function (params, obj) {
			var future = new Future(), options = preProcessOptions(params, "DELETE", obj.uri);

			//prevent overriding remote changes.
			if (obj.etag) {
				options.headers["If-Match"] = obj.etag;
			}

			future.nest(httpClient.sendRequest(options, ""));

			return future;
		},

		/**
		 * Puts an object to server.
		 * @param params usual param object with path, credentials, ...
		 * @param obj, the obj to send to the server, with uri, etag and data fields
		 * @return future, if server delivers etag in response, it will be delivered in result.etag
		 */
		putObject: function (params, obj) {
			var future = new Future(), options = preProcessOptions(params, "PUT", obj.uri);
			options.headers["Content-Type"] = "text/calendar; charset=utf-8";
			if (params.cardDav) {
				options.headers["Content-Type"] = "text/vcard; charset=utf-8";
			}

			//prevent overriding remote changes.
			if (obj.etag) {
				options.headers["If-Match"] = obj.etag;
			} else {
				options.headers["If-None-Match"] = "*";
			}

			future.nest(httpClient.sendRequest(options, obj.data));

			return future;
		},

		/**
		 * Discovers folders for contacts and calendars.
		 * @param params usual param object with path, credentials, ...
		 * @return future, result.folders will contain array folders with
		 *                  folder objects containing uri and resource = contact/calendar/task
		 */
		discovery: function (params) {
			var future = new Future(), options = preProcessOptions(params, "PROPFIND"), data, homes = [], folders = { subFolders: {} }, folderCB,
				tryFolders = [], principals = [];

			function searchNextHome() {
				var next = homes.shift();
				Log.log_calDavDebug("Getting folders from ", next.path);
				params.cardDav = next.cardDav;
				params.path = next.path;
				future.nest(CalDav.getFolders(params));
				future.then(folderCB);
			}

			function getHomeCB(addressbook, index) {
				var result = checkResult(future), home, homeSetKey, found = [];
				if (result.returnValue === true) {
					homeSetKey = addressbook ? "addressbook-home-set" : "calendar-home-set";
					//the property can hold several homes, RFC 4791 section 6.2.1.
					found = getHrefs(getKeyValueFromResponse(result.parsedBody, homeSetKey)).map(function (href) {
						return absoluteUrl(href, options.prefix);
					});
					home = found[0];
					if (!home) {
						Log.log("Could not get ", (addressbook ? "addressbook" : "calendar"), " home folder.");
					} else {
						Log.log_calDavDebug("Got ", (addressbook ? "addressbook" : "calendar"), "-home: ", found);
					}
				} else {
					//error, stop, return failure.
					Log.log("Error in getHomeCB: ", result);
				}

				if (!home) {
					if (index < tryFolders.length) {
						Log.log_calDavDebug("Trying to ask for ", (addressbook ? "addressbook" : "calendar"), "-home-set on next url: ", tryFolders[index], " index: ", index);
						changePath(options, params.userAuth, tryFolders[index]);
						future.nest(httpClient.sendRequest(options, data));
						future.then(function () {
							getHomeCB(addressbook, index + 1);
						});
						return;
					}

					Log.log_calDavDebug("Tried all folders. Will try to get ", (addressbook ? "addressbook" : "calendar"), " folders from original url.");
					home = params.originalUrl;
					found = [home];
				}

				found.forEach(function (path) {
					var known = homes.some(function (entry) {
						return entry.path === path;
					});
					if (!known) {
						homes.push({path: path, cardDav: addressbook});
					}
				});

				if (!addressbook) {
					data = "<d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:carddav\"><d:prop><c:addressbook-home-set/></d:prop></d:propfind>";
					options.headers.Depth = 0;
					folders.calendarHome = home;
					folders.calendarHomes = found;
					changePath(options, params.userAuth, tryFolders[0]);
					future.nest(httpClient.sendRequest(options, data));
					future.then(function () {
						getHomeCB(true, 1);
					}); //calendar done, start with addressbook
				} else {
					folders.addressbookHome = home;
					folders.addressbookHomes = found;
					searchNextHome();
				}
			}

			function principalCB(index) {
				var result = checkResult(future), principal;
				if (result.returnValue === true) {
					principal = getKeyValueFromResponse(result.parsedBody, "current-user-principal");
					if (principal) {
						principal = getHrefs(principal)[0];
						Log.log_calDavDebug("Got principal: ", principal);
						if (principal) {
							principal = absoluteUrl(principal, options.prefix);
							Log.log_calDavDebug("Adding: ", principal);
							generateMoreTestPaths(principal, principals);
						}
					}
				} else {
					//error, stop, return failure.
					Log.log("Error in getPrincipal: ", result);
				}

				if (index < tryFolders.length) {
					changePath(options, params.userAuth, tryFolders[index]);
					future.nest(httpClient.sendRequest(options, data));
					future.then(function () {
						principalCB(index + 1);
					});
				} else {
					if (principals.length === 0) {
						Log.log("Could not get any principal at all.");
					}

					//prepare home folder search:
					options.headers.Depth = 0;
					data = "<d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><c:calendar-home-set/></d:prop></d:propfind>";

					//reorder array, so that principal folders are tried first:
					tryFolders = principals.concat(tryFolders);

					changePath(options, params.userAuth, tryFolders[0]);
					future.nest(httpClient.sendRequest(options, data));
					future.then(function () {
						getHomeCB(false, 1);
					});
				}
			}

			//some folders to probe for:
			//push original URL to test-for-home-folders.
			generateMoreTestPaths(params.originalUrl, tryFolders);
			httpClient.parseURLIntoOptions(params.originalUrl, options); //set prefix for the well-known tries. This is ok here, because request is never send.
			generateMoreTestPaths(options.prefix + "/.well-known/caldav", tryFolders);
			generateMoreTestPaths(options.prefix + "/.well-known/carddav", tryFolders);

			//first get user principal:
			options.parse = true;
			changePath(options, params.userAuth, tryFolders[0]);
			options.headers.Depth = 0;
			data = "<d:propfind xmlns:d=\"DAV:\"><d:prop><d:current-user-principal /></d:prop></d:propfind>";
			future.nest(httpClient.sendRequest(options, data));
			future.then(function () {
				principalCB(1);
			});

			folderCB = function () {
				var result = checkResult(future), i, f, fresult = [], key;
				if (result.returnValue === true) {
					//prevent duplicates by URI.
					for (i = 0; i < result.folders.length; i += 1) {
						f = result.folders[i];
						folders.subFolders[f.uri] = f;
					}
				} else {
					Log.log("Error during folder-search: ", result);
				}

				if (homes.length > 0) { //if we still have unsearched home-foders, search them:
					searchNextHome();
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
						calendarHomes: folders.calendarHomes,
						contactHome: folders.addressbookHome,
						contactHomes: folders.addressbookHomes
					};
				}
			};

			return future;
		},

		/**
		 * Gets folders below uri. Can filter for addressbook, calendar or tasks.
		 * @param params object with required params, like path and credentials
		 * @param filter optional filter for addressbook, calendar or tasks
		 * @return future, result.folders will contain array folders
		 */
		getFolders: function (params, filter) {
			var data, attempt = 0;

			data = "<d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:resourcetype /><d:displayname /><c:supported-calendar-component-set /></d:prop></d:propfind>";
			if (params.cardDav) {
				data = "<d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:carddav\"><d:prop><d:resourcetype /><d:displayname /></d:prop></d:propfind>";
			}

			function listFolders() {
				var future = new Future(), options = preProcessOptions(params, "PROPFIND");

				options.headers.Depth = 1;
				options.parse = true;
				future.nest(httpClient.sendRequest(options, data));

				future.then(function foldersCB() {
					var result = checkResult(future), delay = FOLDER_RETRY_DELAYS[attempt];
					if (result.returnValue === true && (!isMultistatus(result.parsedBody) || !parseResponseBody(result.parsedBody).length)) {
						//Not an answer from a DAV server, no conclusions about folders from this.
						Log.log("Folder listing is not a multistatus.");
						future.result = {returnValue: false, returnCode: result.returnCode};
					} else if (result.returnValue === true) {
						future.result = {
							returnValue: true,
							folders: getFolderList(result.parsedBody, filter, options.prefix)
						};
					} else if (TEMPORARY_SERVER_ERRORS.indexOf(result.returnCode) >= 0 && delay !== undefined) {
						attempt += 1;
						Log.log("Server answered ", result.returnCode, " to the folder listing, trying again in ", delay, "ms.");
						setTimeout(function () {
							future.nest(listFolders());
						}, delay);
					} else {
						Log.log("Error during getFolders: ", result);
						future.result = result;
					}
				});

				return future;
			}

			return listFolders();
		},

		/**
		 * Gets the folders of several home collections.
		 * @param params object with required params, path is replaced for each home
		 * @param homes array of home urls
		 * @param filter optional filter for addressbook, calendar or tasks
		 * @return future, result.folders has the folders of all homes; failure if one home failed,
		 *         because folders missing from the result count as deleted.
		 */
		getFoldersOfHomes: function (params, homes, filter) {
			var future = new Future(), all = [], remaining = homes.slice();

			function next() {
				if (!remaining.length) {
					future.result = {returnValue: true, folders: all};
					return;
				}
				params.path = remaining.shift();
				future.nest(CalDav.getFolders(params, filter));
				future.then(function homeCB() {
					var result = checkResult(future);
					if (result.returnValue !== true) {
						future.result = result;
						return;
					}
					result.folders.forEach(function (folder) {
						if (!all.some(function (known) { return known.uri === folder.uri; })) {
							all.push(folder);
						}
					});
					next();
				});
			}

			next();
			return future;
		},

		/**
		 * Allows to test the folder parsing without network activity
		 * @param body the xml-parsed body object.
		 * @return array of folder objects
		 */
		testFolderParsing: function (body) {
			return getFolderList(body);
		}
	};
}());

module.exports = CalDav;
