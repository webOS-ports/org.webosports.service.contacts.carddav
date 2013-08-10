/*global Class, Sync, Future, log, CalDav, Kinds */

var OnCreate = Class.create(Sync.CreateAccountCommand,
{
	run: function(outerFuture)
	{
		var future = new Future();
		future.nest(this.handler.createAccount());
		
		future.then(this, function createAccountCB() {
			var result = future.result;
			log("Account created: " + JSON.stringify(result));
			
			future.nest(this.handler.getAccountTransportObject(this.client.clientId));
		});
		
		future.then(this, function transportCB() {
			var result = future.result, params;
			log("Got transport object: " + JSON.stringify(result));
			log("Storing: " + JSON.stringify(this.client.config));
			result.config = this.client.config;
			this.client.transport = result;
			
			params = {
				path: CalDav.setHostAndPort(this.client.config.url),
				authToken: this.client.userAuth.authToken
			};
			this.client.transport.host = params.path;
			
			future.nest(CalDav.discover(params));
		});
		
		future.then(this, function discoverCB() {
			var result = future.result, i, f, config = this.client.transport.config;
			config[Kinds.objects.calendarevent.name] = {
				folders: [],
				homeFolder: result.calendarHome
			};
			config[Kinds.objects.calendar.name] = {
				folders: [{
					name: "Calendar Home",
					uri: result.calendarHome
				}]
			};
			config[Kinds.objects.contact.name] = {
				folders: [],
				homeFolder: result.contactHome
			};
			config[Kinds.objects.task.name] = {
				folders: []
				//no home for tasks
			};
			
			if (result.returnValue === true) {
				for (i = 0; i < result.folders.length; i += 1) {
					f = result.folders[i];
					switch(f.resource) {
						case "calendar":
							config[Kinds.objects.calendarevent.name].folders.push({uri: f.uri, name: f.name});
							break;
						case "contact":
							config[Kinds.objects.contact.name].folders.push({uri: f.uri, name: f.name});
							break;
						case "task":
							config[Kinds.objects.task.name].folders.push({uri: f.uri, name: f.name});
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
			log("Store came back: " + JSON.stringify(result));
			outerFuture.result = {};
		});		
	}
});
