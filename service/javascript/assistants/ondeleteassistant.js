/*jslint sloppy: true, node: true, nomen: true */
/*global Class, Sync, Future, log, Kinds, lockCreateAssistant, debug, DB */

var OnDelete = Class.create(Sync.DeleteAccountCommand, {
	run: function run(outerFuture) {
		var future = new Future(), config = this.client.config;

		if (config && config._id) {
			future.nest(DB.del([config._id]));

			future.then(this, function dbCB() {
				var result = future.result;
				debug("Delete config object: " + JSON.stringify(result));
				this.$super(run)(outerFuture);
			});
		} else {
			this.$super(run)(outerFuture);
		}

		return outerFuture;
	}
});
