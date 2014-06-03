/*
 * SyncAssistant
 * Description: Handles the remote to local data conversion for CalDav and CardDav
 */
/*jslint nomen: true */
/*global Log, Class, Sync, Kinds, Future, CalDav, DB, PalmCall, Activity, checkResult, servicePath */
/*exported SyncAssistant */

var url = require("url");   //required to parse urls
var iCal = require(servicePath + "/javascript/utils/iCal.js");
var vCard = require(servicePath + "/javascript/utils/vCard.js");

var SyncAssistant = Class.create(Sync.SyncCommand, {
    run: function run(outerfuture) {
        "use strict";
        var args = this.controller.args || {}, future = new Future(), accountId = args.accountId, errorOut, processCapabilities;

        this.recreateActivitiesOnComplete = true;

        if (!args.capability) {
            errorOut = function (msg) {
                Log.log(msg);
                outerfuture.result = { returnValue: false, success: false, message: msg };
                return outerfuture;
            };

            processCapabilities = function (capabilities, index) {
                var capObj = capabilities[index], outerfuture = new Future(), syncCB;

                syncCB = function (name, future) {
                    var result = checkResult(future);
                    Log.log("Sync came back:", result);
                    future.nest(processCapabilities(capabilities, index + 1));

                    //augment result a bit:
                    future.then(function innerCB() {
                        var innerResult = checkResult(future);

                        //only be a success if all syncs ware a success.
                        innerResult.returnValue = innerResult.returnValue && result.returnValue;
                        innerResult.success = innerResult.returnValue; //this is done, because something tends to overwrite returnValue..
                        innerResult[name] = result;
                        outerfuture.result = innerResult;
                    });
                };

                if (capObj) {
                    if (capObj.capability === "CONTACTS") {
                        PalmCall.call("palm://org.webosports.cdav.service/", "sync", {accountId: accountId, capability: "CONTACTS"}).then(syncCB.bind(this, "contacts"));
                    } else if (capObj.capability === "CALENDAR") {
                        PalmCall.call("palm://org.webosports.cdav.service/", "sync", {accountId: accountId, capability: "CALENDAR"}).then(syncCB.bind(this, "calendar"));
                    } else {
                        Log.log("Unknown capability:", capObj);
                        outerfuture.nest(processCapabilities(capabilities, index + 1));
                    }
                } else {
                    Log.log("Processing capabilities done.");
                    outerfuture.result = { returnValue: true };
                }

                return outerfuture;
            };

            if (accountId) {
                future.nest(PalmCall.call("palm://com.palm.service.accounts", "getAccountInfo", {accountId: accountId}));
            } else {
                return errorOut("No accountId given, no sync possible.");
            }

            future.then(this, function accountInfoCB() {
                var result = checkResult(future), account = result.result || {};
                if (result.returnValue === true) {
                    //Log.debug("Account Info: ", result);
                    if (account.beingDeleted) {
                        this.recreateActivitiesOnComplete = false;
                        return errorOut("Account is being deleted! Not syncing.");
                    }

                    if (account.capabilityProviders) {
                        if (account.capabilityProviders.length === 0) {
                            future.result = {returnValue: true};
                            Log.log("WARNING: No capabilityProviders defined, won't sync anything.");
                        } else {
                            future.nest(processCapabilities(account.capabilityProviders, 0));
                        }
                    } else {
                        this.recreateActivitiesOnComplete = false;
                        return errorOut("No account or capabilityProviders in result: " + JSON.stringify(result));
                    }
                } else {
                    return errorOut("Could not get account info: " + JSON.stringify(result));
                }
            });

            future.then(this, function syncsCB() {
                var result = checkResult(future);
                Log.log("All syncs done, returning.");
                outerfuture.result = result;
            });
        } else {
            //we have a capability, run usual sync
            this.$super(run)(outerfuture);
        }

        return outerfuture;
    },

        /*
     * Return an array of strings identifying the object types for synchronization, in the correct order.
     */
    getSyncOrder: function () {
        "use strict";
        return this.client.kinds.syncOrder;
    },

    /*
     * Return an array of "kind objects" to identify object types for synchronization
     * This will normally be an object with property names as returned from getSyncOrder, with structure like this:
     */
    getSyncObjects: function () {
        "use strict";
        return this.client.kinds.objects;
    },

    /*
     * Return the ID string for the capability (e.g., CALENDAR, CONTACTS, etc.)
     * supported by the sync engine as specified in the account template (e.g.,
     * com.palm.calendar.google, com.palm.contacts.google, etc.).  This is used
     * to provide automatic sync notification support.
     */
    getCapabilityProviderId: function () {
        "use strict";
        return "CALENDAR, CONTACTS, TASKS";
    },

    _uriToRemoteId: function (uri) {
        "use strict";
        var i;
        if (!uri) {
            return undefined;
        }

        if (this.client.config.preventDuplicateCalendarEntries) {
            for (i = uri.length - 1; i >= 0; i -= 1) {
                if (uri.charAt(i) === "/") {
                    return uri.substring(i + 1);
                }
            }
        }
        return uri; //fallback
    },

    /*
     * Sets error = true for kindName. Makes sure that object is saved in database.
     */
    _saveErrorState: function (kindName) {
        "use strict";
        this.client.transport.syncKey[kindName].error = true; //trigger "slow" sync.
        this.handler.putAccountTransportObject(this.client.transport).then(function putCB(f) {
            var result = checkResult(f);
            if (!result.length) {
                Log.log("Could not store config object: ", result);
            }
        });
    },

    /*
     * This is needed during upsync. This will become the input for the local2remote transformer
     * on the remote side. We create a new remoteId here and fill the remote object with that.
     */
    getNewRemoteObject: function (kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant: getNewRemoteObject *****************************");
        var postfix, remoteId, result;

        if (kindName === Kinds.objects.calendarevent.name) {
            postfix = ".ics";
        } else if (kindName === Kinds.objects.contact.name) {
            postfix = ".vcf";
        } else {
            //can we create calendars on server? I don't think we'll try very soon.
            throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
        }

        remoteId = "webos-" + Date.now() + postfix; //uses timestamp in miliseconds since 1970
        result = { remoteId: remoteId, add: true };
        return result;
    },

    _setParamsFromCollectionId: function (kindName, id) {
        "use strict";
        var prefix, i;
        for (i = 0; i < this.client.transport.syncKey[kindName].folders.length; i += 1) {
            if (this.client.transport.syncKey[kindName].folders[i].collectionId === id) {
                prefix = this.client.transport.syncKey[kindName].folders[i].uri;
                break;
            }
        }
        if (!prefix) {
            Log.debug("No prefix found for collectionId: ", id);
            prefix = this.client.transport.syncKey[kindName].folders[0].uri;
        }
        this.params.path = prefix;
    },

    /*
     * This method is used to find the correct URI from a local/remote object pair.
     */
    _findURIofRemoteObject: function (kindName, obj) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant: _findURIofRemoteObject *****************************");
        var uri, prefix, remoteId, i;

        if (!obj) {
            obj = { local: {}, remote: {} };
        }

        uri = obj.local.uri;
        if (!uri) {

            //get the URL of a addressbook or calendar.
            if (obj.local.calendarId) {
                for (i = 0; i < this.client.transport.syncKey[kindName].folders.length; i += 1) {
                    if (this.client.transport.syncKey[kindName].folders[i].collectionId === obj.local.calendarId) {
                        prefix = this.client.transport.syncKey[kindName].folders[i].uri;
                        break;
                    }
                }
            }

            if (!prefix) {
                //if no collection, use first folder. This should not happen. But it happened due to bug with calendar-deletion.
                Log.debug("Had no folder for collectionId ", obj.local.calendarId);
                prefix = this.client.transport.syncKey[kindName].folders[0].uri;
                obj.local.calendarId = this.client.transport.syncKey[kindName].folders[0].collectionId;
            }

            prefix = url.parse(prefix).pathname || "/";

            if (prefix.charAt(prefix.length - 1) !== "/") {
                prefix += "/";
            }

            //if we already have a remoteId somewhere, keep it.
            if (obj.remote.remoteId) {
                remoteId = obj.remote.remoteId;
            } else if (obj.local.remoteId) {
                remoteId = obj.local.remoteId;
            }

            if (!remoteId) {
                //generate a "random" uri.
                remoteId = this.getNewRemoteObject();
            }

            //we assume that getNewRemoteObject() was called before and did not create a full URI remote id.
            uri = prefix + remoteId;
        } else {
            remoteId = obj.local.remoteId;
            if (!remoteId) {
                remoteId = this._uriToRemoteId(uri);
            }
        }

        obj.remote.uri = uri;
        if (this.client.config.preventDuplicateCalendarEntries) {
            obj.remote.remoteId = remoteId;
            obj.local.remoteId = remoteId;
        } else {
            obj.remote.remoteId = uri;
            obj.local.remoteId = uri;
        }
        obj.local.uri = uri;
        obj.local.uId = remoteId;
    },

    /*
     * Tells sync engine the transformation type.    remote2local or local2remote
     */
    getTransformer: function (name, kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant: getTransformer*****************************");
        if (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name) {
            return this._getObjectTransformer(name, kindName);
        }

        if (kindName === Kinds.objects.calendar.name || kindName === Kinds.objects.contactset.name) {
            if (name === "remote2local") {
                return function (to, from) {
                    to.accountId = this.client.clientId;
                    to.excludeFromAll = false;
                    to.isReadOnly = !Kinds.objects[Kinds.objects[kindName].connected_kind].allowUpsync; //issue: if that changes, we'll have to recreate calendars
                    to.name = from.name;
                    to.syncSource = "cdav";
                    to.remoteId = from.remoteId || from.uri;
                    to.uri = from.uri;

                    return true; //notify of changes.
                }.bind(this);
            }
            //can only downsync calendars.
            return undefined;
        }

        throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
    },

    /*
     * No callbacks are possible here, a result is expected immediately. So we need to have get the object data
     * with the "getRemoteChanges" anyway and do the transformation into an webOS object there already.
     * If we would want to use common iCal/vCard libraries, one might want to use the Json.Transformer here to
     * translate the fields into webos fields.
     */
    _getObjectTransformer: function (name, kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant:_getObjectTransformer*****************************");

        if (name === "remote2local") {
            return function (to, from) {
                Log.log("\n\n**************************SyncAssistant:_remote2local*****************************");
                var key, obj = from.obj;

                //populate to object with data from event:
                for (key in obj) {
                    if (obj.hasOwnProperty(key) && obj[key] !== undefined) { // && obj[key] !== null) {
                        to[key] = obj[key];
                    }
                }

                if (from.collectionId) {
                    Log.debug("Had collectionId: ", from.collectionId);
                    //calendarId is used by webOS. There is no such thing for contacts, yet.
                    //so we call it calendarId for them, too, right now, to prevent code duplication.
                    to.calendarId = from.collectionId;
                }

                to.etag = from.etag;
                to.uri = from.uri;
                if (!to.remoteId) {
                    to.remoteId = this._uriToRemoteId(from.uri);
                }

                return from.obj;
            };
        }

        if (name === "local2remote") {
            if (Kinds.objects[kindName].allowUpsync) { //configure upsync via kinds.js
                return function (to, from) { //i.e. will be called with remote / local. Issue: Also does not wait for a callback => no real conversion here.
                    Log.log("\n\n**************************SyncAssistant:_local2remote*****************************");
                    Log.debug("Transforming ", from);
                    Log.debug("To: ", to);
                    if (!to.add) {
                        if (from.etag) {
                            to.etag = from.etag;
                        }
                        if (from.uri) {
                            to.uri = from.uri;
                        }
                        if (from._id) {
                            to._id = from._id;
                        }
                        if (from.remoteId) {
                            to.remoteId = from.remoteId;
                        }
                        if (from.uId) {
                            to.uId = from.uId;
                        } else {
                            to.uId = from.remoteId;
                        }
                    }

                    Log.debug("Result: ", to);

                    return true;
                };
            }

            //upsync disabled:
            return undefined;
        }

        //we don't do any other syncs
        return undefined;
    },

    /*
     * This is used for remote <=> local mapping. For CalDav/CardDav we use the URI as remote ID.
     * In CalDav RFC it is said that UID would be the remote ID, but at the same time URI for an
     * object is unique and does never change during it's lifetime. So we can use that as remote ID,
     * also. The big benefit is that we get the URI for free with etag check, but getting the UID
     * means getting the whole dataset => not so nice for mobile data connections!
     */
    getRemoteId: function (obj, kindName) {
        "use strict";
        if (obj.remoteId) {
            return obj.remoteId; //use uri, it is unique and constant.
        }
        if (obj.uri && (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name)) {
            obj.remoteId = this._uriToRemoteId(obj.uri);
            return obj.remoteId;
        }

        Log.debug("No remoteId for ", obj);
        throw new Error("--------------> No URI in ob, maybe wrong kind: '" + kindName + "'");
    },

    /*
     * This tells webOs if the object was deleted on the server. If it was not deleted,
     * it is updated locally with remote changes. Also gets kindName param, which we do not need.
     */
    isDeleted: function (obj) {
        "use strict";
        if (obj && obj.doDelete) {
            return true;
        }

        //not deleted
        return false;
    },

    /*
     * This function should return a future which populates its results with entries: [] => an
     * array of objects that have changed on the server. For that we check the etag values.
     * Additionally the future.result can have a more-member, if that is truthy, the method will
     * be called again. That way changes can be delivered in batches.
     * Might be a good idea for memory saving... not quite sure how to do that for caldav/carddav.
     */
    getRemoteChanges: function (state, kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant:getRemoteChanges*****************************");
        var path, key, i, future = new Future();

        //be sure to have an transport object with all necessary fields!
        if (!this.client.transport) {
            this.client.transport = {};
        }

        //prevent crashes during assignments.
        if (!this.client.transport.syncKey) {
            this.client.transport.syncKey = {};
        }

        for (key in Kinds.objects) {
            if (Kinds.objects.hasOwnProperty(key)) {
                if (!this.client.transport.syncKey[Kinds.objects[key].name]) {
                    this.client.transport.syncKey[Kinds.objects[key].name] = {};
                }

                if (!this.client.transport.syncKey[Kinds.objects[key].name].folders) {
                    this.client.transport.syncKey[Kinds.objects[key].name].folders = [];
                }
            }
        }

        if (!this.client.config) {
            Log.log("No config stored. Can't determine URL, no sync possible.");
            future.result = {
                returnValue: false,
                more: false,
                entries: []
            };
            return future;
        }

        if (!this.client.userAuth) {
            Log.log("No userAuth information. Something wrong with keystore. Can't authenticate with server.");
            future.result = {
                returnValue: false,
                more: false,
                entries: []
            };
            return future;
        }

        this.params = { authToken: this.client.userAuth.authToken, path: path };

        Log.log("State: ", state, " for kind ", kindName);
        Log.debug("SyncKey: ", this.client.transport.syncKey);
        if (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name) {
            if (state === "first") {
                //reset index:
                this.client.transport.syncKey[kindName].folderIndex = 0;

                // if error on previous sync reset ctag.
                if (this.client.transport.syncKey[kindName].error ||
                        this.client.transport.syncKey[Kinds.objects[kindName].connected_kind].error) {
                    Log.log("Error state in db was true. Last sync must have failed. Resetting ctag to do full sync.");
                    for (i = 0; i < this.client.transport.syncKey[kindName].folders.length; i += 1) {
                        this.client.transport.syncKey[kindName].folders[i].ctag = 0;
                    }
                }

                //clear possibly stored entries from previous syncs:
                for (i = 0; i < this.client.transport.syncKey[kindName].folders.length; i += 1) {
                    delete this.client.transport.syncKey[kindName].folders[i].entries;
                }

                Log.debug("Modified SyncKey: ", this.client.transport.syncKey[kindName]);

                //reset error. If folders had error, transfer error state to content.
                this.client.transport.syncKey[kindName].error = this.client.transport.syncKey[Kinds.objects[kindName].connected_kind].error;
            }
            future.nest(this._getRemoteChanges(state, kindName));
        } else if (kindName === Kinds.objects.calendar.name || kindName === Kinds.objects.contactset.name) {
            future.nest(this._getRemoteCollectionChanges(state, kindName));
        } else {
            throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
        }

        return future;

    },

    /*
     * Get remote changes in calendars.. i.e. if calendars were removed or added.
     */
    _getRemoteCollectionChanges: function (state, kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant:_getRemoteCollectionChanges*****************************");
        var future = new Future(),
            subKind = Kinds.objects[kindName].connected_kind,
            home = this.client.config[subKind] ? this.client.config[subKind].homeFolder : undefined,
            filter = (kindName === Kinds.objects.calendar.name) ? "calendar" : "contact",
            localFolders;

        if (!home) {
            Log.debug("Need to get home folders first, doing discovery.");
            future.nest(PalmCall.call("palm://org.webosports.cdav.service/", "discovery", {accountId: this.client.clientId, id: this.client.transport._id}));
        } else {
            future.result = {returnValue: true}; //don't need to do discovery, tell futures to go on.
        }

        future.then(this, function discoveryCB() {
            var result = checkResult(future);
            if (result.success === true) {
                this.client.config = result.config;
                if (result.config[subKind]) {
                    home = result.config[subKind].homeFolder;
                }
            }

            if (!home) {
                Log.log("Discovery was not successful. No calendar / addressbook home. Trying to use URL for that.");
                home = this.client.config.url;
            }

            this._saveErrorState(kindName); //set error state, so if something goes wrong, we'll do a check of all objects next time.

            future.nest(this._getLocalEtags(kindName));
        });

        future.then(this, function handleLocalFolders() {
            Log.log("---------------------->handleLocalFolders()");
            var result = checkResult(future);
            if (result.returnValue === true) {
                localFolders = result.results;

                //now get remote folders
                this.params.path = home;
                Log.debug("Getting remote collections for ", kindName, " from ", home, ", filtering for ", filter);
                future.nest(CalDav.getFolders(this.params, filter));
            } else {
                Log.log("Could not get local folders.");
                future.result = {
                    returnValue: false,
                    more: false,
                    entries: []
                };
            }
        });

        future.then(this, function handleRemoteFolders() {
            Log.log("---------------------->handleRemoteFolders()");
            var result = checkResult(future), rFolders = result.folders, entries;

            if (result.returnValue === true) {
                Log.debug("Got ", rFolders, " remote folders, comparing them to ", localFolders, " local ones.");
                if (rFolders.length === 0) {
                    Log.log("Remote did not supply folders in listing. Using home URL as fall back.");
                    rFolders.push({
                        name: "Home",
                        uri: home,
                        remoteId: home
                    });
                }

                entries = this._parseEtags(rFolders, localFolders, "uri");

                //if collection changed, we also need to sync from different folders.
                //update the config here.
                future.nest(this._updateCollectionsConfig(kindName, rFolders));

                //wait till updateCollectionsConfig is finished, because this might delete all entries of a kind.
                future.then(this, function updateConfigCB() {
                    checkResult(future);
                    future.result = {
                        more: false,
                        entries: entries //etags will be undefined for both. But that is fine. Just want to compare uris.
                    };

                    this.client.transport.syncKey[kindName].error = false; //if we reached here, then there were no errors.
                });
            } else {
                Log.log("Could not get remote collection. Skipping down sync.");
                future.result = {
                    more: false,
                    entries: []
                };
            }
        });

        return future;
    },

    /*
     * First checks ctag of collection, then checks etag of single entries.
     * If it changed, we also get the object and transfer it into webos datatype,
     * because that is not possible later.
     * ctag and etag is the same for caldav and carddav. Changes are only with objects.
     */
    _getRemoteChanges: function (state, kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant:_getRemoteChanges*****************************");
        var future = new Future(), folders = this.client.transport.syncKey[kindName].folders,
            index = this.client.transport.syncKey[kindName].folderIndex || 0,
            nextIndex = index + 1, //just for convinience
            folder = folders[index];

        if (!folder || !folder.uri) {
            Log.log("No folder for index ", index, " in ", kindName);
            future.result = {
                more: nextIndex < folders.length,
                entries: []
            };
            this.client.transport.syncKey[kindName].folderIndex = nextIndex;
            return future;
        }

        //if we had error during folder sync or previous folders, cancel sync here.
        if (this.client.transport.syncKey[kindName].error === true) {
            Log.log("We are in error state. Stop sync and return empty set.");
            future.result = { more: false, entries: [] };
            return future;
        }

        this.params.path = folder.uri;
        if (kindName === Kinds.objects.contact.name || kindName === Kinds.objects.contactset.name) {
            this.params.cardDav = true;
        } else {
            this.params.cardDav = false;
        }

        this._saveErrorState(kindName); //set error state, so if something goes wrong, we'll do a check of all objects next time.

        Log.debug("Starting sync for ", folder.name);
        future.nest(this._initCollectionId(kindName));
        future.then(this, function () {
            if (folder.entries &&
                    folder.entries.length > 0) {
                //trigger download directly.
                folder.forceEtags = true;
                future.result = {needsUpdate: true};
            } else {
                this.params.ctag = this.client.transport.syncKey[kindName].folders[index].ctag || 0;
                future.nest(CalDav.checkForChanges(this.params));
            }
        });

        //called from success callback, if needs update, determine which objects to update
        future.then(this, function handleDoNeedSyncResponse() {
            var result = checkResult(future), ctag = result.ctag;
            Log.debug("------------- Got need update response: ", result.needsUpdate);

            if (result.needsUpdate) {

                //download etags and possibly data
                future.nest(this._doUpdate(kindName, folder));
                future.then(this, function updateCB() {
                    var result = checkResult(future);

                    if (!result.error) {
                        if (!result.more) {
                            Log.debug("Sync for folder ", folder.name, " finished.");
                            this.client.transport.syncKey[kindName].folderIndex = nextIndex;
                            result.more = nextIndex < folders.length;
                        }

                        //save ctag to fastly determine if sync is necessary at all
                        this.client.transport.syncKey[kindName].folders[index].ctag = ctag;

                        //this is required here to let next getRemoteChanges not run into error-case.
                        this.client.transport.syncKey[kindName].error = false;
                        delete this.collectionIds; //reset this for orphaned checks.

                        future.result = result;
                    } else {
                        Log.log("Error in _doUpdate, returning empty set.");
                        future.result = {
                            more: false,
                            entries: []
                        };
                    }
                });
            } else {
                //we don't need an update, tell sync engine that we are finished.
                Log.log("Don't need update. Return empty set.");
                this.client.transport.syncKey[kindName].error = false;
                this.client.transport.syncKey[kindName].folderIndex = nextIndex;
                future.result = {
                    more: nextIndex < folders.length,
                    entries: []
                };
            }
        });

        return future;
    },

    /*
     * Updates the stored config for calendar/addressbook folders from collection changes.
     */
    _updateCollectionsConfig: function (kindName, remoteFolders) {
        "use strict";
        var i, subKind = Kinds.objects[kindName].connected_kind, folders, folder,
            remoteFolder, change = false, future = new Future(), outerFuture = new Future(), toBeDeleted = [];

        folders = this.client.transport.syncKey[subKind].folders;

        for (i = 0; i < remoteFolders.length; i += 1) {
            remoteFolder = remoteFolders[i];
            folder = this._findMatch(remoteFolder.uri, folders, "uri");

            if (!folder) { //folder not found => need to add.
                Log.debug("Need to add remote folder: ", remoteFolder);
                folders.push({remoteId: remoteFolder.uri, uri: remoteFolder.uri, name: remoteFolder.name});
                change = true;
            } else { //found remote folder
                if (folder.name !== remoteFolder.name) {
                    folder.name = remoteFolder.name;
                }
            }
        }

        for (i = 0; i < folders.length; i += 1) {
            folder = folders[i];
            remoteFolder = this._findMatch(folder.uri, remoteFolders, "uri");

            if (!remoteFolder) { //folder not found => need to delete.
                Log.debug("Need to delete local folder ", folder);
                folders.splice(i, 1);

                toBeDeleted.push(folder.collectionId);
                change = true;
            }
        }

        function deleteContent(ids) {
            var id = ids.shift();
            if (id) {
                future.nest(DB.merge(
                    {
                        from: Kinds.objects[subKind].id,
                        where: [{prop: "calendarId", op: "=", val: id}]
                    },
                    {
                        "_del": true,
                        preventSync: true
                    }
                ));

                future.then(function deleteCB() {
                    var result = checkResult(future);
                    Log.debug("Delete all objects returned: ", result);
                    deleteContent(ids);
                });
            } else {
                outerFuture.result = {returnValue: true};
            }
        }

        deleteContent(toBeDeleted);

        //now save config:
        if (change) {
            this._saveErrorState(subKind); //trigger slow sync for subKind because of collection changes.
            delete this.collectionIds; //reset this for orphaned checks.
        }

        return outerFuture;
    },

    /*
     * Gets etags and uris from the db. etags and uris are currently saved together with the
     * database objects (i.e. with the contact or calendarevent).
     * It will return a future wich has the array of { etag, uri } objects as result.results field.
     */
    _getLocalEtags: function (kindName) {
        "use strict";
        var query =
            {
                from: Kinds.objects[kindName].id,
                //we could filter for calendarId here. Issue is that we then get adds, if
                //collections overlap, i.e. if events/contacts are in multiple collections on the server
                //at the same time.
                where: [ { prop: "accountId", op: "=", val: this.client.clientId } ],
                select: ["etag", "remoteId", "_id", "uri", "calendarId"]
            };
        return DB.find(query, false, false);
    },

    /*
     * Initializes the collectionId for subKinds (i.e. calendarevent and contacts) from local database.
     */
    _initCollectionId: function (kindName) {
        "use strict";
        var future = new Future(),
            folderIndex = this.client.transport.syncKey[kindName].folderIndex,
            uri = this.client.transport.syncKey[kindName].folders[folderIndex].uri,
            query = {
                from: Kinds.objects[Kinds.objects[kindName].connected_kind].id,
                where: [ { prop: "remoteId", op: "=", val: uri }, { prop: "accountId", op: "=", val: this.client.clientId } ],
                select: ["_id", "remoteId", "uri"]
            };
        future.nest(DB.find(query, false, false));
        future.then(this, function findCB() {
            var result = checkResult(future), dbFolder;
            if (result.returnValue === true) {
                dbFolder = result.results[0];
                if (dbFolder) {
                    Log.debug("Setting collectionId to ", dbFolder._id, " (", dbFolder.uri, ")");
                    this.client.transport.syncKey[kindName].folders[folderIndex].collectionId = dbFolder._id;
                    this.currentCollectionId = dbFolder._id;
                    future.result = { returnValue: true };
                } else {
                    future.result = { returnValue: false };
                    Log.log("No local id for folder ", uri);
                }
            } else {
                Log.log("Could not get collection ids from local database: ", result.exception);
                future.result = { returnValue: false };
            }
        });

        return future;
    },

    /*
     * Handles download and parsing of etag data and then download of object data.
     */
    _doUpdate: function (kindName, folder) {
        "use strict";
        var future = new Future(), remoteEtags, entries;
        Log.debug("Need update, getting etags from server.");

        if (folder.doDelete) {
            Log.debug("Server wants us to delete this collection. Tell webOS to delete all local entries.");
            future.result = {returnValue: true, etags: []}; //emulate empty remote etags => will delete all local objects for this collection.
        } else {
            entries = this.client.transport.syncKey[kindName].folders[this.client.transport.syncKey[kindName].folderIndex].entries;
            if (entries && entries.length > 0) {
                Log.log("Had changes remaining from last doUpdate call: ", entries);
                Log.log("Starting download.");
                future.nest(this._downloadData(kindName, entries, 0));
                return future;
            }

            //download etags and trigger next callback
            entries = [];
            future.nest(CalDav.downloadEtags(this.params));
        }

        future.then(this, function handleRemoteEtags() {
            Log.log("---------------------->handleRemoteEtags()");
            var result = checkResult(future), i;
            if (result.returnValue === true) {
                remoteEtags = result.etags;
                for (i = 0; i < remoteEtags.length; i += 1) {
                    remoteEtags[i].remoteId = this._uriToRemoteId(remoteEtags[i].uri);
                }
                future.nest(this._getLocalEtags(kindName));
            } else {
                Log.log("Could not download etags. Reason: ", result);
                future.result = { returnValue: false };
            }
        });

        future.then(this, function handleLocalEtags() {
            var result = checkResult(future);
            Log.log("---------------------->handleLocalEtags()");
            if (result.returnValue === true) {
                future.result = { //trigger next then ;)
                    returnValue: true,
                    localEtags: result.results,
                    remoteEtags: remoteEtags
                };
            } else {
                Log.log("Could not get local etags, reason: ", result.exception);
                Log.log("Result: ", result);
                future.result = { //trigger next then ;)
                    returnValue: false,
                    localEtags: [],
                    remoteEtags: remoteEtags
                };
            }
        });

        //check local etags against remote ones:
        future.then(this, function handleEtagResponse() {
            Log.log("---------------------->hanleEtagResponse()");

            var result = checkResult(future);
            if (result.returnValue !== true) {
                Log.log("Something in getting etags went wrong: ", result.exception);
                Log.log("Aborting with no downsync.");
                future.result = {
                    error: true
                };
            } else {
                Log.debug("Folder: ", this.client.transport.syncKey[kindName].folders[this.client.transport.syncKey[kindName].folderIndex].uri);
                entries = this._parseEtags(result.remoteEtags, result.localEtags);
                this.client.transport.syncKey[kindName].folders[this.client.transport.syncKey[kindName].folderIndex].entries = entries;

                //now download object data and transfer it into webos datatypes.
                future.nest(this._downloadData(kindName, entries, 0));
            }
        });
        return future;
    },

    /*
     * Finds an form an array by remoteId.
     * Used for etag directories and collections.
     */
    _findMatch: function (remoteId, objs, key) {
        "use strict";
        var i;
        if (!key) {
            key = "remoteId";
        }
        for (i = 0; i < objs.length; i += 1) {
            if (objs[i][key] === remoteId) {
                objs._macht_index = i; //small hack. But obj is not stored anywhere, so should be fine.
                return objs[i];
            }
        }
    },

    /*
     * Method to test for orphaned objects, i.e. objects not in an existing collection anymore.
     * Hopefully this will be unnecessary sometime in the future, but currently I
     * observe objects not getting deleted if calendar/contactset get's removed.
     * This happens only sometimes. Maybe failure somewhere during sync is involved.
     */
    _isOrphanedEntry: function (l) {
        "use strict";
        var i, j, key, folders;

        if (!this.collectionIds) {
            this.collectionIds = [];
            for (key in Kinds.objects) {
                if (Kinds.objects.hasOwnProperty(key)) {
                    folders = this.client.transport.syncKey[key].folders;
                    for (j = 0; j < folders.length; j += 1) {
                        this.collectionIds.push(folders[j].collectionId);
                    }
                }
            }
        }

        if (l.calendarId) {
            l.doDelete = true;
            for (i = 0; i < this.collectionIds.length; i += 1) {
                if (l.calendarId === this.collectionIds[i]) {
                    l.doDelete = false;
                    break;
                }
            }

            if (l.doDelete) {
                Log.debug(l.remoteId, " seems to be orphaned entry left from collection change. Do delete.");
                return true;
            }
        }
        return false;
    },

    /*
     * just parses the local & remote etag lists and determines which objects to add/update or delete.
     */
    _parseEtags: function (remoteEtags, localEtags, key) {
        "use strict";
        var entries = [], l, r, found, i, stats = {add: 0, del: 0, update: 0, noChange: 0, orphaned: 0};
        Log.log("Got local etags: ", localEtags.length);
        Log.log("Got remote etags: ", remoteEtags.length);

        if (!key) {
            key = "etag";
        }

        //we need update. Determine which objects to update.
        //1. get etags and uris from server.
        //2. get local etags and uris from device db => include deleted!
        //compare the sets.
        //uri only on server => needs to be added
        //uri on server & local, etag same => no (remote) change.
        //uri on server & local, but etag differs => needs to be updated (local changes might be lost)
        //local with uri, but not on server => deleted on server, delete local (local changes might be lost)
        //two local with same uri: delete one..
        for (i = 0; i < localEtags.length; i += 1) {
            l = localEtags[i];
            if (l.remoteId) {

                //filter orphaned entries in different collections.
                if (!this._isOrphanedEntry(l)) {
                    found = false;
                    r = this._findMatch(l.remoteId, remoteEtags);

                    if (r) {
                        if (r.found) {
                            Log.log("Found local duplicate.");
                        } else {
                            found = true;
                            r.found = true;
                            if (l[key] !== r[key]) { //have change on server => need update.
                                entries.push(r);
                                stats.update += 1;
                            } else {
                                stats.noChange += 1;
                            }
                        }
                    }

                    //not found => deleted on server.
                    if (!found) {
                        //only delete if object is in same collection.
                        if (!l.calendarId || l.calendarId === this.currentCollectionId) {
                            l.doDelete = true;
                            stats.del += 1;
                            entries.push(l);
                        }
                    }
                } else {
                    stats.orphaned += 1;
                }
            }
        }

        //find completely new remote objects
        for (i = 0; i < remoteEtags.length; i += 1) {
            r = remoteEtags[i];
            if (!r.found) { //was not found localy, need add!
                stats.add += 1;
                r.add = true;
                entries.push(r);
            }
        }

        Log.log("Got ", entries.length, " remote changes: ", stats);
        return entries;
    },

    /*
     * downloads data for each element and transfers it into webos object
     * this method is called recursively.
     * the future returns when all downloads are finished.
     */
    _downloadData: function (kindName, entries, entriesIndex) {
        "use strict";
        var future = new Future(), resultEntries, fi, needEtags;

        if (entriesIndex < entries.length && entriesIndex < 10) {
            if (entries[entriesIndex].doDelete) { //no need to download for deleted entry, skip.
                future.nest(this._downloadData(kindName, entries, entriesIndex + 1));
            } else {
                //this is currently just a get, should work fine for vCard and iCal alike.
                future.nest(CalDav.downloadObject(this.params, entries[entriesIndex]));

                future.then(this, function downloadCB() {
                    var result = checkResult(future);
                    if (result.returnValue === true) {
                        Log.log("Download of entry ", entriesIndex, " ok. Now converting.");

                        if (kindName === Kinds.objects.calendarevent.name) {
                            //transform recevied iCal to webos calendar object:
                            Log.debug("Starting iCal conversion");
                            future.nest(iCal.parseICal(result.data, {serverId: "" }));
                        } else if (kindName === Kinds.objects.contact.name) {
                            Log.debug("Starting vCard conversion");
                            future.nest(vCard.parseVCard({account: { name: this.client.config.name,
                                                                        kind: Kinds.objects[kindName].id, account: this.client.clientId },
                                                                        vCard: result.data}));
                        } else {
                            throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
                        }

                        future.then(this, function conversionCB() {
                            var result = checkResult(future), obj, fi = this.client.transport.syncKey[kindName].folderIndex;
                            if (result.returnValue === true) {
                                Log.log("Object ", entriesIndex, " converted ok. Doing next one.");
                                obj = result.result;
                                obj.uri = entries[entriesIndex].uri;
                                obj.etag = entries[entriesIndex].etag;
                                entries[entriesIndex].collectionId = this.client.transport.syncKey[kindName].folders[fi].collectionId;
                                entries[entriesIndex].obj = obj;
                            } else {
                                Log.log("Could not convert object ", entriesIndex, " - trying next one. :(");
                            }

                            //done with this object, do next one.
                            future.nest(this._downloadData(kindName, entries, entriesIndex + 1));
                        });

                    } else {
                        Log.log("Download of entry ", entriesIndex, " failed... trying next one. :(");
                        future.nest(this._downloadData(kindName, entries, entriesIndex + 1));
                    }
                });
            } //end update
        } else { //entriesIndex >= entries.length => finished.
            Log.log(entriesIndex, " items received and converted.");
            resultEntries = entries.splice(0, entriesIndex);

            fi = this.client.transport.syncKey[kindName].folderIndex;
            if (entries.length > 0) {
                this.client.transport.syncKey[kindName].folders[fi].entries = entries;
            } else {
                this.client.transport.syncKey[kindName].folders[fi].entries = undefined;
            }

            //force download of etags, necessary if entries where left from last sync.
            needEtags = entries.length > 0 || this.client.transport.syncKey[kindName].folders[fi].forceEtags;
            delete this.client.transport.syncKey[kindName].folders[fi].forceEtags;
            Log.log(entries.length, " items for next run.");
            future.result = {
                more: needEtags,
                entries: resultEntries
            };
        }

        return future;
    },

    /*
     * Given a set of remote ids, returns a set of remote objects matching those ids.
     * synccomand.js uses this only during downsync in get local changes to get the remote objects.
     * We don't really need that, actually... we create the full remote objects from the local objects
     * and that's it.
     */
    getRemoteMatches: function (remoteIds, kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant:getRemoteMatches*****************************");
        var i, results = [], future = new Future();

        for (i = 0; i < remoteIds.length; i += 1) {
            Log.debug("remoteId[", i, "] =", remoteIds[i]);
            results.push({remoteId: remoteIds[i]});
        }

        //add this here to also track errors during upsync => will trigger comparison of all etags on next downsync.
        if (results.length > 0) {
            this._saveErrorState(kindName); //set error state, so if something goes wrong, we'll do a check of all objects next time.
        }

        future.result = results;
        return future;
    },

    /*
     * This is called during upsync to put objects on the server.
     * Currently it is called for each object seperately.
     * Nonetheless batch is an array and should be handled as such.
     * Every object in batch has an "operation" member, which is
     * either "save" or "delete" and "remote" and "local" members,
     * which already did got into the local2remote transform.
     * So it should be fine to leave local2remote nearly empty and do
     * conversion here, where we can wait for callbacks. :)
     *
     * The future should have an results array which contains
     * the remoteIds of new/changed objects.
     *
     * We also need to store new/changed etags.
     */
    putRemoteObjects:    function (batch, kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant:putRemoteObjects*****************************");
        var future = new Future();

        Log.debug("Batch: ", batch);

        future.nest(this._processOne(0, [], batch, kindName));

        future.then(this, function () {
            var result = checkResult(future);
            Log.debug("Put objects returned, result: ", result);
            //keep possible errors during upsync in database for next sync.
            this.client.transport.syncKey[kindName].error = !result.returnValue;
            future.result = result;
        });

        return future;
    },

    _processOne: function (index, remoteIds, batch, kindName) {
        "use strict";
        Log.log("Processing change ", (index + 1), " of ", batch.length);

        var future = this._putOneRemoteObject(batch[index], kindName);
        future.then(this, function oneObjectCallback() {
            var result = checkResult(future), rid;

            rid = this._uriToRemoteId(result.uri);
            Log.debug("Have rid ", rid, " from ", result.uri);

            if (result.returnValue === true) {
                Log.debug("Upload of ", rid, " worked.");
                if (batch[index].local.uploadFailed) {
                    batch[index].local.uploadFailed = 0;
                }
            } else {
                Log.debug("Upload of ", rid, " failed. Save failure for later.");
                batch[index].local.uploadFailed = 1;
            }

            //save remote id for local <=> remote mapping
            remoteIds[index] = rid;

            //save uri and etag in local object.
            batch[index].local.uri = result.uri;
            batch[index].local.etag = result.etag;
            batch[index].local.remoteId = rid;

            //process next object
            if (index + 1 < batch.length) {
                future.nest(this._processOne(index + 1, batch, kindName));
            } else { //finished, return results.
                future.result = {
                    returnValue: true,
                    results: remoteIds
                };
            }
        });

        return future;
    },

    /*
     * checks if collectionId still exists on device.
     */
    _checkCollectionId: function (kindName, collectionId) {
        "use strict";
        var folders = this.client.transport.syncKey[kindName].folders, i;
        for (i = 0; i < folders.length; i += 1) {
            if (folders[i].collectionId === collectionId) {
                return true;
            }
        }
        return false;
    },

    /*
     * converts object into vCard/iCal and triggers upload to server (if not deleted).
     * if deleted, obj is only deleted on server.
     */
    _putOneRemoteObject: function (obj, kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant:_putOneRemoteObject*****************************");
        var future = new Future();

        //check if URI is present. If not, get URI.
        if (!obj.remote.uri) { //this always happens for new objects and deleted objects.
            if (!obj.remote.add && obj.operation === "save") {
                Log.debug("===================== NO URI FOR CHANGED OBJECT!!");
            }
            this._findURIofRemoteObject(kindName, obj);
        }

        //copy uri and etag over to remote object:
        //this is necessary, because we only put the remoteId into the remote objects
        //we store uri and etag in the local objects, so this is the place to get this information
        if (!obj.remote.uri && obj.local.uri) {
            obj.remote.uri = obj.local.uri;
        }
        if (!obj.remote.etag && obj.local.etag) {
            obj.remote.etag = obj.local.etag;
        }
        if (!obj.local.remoteId && obj.remote.remoteId) {
            obj.local.remoteId = obj.remote.remoteId;
        }

        function conversionCB(f) {
            var result = checkResult(f);
            if (result.returnValue === true) {
                obj.remote.data = result.result; //copy vCard/iCal result into obj.
            }

            if (!obj.remote.uri) {
                Log.log("Did not have uri in converted object. How can that happen?");
                SyncAssistant._findURIofRemoteObject(kindName, obj);
            }

            future.nest(SyncAssistant._sendObjToServer(kindName, obj.remote, obj.local.calendarId));
        }

        if (obj.operation === "save") {
            if (kindName === Kinds.objects.calendarevent.name) {
                future.nest(iCal.generateICal(obj.local, {}));
            } else if (kindName === Kinds.objects.contact.name) {
                future.nest(vCard.generateVCard({accountName: this.client.config.name,
                                                contact: obj.local, kind: Kinds.objects[kindName].id}));
            } else {
                throw new Error("Kind '" + kindName + "' not supported in _putOneRemoteObject.");
            }

            //respond to conversion callbacks:
            future.then(this, conversionCB);
        } else if (obj.operation === "delete") {
            //check collectionID, prevents deletion on server if local collection got deleted:
            if (this._checkCollectionId(kindName, obj.local.calendarId)) {
                //send delete request to server.
                this._setParamsFromCollectionId(kindName, obj.local.calendarId);
                future.nest(CalDav.deleteObject(this.params, obj.remote));
                future.then(this, function deleteCB() {
                    var result = checkResult(future);
                    if (result.returnValue === true) {
                        //everything fine, continue.
                        future.result = result;
                    } else {
                        Log.log("Could not delete object: ", obj);
                        future.result = result;
                    }
                });
            } else {
                //send dummy result.
                Log.debug(obj.remote.uri, " not in local collection anymore. Do not delete on server.");
                future.result = {returnValue: true, uri: obj.remote.uri};
            }
        } else {
            throw new Error("Operation '" + obj.operation + "' not supported in _putOneRemoteObject.");
        }
        return future;
    },

    /*
     * uploads one object to the server and gets etag.
     * input is the "remote" object.
     */
    _sendObjToServer: function (kindName, obj, collectionId) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant:_sendObjToServer*****************************");
        var future = new Future();

        this._setParamsFromCollectionId(kindName, collectionId);
        future.nest(CalDav.putObject(this.params, obj));

        future.then(this, function putCB() {
            var result = checkResult(future);
            if (result.returnValue === true) {
                if (result.etag) { //server already delivered etag => no need to get it again.
                    Log.log("Already got etag in put response: ", result.etag);
                    future.result = { returnValue: true, uri: result.uri, etags: [{etag: result.etag, uri: result.uri}]};
                } else {
                    Log.log("Need to get new etag from server.");
                    this.params.path = result.uri; //this already is the complete URL.
                    future.nest(CalDav.downloadEtags(this.params));
                }
            } else {
                Log.log("put object failed for ", obj.uri);
                //before I did throw an error here. This prevented the sync from finishing and triggered upsync for this object on
                //next occasion... if we only return an error here, probably we loose local changes.
                //issue is that on error code 412 (i.e. something changed on server on this object) sync will NEVER finish
                //and always will be triggered.
                if (result.returnCode === 412) {
                    future.result = {returnValue: false, putError: true, msg: "Put object failed, because it was changed on server, too: " + JSON.stringify(result) + " for " + obj.uri };
                } else {
                    future.result = {returnValue: false, putError: true, msg: "Put object failed: " + JSON.stringify(result) + " for " + obj.uri };
                }
            }
        });

        future.then(this, function eTagCB() {
            var result = checkResult(future);
            if (result.returnValue === true && result.etags && result.etags.length >= 1) {
                Log.log("Got updated etag.");
                future.result = { returnValue: true, uri: obj.uri, etag: result.etags[0].etag };
            } else {
                if (!result.putError) { //put was ok, only etag issue, let downsync solve that.
                    Log.log("Get etag failed for ", obj.uri);
                    future.result = { returnValue: true, uri: obj.uri, etag: "0" };
                } else { //put also failed, tell _processOne to store a failed upload.
                    future.result = { returnValue: false, uri: obj.uri };
                }
            }
        });

        return future;
    },

    /*
     * Will be called after synccommand is finished. Will write local changes to db. i.e. save etags of updated objects,
     * so that we do not redownload them imideately.
     * Should return an array of objects that need to get written to db.
     */
     //disabled because  sync patch for stable upload breaks produces endless loop if postPutRemoteModify is used.
    //re-enabled, because it is necessary for us to track remote changes. Will fix the patch..
    postPutRemoteModify: function (batch, kindName) {
        "use strict";
        Log.log("\n\n**************************SyncAssistant:postPutRemoteModify*****************************");
        var result = [], future = new Future(), i;

        for (i = 0; i < batch.length; i += 1) {
            if (batch[i].operation === "save" && batch[i].local.remoteId && batch[i].local._id) {
                if (!batch[i].local.etag) {
                    batch[i].local.etag = "0";
                }
                batch[i].local._kind = Kinds.objects[kindName].id; //just to be sure it gets to the right DB.
                Log.debug("Telling webos to save: ", batch[i]);
                result.push(batch[i].local);
            }
        }

        future.result = result;
        return future;
    },


    /*
     * Helper function that creats syncOnEdit Activities for all Kind objects from upSyncs.
     * Returns a future that will return after all work is done.
     */
    _buildSyncOnEditActivity: function (upSyncs, index) {
        "use strict";
        var syncObj = upSyncs[index], future = new Future(),
            rev, name, queryParams, activity;

        if (!syncObj) {
            future.result = { returnValue: true};
        } else {
            if (syncObj.allowUpsync && (!this.client.transport.syncKey[syncObj.name] || !this.client.transport.syncKey[syncObj.name].error)) {
                //only redo upsync if not in error state?

                rev = this.client.transport.modnum;
                name = "SyncOnEdit:" + this.controller.service.name + ":" + this.client.clientId + ":" + syncObj.name;
                queryParams = {
                    query: {
                        from: syncObj.id,
                        where: [
                            {prop: "accountId", op: "=", val: this.client.transport.accountId},
                            {prop: "_rev", op: ">", val: rev}
                        ],
                        incDel: true
                    },
                    subscribe: true
                };

                activity = new Activity(name, "Sync On Edit", true)
                    .setUserInitiated(false)
                    .setExplicit(true)
                    .setPersist(true)
                    .setReplace(true)
                    .setRequirements({ internetConfidence: "fair" })
                    .setTrigger("fired", "palm://com.palm.db/watch", queryParams)
                    .setCallback("palm://" + this.controller.service.name + "/" + this.controller.config.name,
                                 { accountId: this.client.clientId });
                future.nest(activity.start());

                future.then(this, function startCB() {
                    var result = checkResult(future);
                    Log.debug("Activity ", name, " Start result: ", result);
                    future.result = { returnValue: true };
                });
            } else {
                Log.debug("No upsync for ", syncObj.name, " => no SyncOnEdit activity");
                future.result = { returnValue: true };
            }

            future.then(this, function startCB() {
                checkResult(future);
                future.nest(this._buildSyncOnEditActivity(upSyncs, index + 1));
            });
        }

        return future;
    },

    //Overwriting stuff from synccommand.js in mojo-sync-framework, because it can not handle multiple kinds. :(
    complete: function (activity) {
        "use strict";

        var syncActivity, outerFuture = new Future(), future = new Future(),
            syncObjects = this.getSyncObjects(), kindName, upSyncs = [],
            args = this.controller.args;
        Log.log("CDav-Completing activity ", activity.name);

        //handle sync on edit acitivities:
        if (this.recreateActivitiesOnComplete && args.capability) { //only create sync on edit activities for inner service calls
            for (kindName in syncObjects) {
                if (syncObjects.hasOwnProperty(kindName)) {
                    upSyncs.push(syncObjects[kindName]);
                }
            }

            future.nest(this._buildSyncOnEditActivity(upSyncs, 0));

            future.then(this, function syncOnEditCB() {
                Log.debug("All sync on edit creation came back.");
                future.result = true;
            });
        } else {
            Log.debug("Not creating sync-on-edit activities, because no capability in args: ", args);
            future.result = true;
        }

        future.then(this, function completeDoneCB(future) {
            checkResult(future);
            // this.recreateActivitiesOnComplete will be set to false when
            // the sync command is run while the capability is disabled
            // This is a little messy
            if (!this.recreateActivitiesOnComplete || args.capability) {
                Log.log("CDav-complete(): skipping creating of sync activities");
                activity.complete().then(this, function () {
                    Log.log("Complete came back.");
                    future.result = true;
                });
            } else {
                future.nest(this.getPeriodicSyncActivity());

                future.then(this, function getPeriodicSyncActivityCB() {
                    var restart = false, f;
                    syncActivity = checkResult(future);
                    if (activity._activityId === syncActivity.activityId) {
                        Log.log("Periodic sync. Restarting activity");
                        restart = true;
                    } else {
                        Log.log("Not periodic sync. Completing activity");
                    }
                    if (this._hadLocalRevisionError) { //no clue, comes from mojoservice-sync-framework so we will keep this here.
                        restart = true;
                        this._hadLocalRevisionError = false;
                    }

                    f = activity.complete(restart);
                    if (f) {
                        future.nest(f);
                    } else {
                        Log.log("Completing activity failed.");
                        future.result = {returnValue: true};
                    }
                });

                future.then(this, function completeCB(future) {
                    Log.debug("Complete succeeded, result = ", checkResult(future));
                    outerFuture.result = true;
                }, function completeErrorCB(future) {
                    Log.log("Complete FAILED, exception = ", future.exception);
                    outerFuture.result = false;
                });
            }
        });

        return outerFuture;
    }
});
