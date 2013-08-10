/*global Class, Sync, Future, log */

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
			var result = future.result;
			log("Got transport object: " + JSON.stringify(result));
			log("Storing: " + JSON.stringify(this.client.config));
			result.config = this.client.config;
			future.nest(this.handler.putAccountTransportObject(result));
		});
		
		future.then(this, function storeCB() {
			var result = future.result;
			log("Store came back: " + JSON.stringify(result));
			outerFuture.result = {};
		});		
	}
});
