/*jslint sloppy: true, node: true, nomen: true */
/*global Class, Future, Log, PalmCall, Sync */

//This got necessary, because a bug in mojosync framework.
//It only creates one sync-on-edit activity, which is randomly
//the one of which kind the sync finishes last. So I have overwritten
//that part of the sync process and create sync-on-edit activities
//for all kinds with upsync allowed.
//Those have different names, that is why we need to delete them
//manually here.
var OnEnabled = Class.create(Sync.EnabledAccountCommand, {
    run: function run(outerFuture) {
        var future = new Future(), config = this.client.config, kind, name, cancelCalls = 0, enabled = this.contorller.args.enabled;
        Log.debug("Arguments: ", this.contorller.args);

        function cancelCB(f) {
            cancelCalls -= 1;
            if (cancelCalls <= 0) {
                Log.debug("Finished canceling activities. Continue with disabling capability.");
                this.$super(run)(outerFuture);
            } else {
                Log.debug("Still waiting for ", cancelCalls, " cancel callbacks.");
            }

            try {
                Log.debug("Result of cancel callback:", f.result);
            } catch (e) {
                Log.debug("Cancel gave exception, ignoring:", e);
            }
        }

        //we only delete these activities here.. creation is done after each sync, so let the sync cmd do this
        //the super-assistant cares for calling the sync cmd and also the periodic activity.
        if (!enabled) {
            for (kind in this.client.kinds) {
                if (this.client.kinds.hasOwnProperty(kind) && this.client.kinds[kind].allowUpsync) {
                    name = "SyncOnEdit:" + this.controller.service.name + ":" + this.client.clientId + ":" + this.client.kinds[kind].name;
                    cancelCalls += 1;
                    PalmCall.call("palm://com.palm.activitymanager", "cancel", { activityName: this._activityId }).then(this, cancelCB);
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