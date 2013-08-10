/*
 * SyncAssistant
 * Description: Handles the remote to local data conversion for CalDav and CardDav
 */
/*global log, Class, Sync, feedURLContacts, feedURLCalendar, Kinds, Future, CalDav, Assert, iCal, vCard, DB */
 
var SyncAssistant = Class.create(Sync.SyncCommand, {		 
	/*
	 * Return an array of strings identifying the object types for synchronization, in the correct order.
	 */
	getSyncOrder: function () {
		log("\n\n**************************SyncAssistant: getSyncOrder*****************************");
		return Kinds.syncOrder;
	},

	/* 
	 * Return an array of "kind objects" to identify object types for synchronization
	 * This will normally be an object with property names as returned from getSyncOrder, with structure like this:
	 */
	getSyncObjects: function () {
		log("\n\n**************************SyncAssistant: getSyncObjects*****************************");
		return Kinds.objects;
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
		var postfix, uri, prefix;
		if (kindName === Kinds.objects.calendarevent.name) {
			postfix = ".ics";
			prefix = "/egroupware/groupdav.php/Achim/calendar/";
		} else if (kindName === Kinds.objects.contact.name) {
			postfix = ".vcf";
			prefix = "/egroupware/groupdav.php/Achim/addressbook/";
		} else {
			throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
		}

		//generate some random uri. hm.. Do something smart here. Need to have the right prefix.

		uri = prefix + "webos-" + Date.now() + postfix; //uses timestamp in miliseconds since 1970 
		return { uri: uri, add: true };
	},

	/*
	 * Tells sync engine the transformation type.	remote2local or local2remote	
	 */
	getTransformer: function (name, kindName) {
		log("\n\n**************************SyncAssistant: getTransformer*****************************");
		log("--------------> transformation type: " + name + "for kind: " + kindName + "\n");
		if (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name) {
			return this._getObjectTransformer(name);
		}
		
		throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
	},
	
	/*
	 * No callbacks are possible here, a result is expected immediately. So we need to have get the object data
	 * with the "getRemoteChanges" anyway and do the transformation into an webOS object there already.
	 * If we would want to use common iCal/vCard libraries, one might want to use the Json.Transformer here to
	 * translate the fields into webos fields.
	 */
	_getObjectTransformer: function (name) {
		log("\n\n**************************SyncAssistant:_getObjectTransformer*****************************");

		if (name === "remote2local") {
			//this is down-sync - create transformer object
			//var transformer = new Json.Transformer(this._templates.calendar.remote2local);
			return function (to, from) {
				var key, obj = from.obj;
				log("transform method called for " + from.uri);
				//log("From: " + JSON.stringify(from));
				//log("To: " + JSON.stringify(to));
												
				//populate to object with data from event:
				for (key in obj) {
					if (obj.hasOwnProperty(key) && obj[key] !== undefined && obj[key] !== null) {
						to[key] = obj[key];
						//log("Copied event[" + key + "] = " + to[key]);
					}
				}
				
				to.etag = from.etag;
				to.uri = from.uri;
				
				return from.obj; //transformer.transformAndMerge(to, from);
			};
		}
		
		if (name === "local2remote") {
			if (this.client.upsyncEnabled) {
				return function (to, from) { //i.e. will be called with remote / local. Issue: Also does not wait for a callback. Hm.
					//empty method. Work will be done later.
					log("Transforming " + JSON.stringify(from));
					to.etag = from.etag;
					to.uri = from.uri;
					to._id = from._id;
					
					log("Result: " + JSON.stringify(to));
					
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
		log("\n\n**************************SyncAssistant:getRemoteID*****************************");
		
		if (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name) {
			log("obj.uri: " + obj.uri);
			return obj.uri; //use uri, it is unique and constant.
		}
		
		throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
	},
	
	/*
	 * This tells webOs if the object was deleted on the server. If it was not deleted, 
	 * it is updated locally with remote changes.
	 */
	isDeleted: function (obj, kindName) {
		//log("\n\n**************************SyncAssistant:isDeleted*****************************");

		if (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name) {
			if (obj && obj.doDelete) {
				return true;
			}
			
			//not deleted
			return false;
		}
		
		throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
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

		if (kindName === Kinds.objects.calendarevent.name || kindName === Kinds.objects.contact.name) {
			return this._getRemoteChanges(state, kindName);
		}
		
		throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
	},
	
	/*
	 * First checks ctag of collection, then checks etag of single entries.
	 * If it changed, we also get the object and transfer it into webos datatype,
	 * because that is not possible later.
	 * ctag and etag is the same for caldav and carddav. Changes are only with objects.
	 */
	_getRemoteChanges: function (state, kindName) {
		log("\n\n**************************SyncAssistant:_getRemoteChanges*****************************");
		var future = new Future(),
			savedTransportObject = this.client.transport;
		//TODO: get calendar URL somewhere from DB..? ;) Best would be to find calendar url from general url and save in this.client.

		if (savedTransportObject && savedTransportObject.config) {
			log("Initializing CalDav connector for " + savedTransportObject.config.url);
			CalDav.setHostAndPort(savedTransportObject.config.url);
		} else {
			throw new Error("No config stored. Can't determine URL, no sync possible.");
		}
		
		if (!this.client.userAuth) {
			throw new Error("No userAuth information. Something wrong with keystore. Can't authenticate with server.");
		}
		
		this.params = { authToken: this.client.userAuth.authToken };
		
		if (kindName === Kinds.objects.contact.name) {
				this.params.path = feedURLContacts;
				this.params.cardDav = true;
			} else if (kindName === Kinds.objects.calendarevent.name) {
				this.params.path = feedURLCalendar;
			}
			
		
		if (!savedTransportObject) {
			savedTransportObject = {};
			this.client.transport = savedTransportObject; //if that is allowed?
		}
		
		//prevent crashes during assignments.
		if (!savedTransportObject.syncKey) {
			savedTransportObject.syncKey = {};
		}
		//TODO: remove that after next emulator reset.. ;)
		delete savedTransportObject.syncKey.localEtags;
		delete savedTransportObject.syncKey.ctag;
		delete savedTransportObject.syncKey.next_ctag;

		future.now(this, function() {
			this.params.ctag = (savedTransportObject &&	savedTransportObject.syncKey 
								&& savedTransportObject.syncKey[kindName] && savedTransportObject.syncKey[kindName].ctag) || 0;
			//log("Read last ctag from transport obj:" + this.params.ctag);
			//log("SavedTransportObject: " + JSON.stringify(savedTransportObject));

			future.nest(CalDav.checkForChanges(this.params)); 
		}); 
		
		//called from success callback, if needs update, determine which objects to update
		future.then(this, function handleDoNeedSyncResponse() {
			var result = future.result;
			log("------------- Got need update response: " + result.needsUpdate);
			
			if (result.needsUpdate) {
			//save ctag for later.
			if (!savedTransportObject.syncKey[kindName]) {
					savedTransportObject.syncKey[kindName] = {};
				}
				savedTransportObject.syncKey[kindName].next_ctag = result.ctag;

				//download etags and possibly data
				future.nest(this._doUpdate(kindName));
			} else { 
				//we don't need an update, tell sync engine that we are finished.
				log("Don't need update. Return empty set.");
				future.result = {
					more: false, 
					entries: []
				};
			}
		});
			
		return future; 
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
				select: ["etag", "uri"]
			};
		return DB.find(query, false, false);
	},
	
	/*
	 * Handles download and parsing of etag data and then download of object data.
	 */
	_doUpdate: function (kindName) {
		var future = new Future(), remoteEtags;
		log("Need update, getting etags from server.");
	
		//download etags and trigger next callback
		future.nest(CalDav.downloadEtags(this.params));
	
		future.then(this, function handleRemoteEtags() {
			log("---------------------->handleRemoteEtags()");
			var result = future.result;
			if (result.returnValue === true) {
				remoteEtags = result.etags;
				future.nest(this._getLocalEtags(kindName));
			} else {
				log("Could not download etags. Reason: " + JSON.stringify(future.exception));
				throw new Error("Could not download etags for " + kindName); //error will be rethrown on each access to "future.result" => can get it in the last .then
			}
		});
	
		future.then(this, function handleLocalEtags() {
			var result = future.result;
			log("---------------------->handleLocalEtags()");
			//log("Got remote etags: " + remoteEtags.length);
			if (result.returnValue === true) {
				future.result = { //trigger next then ;)
					returnValue: true,
					localEtags: result.results,
					remoteEtags: remoteEtags
				};
			} else {
				log("Could not get local etags.");
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
				entries = this._parseEtags(result.remoteEtags, result.localEtags);

				//now download object data and transfer it into webos datatypes.
				future.nest(this._downloadData(kindName, entries, 0));
				
				//if all went well, store ctag in client.transport.
				future.then(this, function () {
					var result = future.result;
					//remote to local mapping is done by framework. Yeah.. so just save our stuff here:
					if (this.client.transport && this.client.transport.syncKey) {
						if (!this.client.transport.syncKey[kindName]) {
							this.client.transport.syncKey[kindName] = {};
						}
						//save ctag to fastly determine if sync is necessary at all.
						this.client.transport.syncKey[kindName].ctag = this.client.transport.syncKey[kindName].next_ctag; 
					}
					
					future.result = result; //just transfer results to outer future.
				});
			}
		});
		return future;
	},

	/*
	 * Finds an {etag, uri} object by uri.
	 */
	_findEtag: function(uri, etags) {
		var i;
		for (i = 0; i < etags.length; i += 1) {
			if (etags[i].uri === uri) {
				return etags[i];
			}
		}
	},

	/*
	 * just parses the local & remote etag lists and determines which objects to add/update or delete.
	 */
	_parseEtags: function(remoteEtags, localEtags) {
	var entries = [], l, r, found, i, stats = {add: 0, del: 0, update: 0, noChange: 0};
		log("Got local etags: " + localEtags.length);
		log("Got remote etags: " + remoteEtags.length);

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
			//log("Finding match for " + JSON.stringify(l));
			found = false;
			r = this._findEtag(l.uri, remoteEtags);
			
			if (r) {
				//log("Found match: " + JSON.stringify(r));
				found = true;
				r.found = true;
				if (l.etag !== r.etag) { //have change on server => need update.
					//log("Pushing: " + JSON.stringify(l));
					entries.push(l);
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
		
		//find completely new remote objects
		for (i = 0; i < remoteEtags.length; i += 1) {
			r = remoteEtags[i];
			if (!r.found) { //was not found localy, need add!
				//log("Remote etag " + JSON.stringify(r) + " was not found => add");
				stats.add += 1;
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
							log("Starting iCal conversion");
							future.nest(iCal.parseICal(result.data, {serverId: "" }));
						} else if (kindName === Kinds.objects.contact.name) {
							//TODO: rework iCal and vCard and equalize their outer api, so that the calls are the same... :(
							//TODO: get account name from somewhere (maybe this.client something?).
							log("Starting vCard conversion");
							future.nest(vCard.parseVCard({account: { name: "carddav", kind: Kinds.objects[kindName].id, account: this.client.clientId }, 
																						vCard: result.data} ));
						} else {
							throw new Error("--------------> Kind name not recognized: '" + kindName + "'");
						}
						
						future.then(this, function conversionCB() {
							var result = future.result, obj;
							if (result.returnValue === true) {
								log("Object " + entriesIndex + " converted ok. Doing next one.");
								obj = result.result;
								obj.uri = entries[entriesIndex].uri;
								obj.etag = entries[entriesIndex].etag;
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
				more: false, //always doing everything in one batch. Can we split that up to save memory?
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
		
		for (i = 0; i < remoteIds.length; i += 1) {
			log("remoteId[" + i + "] = " + JSON.stringify(remoteIds[i]));
			results.push({uri: remoteIds[i]});
		}

		log("Incomming remoteIds: " + remoteIds.length);
		log("Sending remote matches: " + results.length);
		
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

		future.nest(this._processOne(0, [], batch, kindName));
		
		return future;
	},
	
	_processOne: function(index, remoteIds, batch, kindName) {
		log("Processing change " + (index+1) + " of " + batch.length);
		var future = this._putOneRemoteObject(batch[index], kindName).then(this, function oneObjectCallback () {
			var result = future.result, rid;
			
			if (result.returnValue === true) {
				rid = result.uri;
			}
			
			//save remote id for local <=> remote mapping
			remoteIds[index] = rid;
			
			//save uri and etag in local object.
			batch[index].local.uri = rid;
			batch[index].local.etag = result.etag;
		
			//process next object
			if (index < batch.length) {
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
				//TODO: get account name from this.client or something.
				future.nest(vCard.generateVCard({accountName: "carddav", contact: obj.local, kind: Kinds.objects[kindName].id}));
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
		
		future.then(function putCB() {
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
	
		future.then(function eTagCB() {
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
