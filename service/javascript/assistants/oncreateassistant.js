/*jslint sloppy: true, node: true, nomen: true */
/*global Class, Sync, Future, log, Kinds, lockCreateAssistant, debug, DB */

var OnCreate = Class.create(Sync.CreateAccountCommand, {
	run: function (outerFuture) {
		var future = new Future(), lockCheck;
		if (lockCreateAssistant(this.client.clientId)) {
			future.nest(this.handler.createAccount());

			future.then(this, function createAccountCB() {
				var result = future.result, config = this.client.config;
				log("Account created: " + JSON.stringify(result));

				config.accountId = this.client.clientId; //be sure to store right accountId.
				config._kind = "org.webosports.service.contacts.carddav.account.config:1";

				future.nest(DB.put([config]));
			});

			future.then(this, function dbCB() {
				var result = future.result;
				debug("Stored config object: " + JSON.stringify(result));
				outerFuture.result = {returnValue: true};
			});
		} else { //other create assistant already running. Prevent multiple account objects.
			log("Another create assistant is already running. Stopping.");
			outerFuture.result = {returnValue: true};
		}
		return outerFuture;
	}
});
