/*jslint sloppy: true, node: true, nomen: true */
/*global Future, log, Kinds, debug, DB, CalDav */

var DiscoveryAssistant = function () {};

DiscoveryAssistant.prototype.run = function (outerFuture) {
	var future = new Future(), args = this.controller.args,
		dbObj, query = {"from": "org.webosports.service.contacts.carddav.account:1"};
	
	if (args.id) {
		future.nest(DB.get([args.id]));
	} else {
		future.nest(DB.find(query, false, false));
	}
	
	future.then(this, function gotDBObject() {
		var result = future.result, i, obj;
		if (result.returnValue) {
			debug("Got " + result.results.length + " account objects from database.");
			
			for (i = 0; i < result.results.length; i += 1) {
				obj = result.results[i];
				if (obj.accountId === args.accountId) { //can only process the account we got credentials for.
					future.nest(this.processAccount(args, obj));
					break;
				}
			}
		} else {
			log("Could not get DB object: " + JSON.stringify(result));
			log(JSON.stringify(future.error));
			future.result = {returnValue: false, success: false};
		}
	});
	
	future.then(this, function discoveryFinished() {
		log("Discovery finished.");
		outerFuture.result = future.result;
	});
	return outerFuture;
};

DiscoveryAssistant.prototype.processAccount = function (args, obj) {
	var future = new Future(), params;
	
	if (obj) {
		debug("Got transport object: " + JSON.stringify(obj));
		
		if (args[obj._id]) {
			obj.config = {
				name: args[obj._id].name,
				url: args[obj._id].url
			};
		}
		
		if (!obj.config || !obj.config.url) {
			log("No url for " + obj._id + " found in db or agruments. Can't process this account.");
			future.reslut = {returnValue: false, success: false, msg: "No url for account in config."};
			return future;
		}
		
		params = {
			path: CalDav.setHostAndPort(obj.config.url),
			authToken: this.client.userAuth.authToken,
			originalUrl: obj.config.url
		};
		
		future.nest(CalDav.discovery(params));
		
		future.then(this, function discoverCB() {
			var result = future.result, i, f, config = obj.config, syncKey = {};
			
			if (result.returnValue === true) {
				config[Kinds.objects.calendarevent.name] = {
					homeFolder: result.calendarHome
				};
				config[Kinds.objects.contact.name] = {
					homeFolder: result.contactHome
				};
				
				for (i in Kinds.objects) {
					if (Kinds.objects.hasOwnProperty(i)) {
						syncKey[Kinds.objects[i].name] = {
							folders: []
						};
					}
				}

				for (i = 0; i < result.folders.length; i += 1) {
					f = result.folders[i];
					debug("folder: " + JSON.stringify(f));
					switch (f.resource) {
					case "calendar":
						syncKey[Kinds.objects.calendarevent.name].folders.push({uri: f.uri, name: f.name, remoteId: f.uri});
						break;
					case "contact":
						syncKey[Kinds.objects.contact.name].folders.push({uri: f.uri, name: f.name, remoteId: f.uri});
						break;
					case "task":
						syncKey[Kinds.objects.task.name].folders.push({uri: f.uri, name: f.name, remoteId: f.uri});
						break;
					default:
						log("Discovery confused. Don't know resource type " + f.resource);
						break;
					}
				}
			} else {
				log("Could not discover addressbook and calendar folders: " + JSON.stringify(result));
				
				log("Setting home folders to original URL and hoping for the best.");
				config[Kinds.objects.calendarevent.name] = {
					homeFolder: config.url
				};
				config[Kinds.objects.contact.name] = {
					homeFolder: config.url
				};
			}
			
			future.nest(DB.merge([obj]));
		});
		
		future.then(this, function storeCB() {
			var result = future.result;
			debug("Store came back: " + JSON.stringify(result));
			future.result = {returnValue: result.returnValue, success: result.returnValue};
		});
	}
	
	return future;
};



