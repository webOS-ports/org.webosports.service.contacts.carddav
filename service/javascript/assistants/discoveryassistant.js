/*jslint sloppy: true, node: true, nomen: true */
/*global Future, log, Kinds, debug, DB, CalDav, getTransportObjByAccountId */

var DiscoveryAssistant = function () {};

DiscoveryAssistant.prototype.run = function (outerFuture) {
	var future = new Future(), args = this.controller.args;

	//can only process the account we got credentials for => get right transport object
	future.nest(getTransportObjByAccountId(args));
	
	future.then(this, function gotDBObject() {
		var result = future.result;
		if (result.returnValue) {
			future.nest(this.processAccount(args, result.account));
		} else {
			log("Could not get DB object: " + JSON.stringify(result));
			log(JSON.stringify(future.error));
			future.result = {returnValue: false, success: false};
		}
	});

	future.then(this, function discoveryFinished() {
		var result = future.result || {returnValue: false};
		log("Discovery finished.");
		outerFuture.result = result;
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
			var result = future.result, i, f, config = obj.config, syncKey = obj.syncKey || {};

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

				obj.syncKey = syncKey;
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
			future.result = {returnValue: result.returnValue, success: result.returnValue, config: obj.config, syncKey: obj.syncKey};
		});
	}

	return future;
};



