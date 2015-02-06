/*jslint nomen: true, node: true */
/*global Class, Future, Log, Sync, DB, checkResult, servicePath */
/*exported OnDelete*/

var KeyStore = require(servicePath + "/javascript/utils/KeyStore.js");

var OnDelete = Class.create(Sync.DeleteAccountCommand, {
	run: function run(outerFuture) {
		"use strict";
		var future = new Future(), config = this.client.config;

		//delete key from keystore.
		KeyStore.deleteKey(this.client.clientId);

		if (config && config._id) {
			future.nest(DB.del([config._id]));

			future.then(this, function dbCB() {
				var result = checkResult(future);
				Log.debug("Delete config object result: ", result);
				this.$super(run)(outerFuture);
			});
		} else {
			this.$super(run)(outerFuture);
		}

		return outerFuture;
	}
});
