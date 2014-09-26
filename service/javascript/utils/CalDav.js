/*global Log, httpClient, Future, checkResult, servicePath */

var AuthManager = require(servicePath + "/javascript/utils/AuthManager.js");

var CalDav = (function () {
    "use strict";

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
                    if(typeof obj[f] === "string") {
                        return decodeURIComponent(obj[f]);
                    } else {
                        return obj[f];
                    }
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

    function processStatus(stat) {
        Log.log_calDavParsingDebug("Processing stat: ", stat);
        if (stat.length >= 0) {
            if (stat.length !== 1) {
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
            href: getValue(getValue(res, "href"), "$t"),
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
                stat = prop = responses[i].propstats[j].status || {};
                prop = responses[i].propstats[j].prop || {};
                if (stat.indexOf("404") >= 0) {
                    Log.log_calDavDebug("Prop ", prop, " not found on server. During search for ", searchedKey, ". Skipping.");
                    continue;
                }
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

    function getETags(body, blacklisted) {
        var responses = parseResponseBody(body), i, j, prop, key, eTags = [], etag, found = false;

        function checkBlacklist(b) {
            if (responses[i].href === b) {
                Log.debug("Filtering etag ", responses[i].href, " from blacklist.");
                found = true;
            }
        }

        for (i = 0; i < responses.length; i += 1) {
            for (j = 0; j < responses[i].propstats.length; j += 1) {
                prop = responses[i].propstats[j].prop;
                for (key in prop) {
                    if (prop.hasOwnProperty(key)) {
                        Log.log_calDavParsingDebug("Comparing ", key, " to getetag.");
                        if (key.toLowerCase().indexOf("getetag") >= 0) {
                            etag = getValue(prop[key], "$t");
                        }
                    }
                }
                if (etag) { //add found etags with uri
                    if (blacklisted) { //filter for possibly blacklisted strings
                        found = false;
                        blacklisted.forEach(checkBlacklist);
                    }
                    if (!found) {
                        eTags.push({etag: etag, uri: responses[i].href});
                    }
                }
            }
        }
        Log.log_calDavDebug("Etag directory: ", eTags.length);
        return eTags;
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

            if (!filter || folder.resource === filter) {
                if (folder.uri.toLowerCase().indexOf("http") !== 0) {
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
                    "User-Agent": "org.webosports.cdav-connector"
                }
            };

        httpClient.parseURLIntoOptions(params.path, options); //fill prefix and stuff.
        changePath(options, params.userAuth, path);
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
            var options = preProcessOptions(params, "PROPFIND"), future = new Future(), data;

            options.headers.Depth = 0;
            data = "<d:propfind xmlns:d=\"DAV:\"><d:prop><d:current-user-principal /></d:prop></d:propfind>";

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

            //seems to be identical for caldav and carddav. RFC of carddav does not talk about this.
            data = "<d:propfind xmlns:d=\"DAV:\" xmlns:cs=\"http://calendarserver.org/ns/\">";
            data += "<d:prop>";
            data += "<d:displayname />";
            data += "<cs:getctag />";
            data += "</d:prop>";
            data += "</d:propfind>";

            future.nest(httpClient.sendRequest(options, data));

            future.then(function () {
                var result = checkResult(future), ctag;
                if (result.returnValue) {
                    ctag = getKeyValueFromResponse(result.parsedBody, "getctag");
                    if (ctag) {
                        ctag = getValue(ctag, "$t");
                    } else {
                        ctag = false;
                    }
                } else {
                    Log.log("Could not receive ctag.");
                }
                Log.log_calDavDebug("New ctag: ", ctag, ", old ctag: ", params.ctag);
                future.result = { success: result.returnValue, needsUpdate: !ctag || ctag !== params.ctag, ctag: ctag };
            });

            return future;
        },

        /**
         * Downloads etags from all childs of a directory
         * @param params usual param object with path, credentials, ...
         * @return future result.etags will contain the etag directory of uri<=>etag objects
         */
        downloadEtags: function (params) {
            var options = preProcessOptions(params, "REPORT"), future = new Future(), data, date = new Date(), startVal, blacklist = params.blacklist || [];
            options.headers.Depth = 1;
            options.parse = true;

            //maybe add sensible timerange here: <C:time-range start="20040902T000000Z" end="20040903T000000Z"/>
            //be sure to not delete local objects that are beyond that timerange! ;)
            startVal = String(date.getUTCFullYear() - 1) + (date.getUTCMonth() < 9 ? "0" : "") + String(date.getUTCMonth() + 1) + (date.getUTCDate() < 10 ? "0" : "") + String(date.getUTCDate()) + "T000000Z";

            data = "<?xml version=\"1.0\" encoding=\"utf-8\" ?><c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:getetag /></d:prop><c:filter><c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\"><c:time-range start=\"" + startVal + "\" /></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";
            if (true || params.cardDav) {
                //no filtering required for contacts, i.e. do propfind request.
                options.method = "PROPFIND";
                options.headers.Authorization = AuthManager.getAuthToken("PROPFIND", params.userAuth, options.path);
                data = "<?xml version=\"1.0\" encoding=\"utf-8\" ?><D:propfind xmlns:D=\"DAV:\"><D:prop><D:getetag/></D:prop></D:propfind>";
            }

            future.nest(httpClient.sendRequest(options, data));

            future.then(function () {
                var result = checkResult(future), etags;
                if (result.returnValue) {
                    etags = getETags(result.parsedBody, blacklist);
                    future.result = { returnValue: true, etags: etags };
                } else {
                    future.result = { returnValue: false, exception: result };
                    Log.log("Could not get eTags.");
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
            options.headers["Content-Type"] = "text/calendar; charset=utf-8";
            if (params.cardDav) {
                options.headers["Content-Type"] = "text/vcard; charset=utf-8";
            }

            future.nest(httpClient.sendRequest(options, ""));

            future.then(function () {
                var result = checkResult(future);
                future.result = { returnValue: result.returnValue, data: result.body };
            });

            return future;
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

            function getHomeCB(addressbook, index) {
                var result = checkResult(future), home;
                if (result.returnValue === true) {
                    //look for either calendar- or addressbook-home-set :)
                    home = getValue(getValue(getKeyValueFromResponse(result.parsedBody, "-home-set", true), "href"), "$t");
                    if (!home) {
                        Log.log("Could not get ", (addressbook ? "addressbook" : "calendar"), " home folder.");
                    } else {
                        Log.log_calDavDebug("Original home: ", home);
                        if (home.indexOf("http") === 0) {
                            Log.log_calDavDebug("Home already complete?");
                        } else {
                            Log.log("Augmenting home...");
                            home = options.prefix + home;
                        }
                        Log.log_calDavDebug("Got ", (addressbook ? "addressbook" : "calendar"), "-home: ", home);
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
                }

                if (homes.length > 0 && homes[0] === home) {
                    Log.log_calDavDebug("Homes identical, ignore second one.");
                } else {
                    homes.push(home);
                }

                if (!addressbook) {
                    data = "<d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:carddav\"><d:prop><c:addressbook-home-set/></d:prop></d:propfind>";
                    options.headers.Depth = 0;
                    folders.calendarHome = home;
                    changePath(options, params.userAuth, tryFolders[0]);
                    future.nest(httpClient.sendRequest(options, data));
                    future.then(function () {
                        getHomeCB(true, 1);
                    }); //calendar done, start with addressbook
                } else {
                    folders.addressbookHome = home;
                    //start folder search and consume first folder.
                    Log.log_calDavDebug("Getting folders from ", homes[0]);
                    params.cardDav = false;
                    params.path = homes.shift();
                    future.nest(CalDav.getFolders(params));
                    future.then(folderCB);
                }
            }

            function principalCB(index) {
                var result = checkResult(future), principal;
                if (result.returnValue === true) {
                    principal = getKeyValueFromResponse(result.parsedBody, "current-user-principal", true);
                    if (principal) {
                        principal = getValue(getValue(principal, "href"), "$t");
                        Log.log_calDavDebug("Got principal: ", principal);
                        if (principal) {
                            if (principal.indexOf("http") < 0) {
                                principal = options.prefix + principal;
                            }
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
                    Log.log_calDavDebug("Getting folders from ", homes[0]);
                    params.cardDav = true; //bad hack.
                    params.path = homes.shift();
                    future.nest(CalDav.getFolders(params));
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

        /**
         * Gets folders below uri. Can filter for addressbook, calendar or tasks.
         * @param params object with required params, like path and credentials
         * @param filter optional filter for addressbook, calendar or tasks
         * @return future, result.folders will contain array folders
         */
        getFolders: function (params, filter) {
            var future = new Future(), options = preProcessOptions(params, "PROPFIND"), data, folders;

            options.headers.Depth = 1;
            options.parse = true;

            data = "<d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:resourcetype /><d:displayname /><c:supported-calendar-component-set /></d:prop></d:propfind>";
            if (params.cardDav) {
                data = "<d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:carddav\"><d:prop><d:resourcetype /><d:displayname /></d:prop></d:propfind>";
            }
            future.nest(httpClient.sendRequest(options, data));

            future.then(this, function foldersCB() {
                var result = checkResult(future);
                if (result.returnValue === true) {
                    folders = getFolderList(result.parsedBody, filter, options.prefix);
                    future.result = {
                        returnValue: true,
                        folders: folders
                    };
                } else {
                    Log.log("Error during getFolders: ", result);
                    future.result = result;
                }
            });

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
