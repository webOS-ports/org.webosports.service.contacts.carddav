/*global Class, Sync, Future, log, CalDav, Kinds, unlockCreateAssistant, lockCreateAssistant, debug */

var OnCreate = Class.create(Sync.CreateAccountCommand,
{
	run: function(outerFuture)
	{
		var future = new Future(), lockCheck;
		if (lockCreateAssistant(this.client.clientId)) {
			future.nest(this.handler.createAccount());
		
			future.then(this, function createAccountCB() {
				var result = future.result;
				log("Account created: " + JSON.stringify(result));
			
				future.nest(this.handler.getAccountTransportObject(this.client.clientId));
			});
		
			future.then(this, function transportCB() {
				var result = future.result, params;
				debug("Got transport object: " + JSON.stringify(result));
				debug("Storing: " + JSON.stringify(this.client.config));
				result.config = this.client.config;
				this.client.transport = result;
				
				params = {
					path: CalDav.setHostAndPort(this.client.config.url),
					authToken: this.client.userAuth.authToken
				};
				this.client.transport.host = params.path;
			
				future.nest(CalDav.discovery(params));
			});
			
			future.then(this, function discoverCB() {
				var result = future.result, i, f, config = this.client.transport.config, syncKey = {};
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
				
				if (result.returnValue === true) {
					for (i = 0; i < result.folders.length; i += 1) {
						f = result.folders[i];
						switch(f.resource) {
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
				}

				future.nest(this.handler.putAccountTransportObject(this.client.transport));
			});
			
			future.then(this, function storeCB() {
				var result = future.result;
				debug("Store came back: " + JSON.stringify(result));
				unlockCreateAssistant(this.client.clientId);
				outerFuture.result = {};
			});
		} else { //other create assistant already running. Prevent multiple account objects. 
			log("Another create assistant is already running. Stopping.");
			
			lockCheck = function() {
				if (lockCreateAssistant(this.client.clientId)) {
					unlockCreateAssistant(this.client.clientId);
					outerFuture.result = {};
				} else {
					setTimeout(lockCheck.bind(this), 1000);
				}
			};
			
			setTimeout(lockCheck.bind(this), 1000);
		}
	}
});
