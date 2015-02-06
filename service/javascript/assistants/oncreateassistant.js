/*jslint nomen: true, node: true */
/*global Class, Sync, Future, Log, Kinds, lockCreateAssistant, searchAccountConfig, DB, unlockCreateAssistant, checkResult */
/*exported OnCreate*/

var OnCreate = Class.create(Sync.CreateAccountCommand, {
	run: function run(outerFuture) {
		"use strict";
		var future = new Future(), checkRunning, config = this.client.config;

		//but we need only one config object:
		if (lockCreateAssistant(this.client.clientId, this.controller.config.name)) {
			future.nest(searchAccountConfig({accountId: this.client.clientId}, true)); //see if another create-assistant already stored an object.

			future.then(this, function searchCB() {
				var result = checkResult(future);
				if (result.returnValue === true) {
					Log.log("Config object already exists. Skipping creation.");
					unlockCreateAssistant(this.client.clientId);
					this.$super(run)(outerFuture); //let parent create transport object.
				} else {
					config.accountId = this.client.clientId; //be sure to store right accountId.
					config._kind = Kinds.accountConfig.id;

					Log.log("Storing config in ", this.controller.config.name);
					future.nest(DB.put([config]));

					future.then(this, function dbCB() {
						var result = checkResult(future);
						Log.debug("Stored config object: ", result);
						if (result.returnValue === true) {
							this.client.config._id = result.results[0].id;
							this.client.config._rev = result.results[0].rev;
						}
						unlockCreateAssistant(this.client.clientId);

						this.$super(run)(outerFuture); //let parent create transport object.
					});
				}
			});
		} else { //other create assistant already running. Prevent multiple account objects.
			Log.log("Another create assistant is already running. Waiting...");
			//we need to wait here to make sure that the config object makes it into the db,
			//before we continue to the initial sync of this capability.

			checkRunning = function () {
				if (!lockCreateAssistant(this.client.clientId, this.controller.config.name)) {
					Log.log("Still waiting for creation of account ", this.client.clientId);
					setTimeout(checkRunning.bind(this), 1000);
				} else {
					Log.log("Other create assistant did finish, finish this, too.");
					unlockCreateAssistant(this.client.clientId); //unlock again.

					this.$super(run)(outerFuture); //let parent create transport object.
				}
			};

			setTimeout(checkRunning.bind(this), 1000);
		}

		return outerFuture;
	}
});
