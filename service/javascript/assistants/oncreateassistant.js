/*jslint sloppy: true, node: true, nomen: true */
/*global Class, Sync, Future, log, CalDav, Kinds, unlockCreateAssistant, lockCreateAssistant, debug, DB */

var OnCreate = Class.create(Sync.CreateAccountCommand, {
	run: function (outerFuture) {
		var future = new Future(), lockCheck;
		if (lockCreateAssistant(this.client.clientId)) {
			future.nest(this.handler.createAccount());
		
			future.then(this, function createAccountCB() {
				var result = future.result;
				log("Account created: " + JSON.stringify(result));

				future.nest(this.handler.getAccountTransportObject(this.client.clientId));
			});

			future.then(this, function transportCB() {
				var result = future.result, params, obj = {};
				debug("Got transport object: " + JSON.stringify(result));
				debug("Storing: " + JSON.stringify(this.client.config));

				obj.config = this.client.config;
				obj._id = result._id;
				obj._kind = result._kind;

				future.nest(DB.merge([obj]));
			});

			future.then(this, function storeCB() {
				var result = future.result;
				debug("Store came back: " + JSON.stringify(result));
				outerFuture.result = {returnValue: true};
			});
		} else { //other create assistant already running. Prevent multiple account objects.
			log("Another create assistant is already running. Stopping.");
			outerFuture.result = {returnValue: true};
		}
		return outerFuture;
	}
});
