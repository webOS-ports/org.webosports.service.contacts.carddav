/*jslint nomen: false */
/*global Future, Log, DB, KindsContacts, KindsCalendar, checkResult */

var TriggerSlowSyncAssistant = function () { "use strict"; };

TriggerSlowSyncAssistant.prototype.gotDBObject = function (future) {
    "use strict";
    var result = checkResult(future);
    if (result.returnValue) {
        future.nest(this.processAccount(result.results, 0));
    } else {
        Log.log("Could not get DB object: ", result);
        Log.log(future.error);
        future.result = {returnValue: false, success: false};
    }
};

TriggerSlowSyncAssistant.prototype.run = function (outerFuture) {
    "use strict";
    var future = new Future(),
        query = {"from": KindsContacts.account.metadata_id};

    future.nest(DB.find(query, false, false));

    future.then(this, this.gotDBObject);

    future.then(this, function contactsFinished() {
        query.from = KindsCalendar.account.metadata_id;
        future.nest(DB.find(query, false, false));
    });

    future.then(this, this.gotDBObject);

    future.then(this, function dbFinished() {
        var result = checkResult(future);
        Log.log("triggerSlowSync finished.");
        outerFuture.result = result;
    });
    return outerFuture;
};

TriggerSlowSyncAssistant.prototype.processAccount = function (objs, index) {
    "use strict";
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
            var result = checkResult(future);
            Log.debug("Store came back: ", result);
            future.nest(this.processAccount(objs, index + 1));
        });
    } else {
        Log.log("All ", index, " objects processed.");
        future.result = { returnValue: true, success: true };
    }

    return future;
};
