/*jslint node: true */
/*global Class, Log, PalmCall, Sync, checkResult, Future, setTimeout */
/*exported OnEnabled*/

//This got necessary, because a bug in mojosync framework.
//It only creates one sync-on-edit activity, which is randomly
//the one of which kind the sync finishes last. So I have overwritten
//that part of the sync process and create sync-on-edit activities
//for all kinds with upsync allowed.
//Those have different names, that is why we need to delete them
//manually here.
//Contacts and calendar are enabled and disabled at the same moment, on one
//client for the account. Side by side, the framework refuses the second disable
//as busy, which leaves that capability's data behind, and the second enable
//replaces the sync activity the first has just started. So run them one at a time.
var enabledQueues = {};
var BUSY_RETRY_MS = 1000;
var BUSY_RETRIES = 600; //a running sync has to finish first, and can take minutes.

function runForAccount(accountId, enabled, task) {
	"use strict";
	function next() {
		var waiting = enabledQueues[accountId].shift();
		if (waiting) {
			waiting.task(next);
		} else {
			delete enabledQueues[accountId];
		}
	}

	if (enabledQueues[accountId]) {
		enabledQueues[accountId].push({enabled: enabled, task: task});
	} else {
		enabledQueues[accountId] = [];
		task(next);
	}
}

function anotherEnableIsWaiting(accountId) {
	"use strict";
	return (enabledQueues[accountId] || []).some(function (waiting) {
		return waiting.enabled;
	});
}

var OnEnabled = Class.create(Sync.EnabledAccountCommand, {
	run: function run(outerFuture) {
		"use strict";
		var kind,
			name,
			names = [],
			cancelCalls = 0,
			enabled = this.controller.args.enabled,
			serviceName = this.controller.service.name,
			accountId = this.client.clientId,
			assistant = this;
		Log.debug("Arguments: ", this.controller.args);

		//Every capability starts the same "Initial Sync" activity, replacing the one before it
		//even while that is syncing. One sync covers all capabilities of the account, so only
		//the last enable of a group starts it.
		function leaveInitialSyncToLastEnable() {
			var handler = assistant.handler, enableAccount = handler.enableAccount;

			handler.enableAccount = function (extras) {
				return enableAccount.call(handler, extras).then(function initialSyncCB(future) {
					var initialSync = future.result;
					if (initialSync && anotherEnableIsWaiting(accountId)) {
						Log.debug("Another capability is being enabled, leaving the initial sync to it.");
						initialSync = false;
					}
					future.result = initialSync;
				});
			};
		}

		function runSuper(finished, retries) {
			var innerFuture = new Future();

			assistant.$super(run)(innerFuture);
			innerFuture.then(function superCB() {
				var exception = innerFuture.exception,
					result = checkResult(innerFuture);

				Log.debug("Super function returned: ", result);
				if (!enabled && !exception && result && result.errorCode === "BUSY" && retries > 0) {
					Log.debug("Account is busy, trying again...");
					setTimeout(function () {
						runSuper(finished, retries - 1);
					}, BUSY_RETRY_MS);
					return;
				}

				if (exception) {
					outerFuture.setException(exception);
				} else {
					outerFuture.result = result;
				}
				finished();
			});
		}

		function recreatePeriodicSync(finished) {
			var date = new Date();

			//create an activity to run sync again after a few minutes. Reason is that this disables the general
			//periodic sync, if there were other capabilities set, those won't be periodically synced anymore.
			//the sync should re-create the periodic sync activity for them.
			PalmCall.call("palm://com.palm.activitymanager", "create", {
				activity: {
					name: "RecreatePeriodicSync:" + serviceName + ":" + accountId,
					description: "Recreate Periodic Sync activity if other capabilities are still enabled.",
					type: {
						background: true,
						persist: true,
						explicit: false //should delete this after one time run?
					},
					requirements: {
						undefined
					},
					schedule: {
						//start in one minute.
						start: date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " + date.getHours() + ":" + (date.getMinutes() + 1) + ":" + date.getSeconds(),
						local: true
					},
					callback: {
						method: "palm://" + serviceName + "/sync",
						params: {accountId: accountId}
					}
				},
				start: true,
				replace: true
			}).then(function activityCreateCB(f) {
				Log.debug("Result of checkPeriodicSync-Activity: ", checkResult(f));
				runSuper(finished, BUSY_RETRIES);
			});
		}

		//we only delete these activities here.. creation is done after each sync, so let the sync cmd do this
		//the super-assistant cares for calling the sync cmd and also the periodic activity.
		if (!enabled) {
			for (kind in this.client.kinds.objects) {
				if (this.client.kinds.objects.hasOwnProperty(kind) && this.client.kinds.objects[kind].allowUpsync) {
					Log.debug("Kind ", kind, " has upsync, cancelling its activity.");
					names.push("SyncOnEdit:" + serviceName + ":" + accountId + ":" + this.client.kinds.objects[kind].name);
				}
			}
		}

		if (enabled) {
			leaveInitialSyncToLastEnable();
		}

		runForAccount(accountId, enabled, function (finished) {
			function cancelCB(f) {
				Log.debug("Result of cancel callback: ", checkResult(f));

				cancelCalls -= 1;
				if (cancelCalls <= 0) {
					Log.debug("Finished canceling activities. Continue with disabling capability.");
					recreatePeriodicSync(finished);
				} else {
					Log.debug("Still waiting for ", cancelCalls, " cancel callbacks.");
				}
			}

			cancelCalls = names.length;
			names.forEach(function (activityName) {
				PalmCall.call("palm://com.palm.activitymanager", "cancel", { activityName: activityName }).then(cancelCB);
			});

			if (cancelCalls === 0) {
				Log.debug("Had no sync on edit activities, continue directly.");
				runSuper(finished, BUSY_RETRIES);
			}
		});

		return outerFuture;
	}
});
