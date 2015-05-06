/*
 * SyncAssistant
 * Description: Handles the remote to local data conversion for CalDav and CardDav
 */
/*jslint nomen: true, node: true */
/*global Log, Class, Sync, Kinds, Future, CalDav, DB, PalmCall, Activity, checkResult, libPath */
/*exported SyncAssistant */

var vCard = require(libPath + "vCard.js");
var ETag = require(libPath + "ETag.js");
var ID = require(libPath + "ID.js");
var SyncKey = require(libPath + "SyncKey.js");
var CalendarEventHandler = require(libPath + "CalendarEventHandler.js");
var SyncStatus = require(libPath + "SyncStatus.js");

var SyncAssistant = Class.create(Sync.SyncCommand, {
	run: function run(outerfuture, subscription) {
		"use strict";
		var args = this.controller.args || {}, future = new Future(), accountId = args.accountId, errorOut, processCapabilities;

		this.recreateActivitiesOnComplete = true;

		if (!args.capability) {
			SyncStatus.setRunning(this.client.clientId);
			errorOut = function (msg) {
				Log.log(msg);
				SyncStatus.setStatus("Error: " + msg);
				SyncStatus.setDone(this.client.clientId);
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
				SyncStatus.setDone(this.client.clientId);
				outerfuture.result = result;
			});
		} else {
			if (args.syncOnEdit) {
				SyncStatus.setRunning(this.client.clientId);
			}
			//we have a capability, run usual sync
			this.SyncKey = new SyncKey(this.client, this.handler);

			this.$super(run)(future);
			future.then(this, function syncCameBackCB() {
				var result = checkResult(future);
				Log.debug("Sync came back: ", result);
				if (args.syncOnEdit) {
					SyncStatus.setDone(this.client.clientId);
				}
				outerfuture.result = result;
			});
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
		var prefix;

		this.SyncKey.forEachFolder(kindName, function (folder) {
			if (folder.collectionId === id) {
				prefix = folder.uri;
			}
		});

		if (!prefix) {
			Log.debug("No prefix found for collectionId: ", id);
			prefix = this.SyncKey.getFolder(kindName, 0).uri;
		}
		this.params.path = prefix;
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

				if (!obj) {
					Log.log("ERROR: Incomming undefined!!", from, " = ", to);
				}

				//populate to object with data from event:
				for (key in obj) {
					if (obj.hasOwnProperty(key) && obj[key] !== undefined) { // && obj[key] !== null) {
						to[key] = obj[key];
					}
				}

				if (obj && obj._id && !obj._kind) {
					obj._kind = Kinds.objects[kindName].id;
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
					to.remoteId = ID.uriToRemoteId(from.uri, this.client.config);
				}

				//overwrite preventSync flag on download.
				if (to.preventSync) {
					to.preventSync = false;
				}

				return from.obj;
			};
		}

		if (name === "local2remote") {
			Log.debug("==========================> allowUpsync: ", Kinds.objects[kindName].allowUpsync, " for ", kindName);
			if (Kinds.objects[kindName].allowUpsync) { //configure upsync via kinds.js
				return function (to, from) { //i.e. will be called with remote / local. Issue: Also does not wait for a callback, no real conversion here.
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
							from.uid = from.uid || from.uId;
							delete from.uId;
						}

						if (from.uid) {
							to.uid = from.uid;
						} else {
							to.uid = from.remoteId;
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
	 * This is used for remote <> local mapping. For CalDav/CardDav we use the URI as remote ID.
	 * In CalDav RFC it is said that UID would be the remote ID, but at the same time URI for an
	 * object is unique and does never change during it's lifetime. So we can use that as remote ID,
	 * also. The big benefit is that we get the URI for free with etag check, but getting the UID
	 * means getting the whole dataset -> not so nice for mobile data connections!
	 */
	getRemoteId: function (obj, kindName) {
		"use strict";
		if (obj.remoteId) {
			return obj.remoteId; //use uri, it is unique and constant.
		}
		if (obj.uri && (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name)) {
			obj.remoteId = ID.uriToRemoteId(obj.uri, this.client.config);
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
	 * This function should return a future which populates its results with entries: [] -> an
	 * array of objects that have changed on the server. For that we check the etag values.
	 * Additionally the future.result can have a more-member, if that is truthy, the method will
	 * be called again. That way changes can be delivered in batches.
	 * Might be a good idea for memory saving... not quite sure how to do that for caldav/carddav.
	 */
	getRemoteChanges: function (state, kindName) {
		"use strict";
		Log.log("\n\n**************************SyncAssistant:getRemoteChanges*****************************");
		var path, future = new Future();

		this.SyncKey.setKindName(kindName);

		if (!this.SyncKey.getConfig()) {
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

		if (!this.blacklist) {
			this.blacklist = [];
		}

		this.params = {
			userAuth: this.client.userAuth,
			path: path,
			blacklist: this.blacklist,
			ignoreSSLCertificateErrors: this.client.config.ignoreSSLCertificateErrors,
			authCallback: this.client.config.authCallback
		};

		this.SyncKey.prepare(kindName, state);

		Log.log("State: ", state, " for kind ", kindName);
		if (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name) {
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

		SyncStatus.setRunning(this.client.clientId, kindName);
		if (!home) {
			SyncStatus.setStatus(this.client.clientId, kindName, "Need discovery");
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

			future.nest(this.SyncKey.saveErrorState(kindName)); //set error state, so if something goes wrong, we'll do a check of all objects next time.
		});

		future.then(this, function saveTransportCB() {
			checkResult(future); //will always be true.
			future.nest(ETag.getLocalEtags(kindName, this.client.clientId));
		});

		future.then(this, function handleLocalFolders() {
			Log.log("---------------------->handleLocalFolders()");
			var result = checkResult(future);
			if (result.returnValue === true) {
				localFolders = result.results;

				//now get remote folders
				this.params.path = home;
				Log.debug("Getting remote collections for ", kindName, " from ", home, ", filtering for ", filter);
				if (kindName === Kinds.objects.contact.name || kindName === Kinds.objects.contactset.name) {
					this.params.cardDav = true;
				} else {
					this.params.cardDav = false;
				}
				future.nest(CalDav.getFolders(this.params, filter));
			} else {
				Log.log("Could not get local folders.");
				SyncStatus.setDone(this.client.clientId, kindName);
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
					if (localFolders.length === 0) {
						Log.log("Remote did not supply folders in listing. Using home URL as fall back.");
						SyncStatus.setStatus(this.client.clientId, kindName, "Did not find folders, syncing home folder directly.");
						SyncStatus.setDone(this.client.clientId, kindName);
						rFolders.push({
							name: "Home",
							uri: home,
							remoteId: home
						});
					} else {
						Log.log("Could not get remote folders. Skipping down sync.");
						future.result = {
							more: false,
							entries: []
						};
						return future;
					}
				}

				entries = ETag.parseEtags(rFolders, localFolders, this.currentCollectionId, this.SyncKey, "uri");

				//if collection changed, we also need to sync from different folders.
				//update the config here.
				future.nest(this._updateCollectionsConfig(kindName, rFolders));

				//wait till updateCollectionsConfig is finished, because this might delete all entries of a kind.
				future.then(this, function updateConfigCB() {
					checkResult(future);
					SyncStatus.setStatus(this.client.clientId, kindName, "Folder changes processed.");
					future.result = {
						more: false,
						entries: entries //etags will be undefined for both. But that is fine. Just want to compare uris.
					};

					this.client.transport.syncKey[kindName].error = false; //if we reached here, then there were no errors.
					SyncStatus.setDone(this.client.clientId, kindName);
				});
			} else {
				Log.log("Could not get remote collection. Skipping down sync.");
				SyncStatus.setDone(this.client.clientId, kindName);
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
		var future = new Future(),
			index = this.SyncKey.folderIndex(kindName),
			folder = this.SyncKey.currentFolder(kindName);

		if (!folder || !folder.uri) {
			Log.log("No folder for index ", index, " in ", kindName);
			if (!this.SyncKey.hasMoreFolders(kindName)) {
				SyncStatus.setDone(this.client.clientId, kindName);
			}
			future.result = {
				more: this.SyncKey.hasMoreFolders(kindName),
				entries: []
			};
			this.SyncKey.nextFolder(kindName);
			return future;
		}

		//if we had error during folder sync or previous folders, cancel sync here.
		if (this.SyncKey.hasError(kindName)) {
			SyncStatus.setDone(this.client.clientId, kindName);
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
		folder.downloadsFailed = false; //reset that flag here.

		SyncStatus.setRunning(this.client.clientId, kindName);
		future.nest(this.SyncKey.saveErrorState(kindName)); //set error state, so if something goes wrong, we'll do a check of all objects next time.

		future.then(this, function saveTransportCB() {
			checkResult(future); //will always be true.
			Log.debug("Starting sync for ", folder.name);
			SyncStatus.setStatus(this.client.clientId, kindName, "Syncing " + folder.name);
			future.nest(this._initCollectionId(kindName));
		});
		future.then(this, function () {
			var result = checkResult(future);

			if (!result.returnValue) {
				Log.log("No local id for ", folder.name, ". Stopping sync for this folder.");
				future.result = {needsUpdate: false};
				return;
			}

			if (folder.entries &&
					folder.entries.length > 0) {
				//trigger download directly.
				folder.forceEtags = true;
				future.result = {needsUpdate: true};
			} else {
				this.params.ctag = folder.ctag || 0;
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

					//general cleanup:
					//this is required here to let next getRemoteChanges not run into error-case.
					this.client.transport.syncKey[kindName].error = false;

					delete this.collectionIds; //reset this for orphaned checks.

					if (!result.more) {
						Log.debug("Sync for folder ", folder.name, " finished.");
						this.SyncKey.nextFolder(kindName);
						result.more = this.SyncKey.hasMoreFolders(kindName);
						if (!this.SyncKey.hasMoreFolders(kindName)) {
							SyncStatus.setDone(this.client.clientId, kindName);
						}
					}

					//if downloads failed or had error -> check etags next time, again.
					folder.ctag = 0;
					if (!result.error && !folder.downloadsFailed) {
						//all went well, save ctag to fastly determine if sync is necessary at all
						folder.ctag = ctag;
					}

					if (result.error) {
						Log.log("Error in _doUpdate, returning empty set.");
						result.entries = [];
					}

					future.result = result;
				});
			} else {
				//we don't need an update, tell sync engine that we are finished.
				Log.log("Don't need update. Return empty set.");
				SyncStatus.setStatus(this.client.clientId, kindName, "No update needed.");
				this.client.transport.syncKey[kindName].error = false;
				this.SyncKey.nextFolder(kindName);
				if (!this.SyncKey.hasMoreFolders(kindName)) {
					SyncStatus.setDone(this.client.clientId, kindName);
				}
				future.result = {
					more: this.SyncKey.hasMoreFolders(kindName),
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
			remoteFolder, change = false, future = new Future(), deleteFuture = new Future(), outerFuture = new Future(), toBeDeleted = [];

		folders = this.client.transport.syncKey[subKind].folders;

		for (i = 0; i < remoteFolders.length; i += 1) {
			remoteFolder = remoteFolders[i];
			folder = ETag.findMatch(remoteFolder.uri, folders, "uri");

			if (!folder) { //folder not found -> need to add.
				Log.debug("Need to add remote folder: ", remoteFolder);
				folders.push({remoteId: remoteFolder.uri, uri: remoteFolder.uri, name: remoteFolder.name});
				change = true;
			} else { //found remote folder
				if (folder.name !== remoteFolder.name) {
					folder.name = remoteFolder.name;
				}
			}
		}

		for (i = folders.length - 1; i >= 0; i -= 1) {
			folder = folders[i];
			remoteFolder = ETag.findMatch(folder.uri, remoteFolders, "uri");

			if (!remoteFolder) { //folder not found -> need to delete.
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
				deleteFuture.result = {returnValue: true};
			}
		}

		deleteContent(toBeDeleted);

		//now save config:
		if (change) {
			deleteFuture.then(this, function deleteCB() {
				checkResult(deleteFuture);
				deleteFuture.nest(this.SyncKey.saveErrorState(subKind)); //trigger slow sync for subKind because of collection changes.
				delete this.collectionIds; //reset this for orphaned checks.
			});

			deleteFuture.then(this, function saveCB() {
				checkResult(deleteFuture);
				outerFuture.result = {returnValue: true};
			});
		} else {
			outerFuture.result = {returnValue: true};
		}

		return outerFuture;
	},

	/*
	 * Initializes the collectionId for subKinds (i.e. calendarevent and contacts) from local database.
	 */
	_initCollectionId: function (kindName) {
		"use strict";
		var future = new Future(),
			uri = this.SyncKey.currentFolder(kindName).uri,
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
					this.SyncKey.currentFolder(kindName).collectionId = dbFolder._id;
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
			future.result = {returnValue: true, etags: []}; //emulate empty remote etags -> will delete all local objects for this collection.
		} else {
			entries = this.SyncKey.currentFolder(kindName).entries;
			if (entries && entries.length > 0) {
				Log.log("Had changes remaining from last doUpdate call: ", entries);
				Log.log("Starting download.");
				future.nest(this._downloadData(kindName, entries, 0));
				return future;
			} else {
				//download etags and trigger next callback
				entries = [];
				future.nest(CalDav.downloadEtags(this.params));
			}
		}

		future.then(this, function handleRemoteEtags() {
			Log.log("---------------------->handleRemoteEtags()");
			var result = checkResult(future), i;
			if (result.returnValue === true) {
				remoteEtags = result.etags;
				for (i = 0; i < remoteEtags.length; i += 1) {
					remoteEtags[i].remoteId = ID.uriToRemoteId(remoteEtags[i].uri, this.client.config);
				}
				future.nest(ETag.getLocalEtags(kindName, this.client.clientId));
			} else {
				Log.log("Could not download etags. Reason: ", result);
				future.result = { returnValue: false, exception: result.exception };
			}
		});

		future.then(this, function handleLocalEtags() {
			var result = checkResult(future);
			Log.log("---------------------->handleLocalEtags()");
			if (result.returnValue === true) {
				future.result = {
					returnValue: true,
					localEtags: result.results,
					remoteEtags: remoteEtags
				};
			} else {
				Log.log("Could not get local etags, reason: ", result.exception);
				Log.log("Result: ", result);
				future.result = {
					returnValue: false,
					localEtags: [],
					remoteEtags: remoteEtags
				};
			}
		});

		//check local etags against remote ones:
		future.then(this, function handleEtagResponse() {
			Log.log("---------------------->hanleEtagResponse()");

			var result = checkResult(future), retries = [], i;
			if (result.returnValue !== true) {
				Log.log("Something in getting etags went wrong: ", result.exception);
				Log.log("Aborting with no downsync.");
				future.result = {
					error: true
				};
			} else {
				Log.debug("Folder: ", this.SyncKey.currentFolder(kindName).uri);
				entries = ETag.parseEtags(result.remoteEtags, result.localEtags, this.currentCollectionId, this.SyncKey);
				this.SyncKey.currentFolder(kindName).entries = entries;

				for (i = entries.length - 1; i >= 0; i -= 1) {
					if (entries[i].doRetry) {
						delete entries[i].doRetry;
						entries[i].uploadFailed = entries[i].uploadFailed ? entries[i].uploadFailed + 1 : 1;
						retries.push(entries[i]);
						entries.splice(i, 1);
					}
				}

				SyncStatus.setDownloadTotal(this.client.clientId, kindName, entries.length);
				if (retries.length > 0) {
					future.nest(DB.merge(retries));
				} else {
					Log.debug("No retries necessary.");
					future.result = {returnValue: true, retried: 0};
				}
			}
		});

		future.then(this, function retryTriggerCB() {
			var result = checkResult(future);
			Log.debug("Trigger retries returned: ", result);
			//now download object data and transfer it into webos datatypes.
			future.nest(this._downloadData(kindName, entries, 0));
		});
		return future;
	},

	/*
	 * downloads data for each element and transfers it into webos object
	 * this method is called recursively.
	 * the future returns when all downloads are finished.
	 */
	_downloadData: function (kindName, entries, entriesIndex) {
		"use strict";
		var future = new Future(), resultEntries, needEtags;

		if (entriesIndex < entries.length && entriesIndex < 10) {
			if (entries[entriesIndex].doDelete || entries[entriesIndex].alreadyDownloaded) { //no need to download for deleted entry, skip.
				SyncStatus.downloadedOne(this.client.clientId, kindName);
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
							future.nest(CalendarEventHandler.parseICal(result.data));
						} else if (kindName === Kinds.objects.contact.name) {
							Log.debug("Starting vCard conversion");
							future.nest(vCard.parseVCard({account: { name: this.client.config.name,
																		kind: Kinds.objects[kindName].id, account: this.client.clientId },
																		vCard: result.data}));
						} else {
							throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
						}

						future.then(this, function conversionCB() {
							var result = checkResult(future), obj;
							if (result.returnValue === true) {
								Log.log("Object ", entriesIndex, " converted ok. Doing next one.");
								obj = result.result;
								obj.uri = entries[entriesIndex].uri;
								obj.etag = entries[entriesIndex].etag;
								obj.uploadFailed = 0; //reset upload retry flag here, because local changes are overwritten now anyway.

								entries[entriesIndex].collectionId = this.SyncKey.currentFolder(kindName).collectionId;
								entries[entriesIndex].obj = obj;

								if (kindName === Kinds.objects.calendarevent.name) {
									future.nest(CalendarEventHandler.processEvent(entries,
																				  entriesIndex,
																				  ID.uriToRemoteId(entries[entriesIndex].uri,
																								   this.client.config),
																				  result));
								} else {
									future.result = { returnValue: true };
								}
							} else {
								Log.log("Could not convert object ", entriesIndex, " - trying next one. :(");
								this.params.blacklist.push(entries[entriesIndex].uri);
								entries.splice(entriesIndex, 1);
								entriesIndex -= 1;
								future.result = { returnValue: false };
							}
						});

						future.then(this, function () {
							//done with this object, do next one.
							SyncStatus.downloadedOne(this.client.clientId, kindName);
							future.nest(this._downloadData(kindName, entries, entriesIndex + 1));
						});

					} else {
						Log.log("Download of entry ", entriesIndex, " failed... trying next one. :(");
						//413 - Entity too large, allows retry
						//Most of the 500 errors are server issues that might resolve in the future.
						//401 can happen if oauth token runs out.. hm. :-/
						if (result.returnCode >= 400 && result.returnCode !== 413 && result.returnCode < 500 && result.returnCode !== 401) {
							Log.log("Failed with unrecoverable status code ", result.returnCode, " will never retry download.");
						} else {
							Log.debug("Failed with probably recoverable status code ", result.returnCode, " will retry download next sync.");
							this.SyncKey.currentFolder(kindName).downloadsFailed = true;
						}

						entries.splice(entriesIndex, 1);
						SyncStatus.downloadedOne(this.client.clientId, kindName);
						future.nest(this._downloadData(kindName, entries, entriesIndex));
					}
				});
			} //end update
		} else { //entriesIndex >= entries.length -> finished.
			Log.log(entriesIndex, " items received and converted.");
			resultEntries = entries.splice(0, entriesIndex);

			if (entries.length > 0) {
				this.SyncKey.currentFolder(kindName).entries = entries;
			} else {
				this.SyncKey.currentFolder(kindName).entries = undefined;
			}

			//force download of etags, necessary if entries where left from last sync.
			needEtags = entries.length > 0 || !!this.SyncKey.currentFolder(kindName).forceEtags;
			delete this.SyncKey.currentFolder(kindName).forceEtags;
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

		//add this here to also track errors during upsync -> will trigger comparison of all etags on next downsync.
		if (results.length > 0) {
			SyncStatus.setUploadTotal(this.client.clientId, kindName, remoteIds.length);
			SyncStatus.setStatus(this.client.clientId, kindName, "Upload started.");
			SyncStatus.setRunning(this.client.clientId, kindName);
			future.nest(this.SyncKey.saveErrorState(kindName)); //set error state, so if something goes wrong, we'll do a check of all objects next time.

			future.then(this, function saveStateCB() {
				checkResult(future);
				future.result = results;
			});
		} else {
			future.result = results; //imideately resume.
		}

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

		var future = this._putOneRemoteObject(batch[index], kindName), error = false;
		future.then(this, function oneObjectCallback() {
			var result = checkResult(future), rid;

			rid = ID.uriToRemoteId(result.uri, this.client.config);
			Log.debug("Have rid ", rid, " from ", result.uri);

			if (result.returnValue === true) {
				Log.debug("Upload of ", rid, " worked.");
				if (batch[index].local.uploadFailed) {
					batch[index].local.uploadFailed = 0;
				}

				//save those ONLY for successful uploads.
				//save uri and etag in local object.
				batch[index].local.uri = result.uri;
				batch[index].local.etag = result.etag;
				batch[index].local.remoteId = rid;
			} else {
				if (result.noReUpload) {
					Log.log("Upload of ", rid, " failed so hard that reupload won't work. Do not retry.");
					batch[index].local.uploadFailed = 0;
					batch[index].local.etag = "0"; //reset etag to trigger redownload.
					error = true; //make sure full update is done, ctags on server probably won't change.
				} else {
					//keep rid and etag out of db => otherwise object will be deleted on next downsync!
					Log.debug("Upload of ", rid, " failed. Save failure for later.");
					batch[index].local.uploadFailed = batch[index].local.uploadFailed ? batch[index].local.uploadFailed + 1 : 1;
				}
			}

			//save remote id for local <-> remote mapping
			remoteIds[index] = rid;

			SyncStatus.uploadedOne(this.client.clientId, kindName);
			//process next object
			if (index + 1 < batch.length) {
				future.nest(this._processOne(index + 1, batch, kindName));
			} else { //finished, return results.
				future.result = {
					returnValue: !error,
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
		var future = new Future(), self = this;

		//check if URI is present. If not, get URI.
		if (!obj.remote.uri) { //this always happens for new objects and deleted objects.
			if (!obj.remote.add && obj.operation === "save") {
				Log.debug("===================== NO URI FOR CHANGED OBJECT!!");
			}
			ID.findURIofRemoteObject(kindName, obj, this.SyncKey);
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

		if (obj.local.preventSync) {
			Log.log("Prevent sync flag set, skipping upload.");
			future.result = {
				etag: "0", //maybe re-download
				uri: obj.remote.uri,
				returnValue: true
			};
			return future;
		}

		function conversionCB(f) {
			var result = checkResult(f);
			if (result.returnValue === true) {
				obj.remote.data = result.result; //copy vCard/iCal result into obj.

				if (result.uri) {
					obj.remote.uri = result.uri;
				}
				if (result.etag) {
					obj.remote.etag = result.etag;
				}

				if (!obj.remote.uri) {
					Log.log("Did not have uri in converted object. How can that happen?");
					ID.findURIofRemoteObject(kindName, obj, self.SyncKey);
				}

				future.nest(self._sendObjToServer(kindName, obj.remote, obj.local.calendarId));
			} else {
				Log.log("Conversion of ", obj.local, " failed: ", result);
				if (!obj.remote.uri) {
					ID.findURIofRemoteObject(kindName, obj, self.SyncKey);
				}
				//return failure, will count up uploadFailed.
				future.result = {
					uri: obj.remote.uri,
					returnValue: false
				};
			}
		}

		if (obj.operation === "save") {
			if (kindName === Kinds.objects.calendarevent.name) {
				future.nest(CalendarEventHandler.buildIcal(obj.local));
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
					if (result.returnValue !== true) {
						if (result.returnCode === 404) {
							Log.debug("Object not found on server -> do not delete anymore.");
							result.returnValue = true;
						} else {
							Log.log("Could not delete object: ", obj, " -> ", result);
						}
					}
					future.result = result;
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
			var result = checkResult(future), noReUpload = false;
			if (result.returnValue === true) {
				if (result.etag) { //server already delivered etag -> no need to get it again.
					Log.log("Already got etag in put response: ", result.etag);
					future.result = { returnValue: true, uri: result.uri, etags: [{etag: result.etag, uri: result.uri}]};
				} else {
					Log.log("Need to get new etag from server.");
					this.params.path = result.uri;
					if (kindName === Kinds.objects.contact.name || kindName === Kinds.objects.contactset.name) {
						this.params.cardDav = true;
					} else {
						this.params.cardDav = false;
					}
					future.nest(CalDav.downloadEtags(this.params, true));
				}
			} else {
				Log.log("put object failed for ", obj.uri, " with code ", result.returnCode);

				if (result.returnCode === 400 || result.returnCode === 411 || result.returnCode === 420) {
					Log.log("Bad request, please report bug.", result, " for ", obj);
					noReUpload = true;
				} else if ((result.returnCode >= 403 && result.returnCode <= 407) ||
						(result.returnCode >= 409 && result.returnCode <= 412) ||
						(result.returnCode >= 414 && result.returnCode <= 420) ||
						(result.returnCode === 451) ||
						(result.returnCode === 501) ||
						(result.returnCode === 505) ||
						(result.returnCode === 506) ||
						(result.returnCode === 508) ||
						(result.returnCode === 510)) {
					Log.log("Error won't go away, disallow reupload");
					noReUpload = true;
				}

				if (result.returnCode === 412 || result.returnCode === 409) {
					future.result = {returnValue: false, putError: true, msg: "Put object failed, because it was changed on server, too: " + JSON.stringify(result) + " for " + obj.uri, noReUpload: noReUpload };
				} else {
					future.result = {returnValue: false, putError: true, msg: "Put object failed: " + JSON.stringify(result) + " for " + obj.uri, noReUpload: noReUpload };
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
					future.result = { returnValue: false, uri: obj.uri, noReUpload: result.noReUpload };
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
					batch[i].local.etag = "0"; //necessary if etag could not be downloaded.
				}
				batch[i].local._kind = Kinds.objects[kindName].id; //just to be sure it gets to the right DB.
				Log.debug("Telling webos to save: ", batch[i]);
				result.push(batch[i].local);
			}
		}

		SyncStatus.setDone(this.client.clientId, kindName);
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
				//only redo upsync if not in error state

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
					.setPower(true) //prevent narcolepsy
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
				Log.debug("No upsync for ", syncObj.name, ", no SyncOnEdit activity");
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

module.exports = SyncAssistant;
