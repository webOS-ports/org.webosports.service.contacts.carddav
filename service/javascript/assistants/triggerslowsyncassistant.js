/*jslint sloppy: true, node: true, nomen: true */
/*global Future, Log, Kinds, DB, CalDav, KindsContacts, KindsCalendar */

var TriggerSlowSyncAssistant = function () {};

TriggerSlowSyncAssistant.prototype.gotDBObject = function (future) {
    var result = future.result;
    if (result.returnValue) {
        future.nest(this.processAccount(result.results, 0));
    } else {
        Log.log("Could not get DB object:", result);
        Log.log(future.error);
        future.result = {returnValue: false, success: false};
    }
};

TriggerSlowSyncAssistant.prototype.run = function (outerFuture) {
    var future = new Future(), args = this.controller.args,
        query = {"from": KindsContacts.account.metadata_id};

    future.nest(DB.find(query, false, false));

    future.then(this, this.gotDBObject);

    future.then(this, function calendarFinished() {
        query.from = KindsCalendar.account.metadata_id;
        future.nest(DB.find(query, false, false));
    });

    future.then(this, this.gotDBObject);

    future.then(this, function discoveryFinished() {
        var result = future.result || {returnValue: false};
        Log.log("triggerSlowSync finished.");
        outerFuture.result = result;
    });
    return outerFuture;
};

TriggerSlowSyncAssistant.prototype.processAccount = function (objs, index) {
    var future = new Future(), syncKey, obj = objs[index], key;

    if (obj) {
        syncKey = obj.syncKey || {};

        for (key in this.client.kinds.objects) {
            if (this.client.kinds.objects.hasOwnProperty(key)) {
                syncKey[key] = { error: true };
            }
        }

        obj.syncKey = syncKey;

        future.nest(DB.merge([obj]));

        future.then(this, function storeCB() {
            var result = future.result;
            Log.debug("Store came back:", result);
            future.nest(this.processAccount(objs, index + 1));
        });
    } else {
        Log.log("All", index, "objects processed.");
        future.result = { returnValue: true };
    }

    return future;
};
