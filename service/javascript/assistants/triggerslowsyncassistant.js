/*jslint sloppy: true, node: true, nomen: true */
/*global Future, log, Kinds, debug, DB, CalDav, getTransportObjByAccountId */

var TriggerSlowSyncAssistant = function () {};

TriggerSlowSyncAssistant.prototype.run = function (outerFuture) {
	var future = new Future(), args = this.controller.args,
		query = {"from": "org.webosports.service.contacts.carddav.account:1"};

	future.nest(DB.find(query, false, false));

	future.then(this, function gotDBObject() {
		var result = future.result;
		if (result.returnValue) {
			future.nest(this.processAccount(result.results, 0));
		} else {
			log("Could not get DB object: " + JSON.stringify(result));
			log(JSON.stringify(future.error));
			future.result = {returnValue: false, success: false};
		}
	});

	future.then(this, function discoveryFinished() {
		var result = future.result || {returnValue: false};
		log("triggerSlowSync finished.");
		outerFuture.result = result;
	});
	return outerFuture;
};

TriggerSlowSyncAssistant.prototype.processAccount = function (objs, index) {
	var future = new Future(), syncKey, obj = objs[index], key;

	if (obj) {
		syncKey = obj.syncKey || {};

		for (key in Kinds.objects) {
			if (Kinds.objects.hasOwnProperty(key)) {
				syncKey[key] = { error: true };
			}
		}

		obj.syncKey = syncKey;

		future.nest(DB.merge([obj]));

		future.then(this, function storeCB() {
			var result = future.result;
			debug("Store came back: " + JSON.stringify(result));
			future.nest(this.processAccount(objs, index + 1));
		});
	} else {
		log("All " + index + " objects processed.");
		future.result = { returnValue: true };
	}

	return future;
};
