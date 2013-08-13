/*
 * SyncAssistant
 * Description: Handles the remote to local data conversion for CalDav and CardDav
 */
/*global debug, log, Class, Sync, feedURLContacts, feedURLCalendar, Kinds, Future, CalDav, Assert, iCal, vCard, DB */
 
var SyncAssistant = Class.create(Sync.SyncCommand, {
	/*
	 * Return an array of strings identifying the object types for synchronization, in the correct order.
	 */
	getSyncOrder: function () {
		//log("\n\n**************************SyncAssistant: getSyncOrder*****************************");
		return Kinds.syncOrder;
	},

	/* 
	 * Return an array of "kind objects" to identify object types for synchronization
	 * This will normally be an object with property names as returned from getSyncOrder, with structure like this:
	 */
	getSyncObjects: function () {
		//log("\n\n**************************SyncAssistant: getSyncObjects*****************************");
		return Kinds.objects;
	},
	
	_uriToRemoteId: function (uri) {
		var i;
		for (i = uri.length - 1; i >= 0; i -= 1) {
			if (uri.charAt(i) === '/') {
				return uri.substring(i+1);
			}
		}
		return uri; //fallback
	},
	
	/*
	 * This is needed during upsync. This will become the input for the local2remote transformer
	 * on the remote side... I think we just return an empty object with a new uri here. 
	 * Also I am not sure if we really need to download remote objects in getRemoteMatches... shouldn't it be
	 * sufficient to just generate the ical/vcard?
	 * I guess that is the case as long as we can handle all fields... :)
	 */
	getNewRemoteObject: function(kindName) {
		log("\n\n**************************SyncAssistant: getNewRemoteObject*****************************");
		var postfix, uri, prefix, remoteId;
		if (kindName === Kinds.objects.calendarevent.name) {
			postfix = ".ics";
			prefix = "/egroupware/groupdav.php/Achim/calendar/";
		} else if (kindName === Kinds.objects.contact.name) {
			postfix = ".vcf";
			prefix = "/egroupware/groupdav.php/Achim/addressbook/";
		} else {
			//can we create calendars on server? I don't think we'll try very soon.
			throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
		}

		//generate a random uri.
		remoteId = "webos-" + Date.now() + postfix; //uses timestamp in miliseconds since 1970 
		uri = prefix + remoteId;
		return { uri: uri, remoteId: remoteId, add: true };
	},

	/*
	 * Tells sync engine the transformation type.	remote2local or local2remote	
	 */
	getTransformer: function (name, kindName) {
		log("\n\n**************************SyncAssistant: getTransformer*****************************");
		if (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name) {
			return this._getObjectTransformer(name, kindName);
		}
		
		if (kindName === Kinds.objects.calendar.name || kindName === Kinds.objects.contactset.name) {
			if (name === "remote2local") {
				return function(to, from) {					
					to.accountId = this.client.clientId;
					to.color = "purple"; //yes, I'm purple. :P
					to.excludeFromAll = false;
					to.isReadOnly = from.isReadOnly; //we might want to get that from webdav?
					to.name = from.name;
					to.syncSource = "CalDav";
					to.remoteId = from.uri;
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
		log("\n\n**************************SyncAssistant:_getObjectTransformer*****************************");

		if (name === "remote2local") {
			//this is down-sync - create transformer object
			//var transformer = new Json.Transformer(this._templates.calendar.remote2local);
			return function (to, from) {
				var key, obj = from.obj;
				
				//populate to object with data from event:
				for (key in obj) {
					if (obj.hasOwnProperty(key) && obj[key] !== undefined && obj[key] !== null) {
						to[key] = obj[key];
						//log("Copied event[" + key + "] = " + to[key]);
					}
				}
				
				if (from.collectionId) {
					//this will also set "calendarId" of contacts to their collection. Don't really care here.
					debug("Had collectionId: " + from.collectionId);
					to.calendarId = from.collectionId;
				}
				
				to.etag = from.etag;
				to.uri = from.uri;
				if (!to.remoteId) {
					to.remoteId = this._uriToRemoteId(from.uri);
				}
				
				debug("Converting from " + JSON.stringify(from));
				debug("Converted to: " + JSON.stringify(to));
				
				return from.obj; //transformer.transformAndMerge(to, from);
			};
		}
		
		//try calendar upsync:
		this.client.upsyncEnabled = kindName === Kinds.objects.calendarevent.name;
		if (name === "local2remote") {
			if (this.client.upsyncEnabled) {
				return function (to, from) { //i.e. will be called with remote / local. Issue: Also does not wait for a callback. Hm.
					//empty method. Work will be done later.
					debug("Transforming " + JSON.stringify(from));
					to.etag = from.etag;
					to.uri = from.uri;
					to._id = from._id;
					
					debug("Result: " + JSON.stringify(to));
					
					return true;
				};			
			}
			
			//upsync disabled:
			return undefined;	//TODO: make upsync more robust. For now disabled. Issues
								//- might kill server data => have a backup ;)
								//- if upsync crashes, local changes never make it to server (webos acts quite stupid here, actually)
								//- also if upsync has connection issues, this will be an issue. Will the google-sync patches help here?
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
		//log("\n\n**************************SyncAssistant:getRemoteID*****************************");
		
		if (obj.remoteId) {
			return obj.remoteId; //use uri, it is unique and constant.
		}
		if (obj.uri && (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name)) {
			obj.remoteId = this._uriToRemoteId(obj.uri);
			return obj.remoteId;
		}
		
		debug("No remoteId for " + JSON.stringify(obj));
		throw new Error("--------------> No URI in ob, maybe wrong kind: '" + kindName + "'");
	},
	
	/*
	 * This tells webOs if the object was deleted on the server. If it was not deleted, 
	 * it is updated locally with remote changes.
	 */
	isDeleted: function (obj, kindName) {
		//log("\n\n**************************SyncAssistant:isDeleted*****************************");

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
		log("\n\n**************************SyncAssistant:getRemoteChanges*****************************");
		var path, key, i;
		
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
		
		if (this.client.transport && this.client.transport.config) {
			debug("Initializing CalDav connector for " + this.client.transport.config.url);
			path = CalDav.setHostAndPort(this.client.transport.config.url);
		} else {
			throw new Error("No config stored. Can't determine URL, no sync possible.");
		}
		
		if (!this.client.userAuth) {
			throw new Error("No userAuth information. Something wrong with keystore. Can't authenticate with server.");
		}
		
		this.params = { authToken: this.client.userAuth.authToken, path: path };
		
		if (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name) {
			if (state === "first") {
				//reset index:
				this.client.transport.syncKey[kindName].folderIndex = 0;
				
				// if error on previous sync reset ctag.
				if (this.client.transport.syncKey[kindName].error) {
					for (i = 0; i < this.client.transport.syncKey[kindName].folders.length; i += 1) {
						this.client.transport.syncKey[kindName].ctag = 0;
					}
				}
				
				//reset error. If folders had error, transfer error state to content.
				this.client.transport.syncKey[kindName].error = this.client.transport.syncKey[Kinds.objects[kindName].connected_kind].error;
			}
			return this._getRemoteChanges(state, kindName);
		}
		if (kindName === Kinds.objects.calendar.name || kindName === Kinds.objects.contactset.name) {
			return this._getRemoteCollectionChanges(state, kindName);
		}
		
		throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
	},
	
	/*
	 * Get remote changes in calendars.. i.e. if calendars were removed or added.
	 */
	_getRemoteCollectionChanges: function (state, kindName) {
		log("\n\n**************************SyncAssistant:_getRemoteCollectionChanges*****************************");
		var future = new Future(), 
			subKind = Kinds.objects[kindName].connected_kind,
			home = this.client.transport.config[subKind].homeFolder, 
			filter = (kindName === Kinds.objects.calendar.name) ? "calendar" : "contact",
			localFolders;
		
		debug("Getting remote collections for " + kindName + " from " + home + ", filtering for " + filter);
		
		this.client.transport.syncKey[kindName].error = true;
		future.nest(this._getLocalEtags(kindName));
		future.then(this, function handleLocalFolders() {
			log("---------------------->handleLocalFolders()");
			var result = future.result;
			if (result.returnValue === true) {
				localFolders = result.results;
				
				//now get remote folders
				future.nest(CalDav.getFolders(this.params, home, filter));
			} else {
				log("Could not get local folders.");
				throw new Error("Could not get local etags for " + kindName);
			}
		});
		
		future.then(this, function handleRemoteFolders() {
			log("---------------------->handleRemoteFolders()");
			var result = future.result, rFolders = result.folders, entries;
			
			if (result.returnValue === true) {
				debug("Got " + JSON.stringify(rFolders) + " remote folders, comparing them to " + JSON.stringify(localFolders) + " local ones.");
				entries = this._parseEtags(rFolders, localFolders, "uri");
				future.result = {
					more: false,
					entries: entries //etags will be undefined for both. But that is fine. Just want to compare uris.
				};

				//if collection changed, we also need to sync from different folders.
				//update the config here.
				this._updateConfig(kindName, entries);
				this.client.transport.syncKey[kindName].error = false; //if we reached here, then there were no errors.
			} else {
				log("Could not get remote collection. Skipping down sync.");
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
		log("\n\n**************************SyncAssistant:_getRemoteChanges*****************************");
		var future = new Future(), folders = this.client.transport.syncKey[kindName].folders, 
			index = this.client.transport.syncKey[kindName].folderIndex || 0,
			nextIndex = index + 1, //just for convinience
			folder = folders[index];
		
		if (!folder) {
			log("No folder for index " + index + " in " + kindName);
			future.result = {
				more: nextIndex < folders.length,
				entries: []
			};
			this.client.transport.syncKey[kindName].folderIndex = nextIndex;
			return future;
		}
		
		//if we had error during folder sync or previous folders, cancel sync here.
		if (this.client.transport.syncKey[kindName].error === true) {
			log("We are in error state. Stop sync and return empty set.");
			future.result = { more: false, entries: [] };
			return future;
		}
 
		this.params.path = folder.uri;
		if (kindName === Kinds.objects.contact.name) {
			this.params.cardDav = true;
		}
		
		debug("Starting sync for " + folder.name + ".");
		this.client.transport.syncKey[kindName].error = true;
		future.nest(this._initCollectionId(kindName));
		future.then(this, function() {
			this.params.ctag = this.client.transport.syncKey[kindName].folders[index].ctag || 0;
			future.nest(CalDav.checkForChanges(this.params));
		}); 
		
		//called from success callback, if needs update, determine which objects to update
		future.then(this, function handleDoNeedSyncResponse() {
			var result = future.result, ctag = result.ctag;
			debug("------------- Got need update response: " + result.needsUpdate);
			
			if (result.needsUpdate) {

				//download etags and possibly data
				future.nest(this._doUpdate(kindName));
				future.then(this, function updateCB() {
					var result = future.result;
					
					//save ctag to fastly determine if sync is necessary at all.
					this.client.transport.syncKey[kindName].folders[index].ctag = ctag;
					
					//use next folder on next run.
					result.more = nextIndex < folders.length;
					future.result = result;
					
					debug("Sync for folder " + folder.name + " finished.");
					this.client.transport.syncKey[kindName].error = false;
					this.client.transport.syncKey[kindName].folderIndex = nextIndex;
				});
			} else { 
				//we don't need an update, tell sync engine that we are finished.
				log("Don't need update. Return empty set.");
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
	_updateConfig: function (kindName, entries) {
		var i, subKind = Kinds.objects[kindName].connected_kind, folders, entry, folder;
		if (entries.length > 0) {
			folders = this.client.transport.syncKey[subKind].folders;
		
			for (i = 0; i < entries.length; i += 1) {
				entry = entries[i];
				if (this.isDeleted(entry, kindName)) {
					folder = this._findMatch(entry.uri, folders, "uri");
					if (folder) { //only delete, if folder exists. ;)
						debug("Deleting folder " + folder.uri + " from local config");
						folders.splice(folder._macht_index, 1);
					} else {
						log("Could not find folder to delete: " + JSON.stringify(entry));
					}
				} else if (entry.add) {
					folder = {
						name: entry.name,
						uri: entry.uri
					};
					debug("New folder, pushing " + JSON.stringify(folder));
					folders.push(folder);
				} else {
					folder = this._findMatch(entry.uri, folders, "uri");
					folder.name = entry.name;
					folder.uri = entry.uri;
					debug("Updated folder " + folder.uri);
				}
			}
			//now save config:
			this.handler.putAccountTransportObject(this.client.transport).then(function putCB(f) {
				debug("Put config returned: " + JSON.stringify(f.result));
			});
		}
	},
	
	/*
	 * Gets etags and uris from the db. etags and uris are currently saved together with the
	 * database objects (i.e. with the contact or calendarevent). 
	 * It will return a future wich has the array of { etag, uri } objects as result.results field.
	 */
	_getLocalEtags: function(kindName) {
		var query =
			{
				from: Kinds.objects[kindName].id,
				where: [ { prop: "accountId", op: "=", val: this.client.clientId } ],
				select: ["etag", "remoteId", "_id", "uri"]
			};
		return DB.find(query, false, false);
	},
	
	/*
	 * Initializes the collectionId for subKinds (i.e. calendarevent and contacts) from local database.
	 */
	_initCollectionId: function(kindName) {
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
			var result = future.result, dbFolder;
			if (result.returnValue === true) {
				debug("Results: " + JSON.stringify(result));
				dbFolder = result.results[0];
				if (dbFolder) {
					debug("Setting collectionId to " + dbFolder._id);
					this.client.transport.syncKey[kindName].folders[folderIndex].collectionId = dbFolder._id;
					future.result = { returnValue: true };
				} else {
					throw new Error("No lokal id for folder " + uri);
				}
			} else {
				log("Could not get collection ids from local database: " + JSON.stringify(future.exception));
				throw future.exception;
			}
		});

		return future;
	},
	
	/*
	 * Handles download and parsing of etag data and then download of object data.
	 */
	_doUpdate: function (kindName) {
		var future = new Future(), remoteEtags;
		debug("Need update, getting etags from server.");
	
		//download etags and trigger next callback
		future.nest(CalDav.downloadEtags(this.params));
	
		future.then(this, function handleRemoteEtags() {
			log("---------------------->handleRemoteEtags()");
			var result = future.result, i;
			if (result.returnValue === true) {
				remoteEtags = result.etags;
				for (i = 0; i < remoteEtags.length; i += 1) {
					remoteEtags[i].remoteId = this._uriToRemoteId(remoteEtags[i].uri);
				}
				future.nest(this._getLocalEtags(kindName));
			} else {
				log("Could not download etags. Reason: " + JSON.stringify(result));
				throw new Error("Could not download etags for " + kindName); //error will be rethrown on each access to "future.result" => can get it in the last .then
			}
		});
	
		future.then(this, function handleLocalEtags() {
			var result = future.result;
			log("---------------------->handleLocalEtags()");
			if (result.returnValue === true) {
				future.result = { //trigger next then ;)
					returnValue: true,
					localEtags: result.results,
					remoteEtags: remoteEtags
				};
			} else {
				log("Could not get local etags, reason: " + JSON.stringify(future.exception));
				log("Result: " + JSON.stringify(result));
				throw new Error("Could not get local etags for " + kindName);
			}
		});

		//hand response of etags
		future.then(this, function handleEtagResponse() {
			log("---------------------->hanleEtagResponse()");

			var result = future.result, entries = [];
			if (future.exception || result.returnValue !== true) {
				log("Something in getting etags went wrong: " + JSON.stringify(future.exception));
				log("Aborting with no downsync.");
				future.result = {
					entries: [],
					more: false
				};
			} else {
				debug("Folder: " + this.client.transport.syncKey[kindName].folders[this.client.transport.syncKey[kindName].folderIndex].uri);
				debug("remoteEtags: " + JSON.stringify(result.remoteEtags));
				debug("localEtags: " + JSON.stringify(result.localEtags));
				entries = this._parseEtags(result.remoteEtags, result.localEtags);

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
	_findMatch: function(remoteId, objs) {
		var i;
		for (i = 0; i < objs.length; i += 1) {
			if (objs[i].remoteId === remoteId) {
				objs._macht_index = i; //small hack. But obj is not stored anywhere, so should be fine.
				return objs[i];
			}
		}
	},

	/*
	 * just parses the local & remote etag lists and determines which objects to add/update or delete.
	 */
	_parseEtags: function(remoteEtags, localEtags, key) {
		var entries = [], l, r, found, i, stats = {add: 0, del: 0, update: 0, noChange: 0};
		log("Got local etags: " + localEtags.length);
		log("Got remote etags: " + remoteEtags.length);
		
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
		//local with uri & etag, but not on server => deleted on server, delete local (local changes might be lost)
		for (i = 0; i < localEtags.length; i += 1) {
			l = localEtags[i];
			if (l[key]) {
				//log("Finding match for " + JSON.stringify(l));
				found = false;
				r = this._findMatch(l.remoteId, remoteEtags);
			
				if (r) {
					//log("Found match: " + JSON.stringify(r));
					found = true;
					r.found = true;
					if (l[key] !== r[key]) { //have change on server => need update.
						//log("Pushing: " + JSON.stringify(l));
						entries.push(r);
						stats.update += 1;
					} else {
						//log("No change.");
						stats.noChange += 1;
					}
				}

				//not found => deleted on server.
				if (!found) {
					//log("Not found => must have been deleted.");
					l.doDelete = true;
					stats.del += 1;
					entries.push(l);
				}
			}
		}
		
		//find completely new remote objects
		for (i = 0; i < remoteEtags.length; i += 1) {
			r = remoteEtags[i];
			if (!r.found) { //was not found localy, need add!
				//log("Remote etag " + JSON.stringify(r) + " was not found => add");
				stats.add += 1;
				r.add = true;
				entries.push(r);
			}
		}
		
		log ("Got " + entries.length + " remote changes: " + JSON.stringify(stats));
		return entries;
	},
	
	/*
	 * downloads data for each element and transfers it into webos object
	 * this method is called recursively. 
	 * the future returns when all downloads are finished.
	 */
	_downloadData: function (kindName, entries, entriesIndex) {
		var future = new Future();

		if (entriesIndex < entries.length) {
			if (entries[entriesIndex].doDelete) { //no need to download for deleted entry, skip.
				future.nest(this._downloadData(kindName, entries, entriesIndex + 1));
			} else {		
				//this is currently just a get, should work fine for vCard and iCal alike.
				future.nest(CalDav.downloadObject(this.params, entries[entriesIndex])); 
				
				future.then(this, function downloadCB() {
					var result = future.result;
					if (result.returnValue === true) {
						log("Download of entry " + entriesIndex + "ok. Now converting.");

						if (kindName === Kinds.objects.calendarevent.name) {									
							//transform recevied iCal to webos calendar object:
							debug("Starting iCal conversion");
							future.nest(iCal.parseICal(result.data, {serverId: "" }));
						} else if (kindName === Kinds.objects.contact.name) {
							//TODO: rework iCal and vCard and equalize their outer api, so that the calls are the same... :(
							debug("Starting vCard conversion");
							future.nest(vCard.parseVCard({account: { name: this.client.transport.config.name, 
																		kind: Kinds.objects[kindName].id, account: this.client.clientId }, 
																		vCard: result.data} ));
						} else {
							throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
						}
						
						future.then(this, function conversionCB() {
							var result = future.result, obj, fi = this.client.transport.syncKey[kindName].folderIndex;
							if (result.returnValue === true) {
								log("Object " + entriesIndex + " converted ok. Doing next one.");
								obj = result.result;
								obj.uri = entries[entriesIndex].uri;
								obj.etag = entries[entriesIndex].etag;
								entries[entriesIndex].collectionId = this.client.transport.syncKey[kindName].folders[fi].collectionId;
								entries[entriesIndex].obj = obj;
								//log("Converted object: " + JSON.stringify(entries[entriesIndex]);
							} else {
								log("Could not convert object " + entriesIndex + ", trying next one. :(");
							}
							
							//done with this object, do next one.
							future.nest(this._downloadData(kindName, entries, entriesIndex + 1));
						});
						
					} else {
						log("Download of entry " + entriesIndex + "failed... trying next one. :(");
						future.nest(this._downloadData(kindName, entries, entriesIndex + 1));
					}
				});
			 } //end update
		} else { //entriesIndex >= entries.length => finished.
			log("All items received and converted. Return.");
			future.result = {
				more: false, //always doing every folder in one batch. Can we split that up to save memory?
				entries: entries
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
		log("\n\n**************************SyncAssistant:getRemoteMatches*****************************");
		var i, results = [], future = new Future();
		
		//TODO: do we need to get full uris here from db?
		for (i = 0; i < remoteIds.length; i += 1) {
			debug("remoteId[" + i + "] = " + JSON.stringify(remoteIds[i]));
			results.push({remoteId: remoteIds[i]});
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
	 * So it should be fine to leave local2remote empty and to 
	 * conversion here, where we can wait for callbacks. :)
	 *
	 * The future should have an results array which contains
	 * the new/changed remote ids.
	 *
	 * We also need to store new/changed etags.
	 */
	putRemoteObjects:	function (batch, kindName) {
		log("\n\n**************************SyncAssistant:putRemoteObjects*****************************");
		var future = new Future();

		debug("Batch: " + JSON.stringify(batch));
		
		future.nest(this._processOne(0, [], batch, kindName));
		
		return future;
	},
	
	_processOne: function(index, remoteIds, batch, kindName) {
		log("Processing change " + (index+1) + " of " + batch.length);
		var future = this._putOneRemoteObject(batch[index], kindName).then(this, function oneObjectCallback () {
			var result = future.result, rid;
			
			if (result.returnValue === true) {
				rid = this._uriToRemoteId(result.uri);
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
	 * converts object into vCard/iCal and triggers upload to server (if not deleted).
	 * if deleted, obj is only deleted on server.
	 */
	_putOneRemoteObject: function(obj, kindName) {
		log("\n\n**************************SyncAssistant:_putOneRemoteObject*****************************");
		var future = new Future();
		
		function conversionCB(f) {
			if (f.result.returnValue === true) {
				obj.remote.data = f.result.result; //copy vCard/iCal result into obj.
			}
			future.nest(this._sendObjToServer(obj.remote));
		}
		
		if (obj.operation === "save") {
			if (kindName === Kinds.objects.calendarevent.name) {
				future.nest(iCal.generateICal(obj.local, {}));
			} else if (kindName === Kinds.objects.contact.name) {
				future.nest(vCard.generateVCard({accountName: this.client.transport.config.name, 
												contact: obj.local, kind: Kinds.objects[kindName].id}));
			} else {
				throw new Error("Kind '" + kindName + "' not supported in _putOneRemoteObject.");
			} 
			
			//respond to conversion callbacks:
			future.then(this, conversionCB);
		} else if (obj.operation === "delete") {
			//send delete request to server.
			future.nest(CalDav.deleteObject(this.params, obj.remote.uri, obj.remote.etag));
		} else {
			throw new Error("Operation '" + obj.operation + "' not supported in _putOneRemoteObject.");
		}
		return future;
	},
	
	/*
	 * uploads one object to the server and gets etag.
	 * input is the "remote" object.
	 */
	_sendObjToServer: function (obj) {
		log("\n\n**************************SyncAssistant:_sendObjToServer*****************************");
		var future = new Future();
		
		future.nest(CalDav.putObject({authToken: this.client.userAuth.authToken, path: obj.uri, etag: obj.etag, cardDav: this.params.cardDav}, obj.data));
		
		future.then(this, function putCB() {
			var result = future.result;
			if (result.returnValue === true) {
				if (result.etag) { //server already delivered etag => no need to get it again.
					log("Already got etag in put response: " + result.etag);
					future.result = { returnValue: true, uri: obj.uri, etag: result.etag, serverUri: obj.uri};
				} else { 
					log("Need to get new etag from server.");
					future.nest(CalDav.downloadEtags({authToken: this.client.userAuth.authToken, path: obj.uri}));
				}
			} else {
				log("put object failed for " + obj.uri);
				throw new Error("Pub object failed: " + JSON.stringify(future.exception) + " for " + obj.uri);
			}
		});
	
		future.then(this, function eTagCB() {
			var result = future.result;	 
			if (result.returnValue === true && result.etags && result.etags.length >= 1) {
				log("Got updated etag.");
				future.result = { returnValue: true, uri: obj.uri, etag: result.etags[0].etag, serverUri: result.etags[0].uri };
			} else {
				if (!future.exception) { //was no follow up error => log.
					log("Get etag failed for " + obj.uri);
				}
				future.result = { returnValue: false, uri: obj.uri };
			}
		});
		
		return future;
	}
});