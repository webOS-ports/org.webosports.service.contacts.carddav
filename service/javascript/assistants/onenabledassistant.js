/*jslint sloppy: true, node: true, nomen: true */
/*global Class, Future, Log, PalmCall, Sync, checkResult */

//This got necessary, because a bug in mojosync framework.
//It only creates one sync-on-edit activity, which is randomly
//the one of which kind the sync finishes last. So I have overwritten
//that part of the sync process and create sync-on-edit activities
//for all kinds with upsync allowed.
//Those have different names, that is why we need to delete them
//manually here.
var OnEnabled = Class.create(Sync.EnabledAccountCommand, {
    run: function run(outerFuture) {
        var future = new Future(), config = this.client.config, kind, name, cancelCalls = 0, enabled = this.controller.args.enabled, date;
        Log.debug("Arguments: ", this.controller.args);

        function cancelCB(f) {
            Log.debug("Result of cancel callback: ", checkResult(f));

            cancelCalls -= 1;
            if (cancelCalls <= 0) {
                Log.debug("Finished canceling activities. Continue with disabling capability.");

                //create an activity to run sync again after a few minutes. Reason is that this disables the general
                //periodic sync, if there were other capabilities set, those won't be periodically synced anymore.
                //the sync should re-create the periodic sync activity for them.
                date = new Date();
                PalmCall.call("palm://com.palm.activitymanager", "create", {
                    activity: {
                        name: "RecreatePeriodicSyncCapabilitieFix:" + this.controller.service.name + ":" + this.client.clientId,
                        description: "Recreate Periodic Sync activity if other capabilities are still enabled.",
                        type: {
                            background: true,
                            persist: true,
                            explicit: false //should delete this after one time run?
                        },
                        requirements: {
                            internetConfidence: "fair"
                        },
                        schedule: {
                            //start in one minute.
                            start: date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " + date.getHours() + ":" + (date.getMinutes() + 1) + ":" + date.getSeconds(),
                            local: true
                        },
                        callback: {
                            method: "palm://" + this.controller.service.name + "/sync",
                            params: {accountId: this.client.clientId}
                        }
                    },
                    start: true,
                    replace: true
                }).then(this, function activityCreateCB(f) {
                    var result = checkResult(f);
                    Log.debug("Result of checkPeriodicSync-Activity: ", result);
                    this.$super(run)(outerFuture);
                    Log.debug("??");
                });
            } else {
                Log.debug("Still waiting for ", cancelCalls, " cancel callbacks.");
            }
        }

        //we only delete these activities here.. creation is done after each sync, so let the sync cmd do this
        //the super-assistant cares for calling the sync cmd and also the periodic activity.
        if (!enabled) {
            for (kind in this.client.kinds.objects) {
                if (this.client.kinds.objects.hasOwnProperty(kind) && this.client.kinds.objects[kind].allowUpsync) {
                    Log.debug("Kind ", kind, " has upsync, cancelling its activity.");
                    name = "SyncOnEdit:" + this.controller.service.name + ":" + this.client.clientId + ":" + this.client.kinds.objects[kind].name;
                    cancelCalls += 1;
                    PalmCall.call("palm://com.palm.activitymanager", "cancel", { activityName: name }).then(this, cancelCB);
                }
            }
        }

        if (cancelCalls === 0) {
            Log.debug("Had no sync on edit activities, continue directly.");
            this.$super(run)(outerFuture);
        }

        return outerFuture;
    }
});
