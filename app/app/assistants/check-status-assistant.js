//JSLint options:
/*jslint browser: true */
/*global $L, Mojo, AppAssistant, console, PalmCall, log */
function CheckStatusAssistant(params) {
	"use strict";
	if (params) {
		this.accountId = params.accountId;
	}

	if (!this.accountId) {
		Mojo.Log.error("No accountId in parameters!");
	}
}

CheckStatusAssistant.prototype.setup = function () {
	"use strict";
	this.runningDisplay = this.controller.get("txtRunning");
	this.messageDisplay = this.controller.get("txtMessage");
	this.downNumbersDisplay = this.controller.get("txtDownNumbers");
	this.upNumbersDisplay = this.controller.get("txtUpNumbers");

	this.startSyncModel = {label: $L("Start sync")};
	this.controller.setupWidget("btnStartSync", {type: Mojo.Widget.activityButton}, this.startSyncModel);

	this.button = this.controller.get("btnStartSync");
	Mojo.Event.listen(this.button, Mojo.Event.tap, this.startSync.bind(this));
};

CheckStatusAssistant.prototype.startSync = function () {
	"use strict";
	if (!this.syncing) {
		this.syncing = true;

		this.button.mojo.activate();
		this.startSyncModel.disabled = true;
		this.controller.modelChanged(this.startSyncModel);

		PalmCall.call("palm://org.webosports.cdav.service/",
					  "sync",
					  {accountId: this.accountId}).then(this, function serviceCB(f) {
			var result = f.exception || f.result;

			this.syncing = false;
			this.button.mojo.deactivate();
			this.startSyncModel.disabled = false;
			if (this.controller) { //otherwise scene was already popped.
				this.controller.modelChanged(this.startSyncModel);

				this.controller.showAlertDialog({
					title: "Sync finished",
					message: "Sync came back with result: " + JSON.stringify(result),
					choices: [{label: $L("OK"), value: "OK"}]
				});
			}
		});
	}
};

CheckStatusAssistant.prototype.setNumContacts = function (num) {
	"use strict";
	if (!this.contactsDisplay) {
		this.contactsDisplay = this.controller.get("txtContacts");
	}
	this.contactsDisplay.innerHTML = "Number of contacts: " + num;
};

CheckStatusAssistant.prototype.setNumCalendars = function (num) {
	"use strict";
	if (!this.calendarsDisplay) {
		this.calendarsDisplay = this.controller.get("txtCalendars");
	}
	this.calendarsDisplay.innerHTML = "Number of calendars: " + num;
};

CheckStatusAssistant.prototype.setNumEvents = function (num) {
	"use strict";
	if (!this.eventsDisplay) {
		this.eventsDisplay = this.controller.get("txtEvents");
	}
	this.eventsDisplay.innerHTML = "Number of events: " + num;
};

CheckStatusAssistant.prototype.getNumobjects = function (kind, callback) {
	"use strict";
	var query = {
			select: ["_id"], //reduce memory footprint
			limit: 1, //reduce memory footprint
			from: kind,
			where: [{prop: "accountId", op: "=", val: this.accountId}]
		},
		callbackFunc,
		doFind,
		doWatch,
		request;

	callbackFunc = function (result) {
		if (result.returnValue) {
			console.log("Successful result: " + JSON.stringify(result));
			if (result.fired) {
				console.log("Watch fired, get items again.");
				return this.getNumobjects(kind, callback); //should nest futures and prevents our then.
			} else if (result.count !== undefined) {
				console.log("Count result");
				callback(result.count);
			}
		} else {
			console.log("Error in getNumObjects " + kind + ": " + JSON.stringify(result));
			console.log("Will try again in a few seconds..");
			setTimeout(this.getNumobjects.bind(this, kind, callback), 30000);
		}
	};

	doFind = function (result) {
		console.log("Watch result: " + JSON.stringify(result));
		this.controller.serviceRequest("palm://com.palm.db/", {
			method: "find",
			parameters: {
				query: query,
				count: true
			},
			onSuccess: callbackFunc,
			onFailure: function (failure) {
				console.error("Got error from db: " + JSON.stringify(failure));
			}
		});
	}.bind(this);

	doWatch = function () {
		request = this.controller.serviceRequest("palm://com.palm.db/", {
			method: "watch",
			parameters: {
				query: {
					from: kind,
					where: [{prop: "accountId", op: "=", val: this.accountId}]
				}
			},
			subscribe: true,
			onSuccess: doFind,
			onFailure: function (failure) {
				console.error("Got error from db: " + JSON.stringify(failure));
			}
		}, true);
	}.bind(this);

	doWatch();
};

CheckStatusAssistant.prototype.processStatus = function (status) {
	"use strict";
	if (status.running) {
		var kind, stat, found = false;
		for (kind in status) {
			if (status.hasOwnProperty(kind) && typeof status[kind] === "object") {
				if (status[kind].running) {
					if (!found) {
						found = true;
					} else {
						console.warn("Multiple kinds running? Can't be right. Just showing the last one.");
					}
					this.runningDisplay.innerHTML = "Sync for " + kind + " is running.";
					stat = status[kind];
					if (stat.status) {
						this.messageDisplay.innerHTML = "Status: " + stat.status;
						this.lastStatus = stat.status;
					}
					if (stat.uploadTotal) {
						this.upNumbersDisplay.innerHTML = "Uploading " + (stat.uploadsDone || 0) + " of " + stat.uploadTotal;
					} else {
						this.upNumbersDisplay.innerHTML = "No uploads";
					}
					if (stat.downloadTotal) {
						this.upNumbersDisplay.innerHTML = "Downloading " + (stat.downloadsDone || 0) + " of " + stat.downloadTotal;
					} else {
						this.upNumbersDisplay.innerHTML = "No downloads";
					}
				}
			}
		}

	} else {
		this.runningDisplay.innerHTML = "Sync is not running.";
		this.downNumbersDisplay.innerHTML = "No downloads";
		this.upNumbersDisplay.innerHTML = "No uploads";
		if (this.lastStatus) {
			this.messageDisplay.innerHTML = "Last status: " + this.lastStatus;
		} else {
			this.messageDisplay.innerHTML = "Status:";
		}
	}
};

CheckStatusAssistant.prototype.checkStatus = function () {
	"use strict";
	var future = PalmCall.call("palm://org.webosports.cdav.service/", "checkStatus", {accountId: this.accountId, subscribe: true}),
		getResult;

	getResult = function () {
		var result = future.result;
		if (result.returnValue) {
			console.log("Got new status: " + JSON.stringify(result));
			this.processStatus(result);
		} else {
			console.error("Failed to get status: " + JSON.stringify(result));
		}

		future.then(this, getResult);
	};

	future.then(this, getResult);
};

CheckStatusAssistant.prototype.activate = function (event) {
	"use strict";

	if (event) {
		log("Got params:" + JSON.stringify(event));
	}

	this.getNumobjects("org.webosports.cdav.contact:1", this.setNumContacts.bind(this));
	this.getNumobjects("org.webosports.cdav.calendar:1", this.setNumCalendars.bind(this));
	this.getNumobjects("org.webosports.cdav.calendarevent:1", this.setNumEvents.bind(this));
	this.checkStatus();
};

CheckStatusAssistant.prototype.deactivate = function (event) {
	"use strict";
	/* remove any event handlers you added in activate and do any other cleanup that should happen before
	   this scene is popped or another scene is pushed on top */
};

CheckStatusAssistant.prototype.cleanup = function (event) {
	"use strict";
	/* this function should do any cleanup needed before the scene is destroyed as
	   a result of being popped off the scene stack */
};
