/*jslint sloppy: true */
/*global enyo, $L, console */
/*exported log */

function log(msg) {
	console.error(msg);
}

function debug(msg) {
	console.error(msg);
}

enyo.kind({
	name: "Main.CDavApp",
	width: "100%",
	kind: "VFlexBox",
	className: "enyo-bg",
	components: [
		//trouble shooting actions:
		{ name: "discovery", kind: "PalmService", service: "palm://org.webosports.cdav.service/",
			method: "discovery", onSuccess: "cdavOK", onFailure: "cdavFailed" },
		{ name: "sync", kind: "PalmService", service: "palm://org.webosports.cdav.service/",
			method: "sync", onSuccess: "cdavOK", onFailure: "cdavFailed" },
		{ name: "triggerSlowSync", kind: "PalmService", service: "palm://org.webosports.cdav.service/",
			method: "triggerSlowSync", onSuccess: "cdavOK", onFailure: "cdavFailed" },

		//get accounts:
		{ name: "dbAccounts", kind: "DbService", dbKind: "org.webosports.cdav.account.config:1", onFailure: "cdavFailed", components: [
			{ name: "findAccounts", method: "find", onSuccess: "refreshAccounts" }
		]},

		//stats:
		{
			kind: "DbService",
			method: "find",
			recallWatches: true,
			resubscribe: true,
			name: "dbContactWatch",
			dbKind: "org.webosports.cdav.contact:1",
			onSuccess: "gotConactNumbers"
		},
		{
			kind: "DbService",
			method: "find",
			recallWatches: true,
			resubscribe: true,
			name: "dbCalendarWatch",
			dbKind: "org.webosports.cdav.calendar:1",
			onSuccess: "gotCalendarNumbers"
		},
		{
			kind: "DbService",
			method: "find",
			recallWatches: true,
			resubscribe: true,
			name: "dbCalendarEventWatch",
			dbKind: "org.webosports.cdav.calendarevent:1",
			onSuccess: "gotCalendarEventNumbers"
		},

		//status:
		{
			name: "checkStatus",
			kind: "PalmService",
			service: "palm://org.webosports.cdav.service/",
			method: "checkStatus",
			onSuccess: "statusResult",
			subscribe: true,
			resubscribe: true
		},

		{ kind: "PageHeader", content: $L("C+Dav Application"), pack: "center" },
		{ kind: "Scroller", flex: 1, style: "margin:30px;", components: [
			{ name: "alert", style: "margin-bottom:30px;text-align:center; background-color:red; color:yellow;" },
			{ name: "success", style: "margin-bottom:30px;text-align:center; background-color:green; color:yellow;" },
			{ kind: "Picker", label: $L("Account: "), onChange: "accountChanged"},
			{ kind: "RowGroup", caption: $L("Stats"), components: [
				{name: "numContacts", content: $L("Number of contacts: tbd")},
				{name: "numCalendars", content: $L("Number of calendars: tbd")},
				{name: "numEvents", content: $L("Number of events: tbd")}
			]},
			{ kind: "RowGroup", caption: $L("Status"), components: [
				{name: "running", content: $L("Sync not running."), showing: false },
				{name: "lastMessage", content: $L("Status: ") },
				{name: "numDownloaded", content: $L("Downloads: ") },
				{name: "numUploaded", content: $L("Uploads: ") }
			]},
			{ name: "buttonContainer", kind: "RowGroup", caption: $L("Trouble shooting"), components: [
				{ kind: "Button", tabIndex: "1",  caption: $L("Trigger Slow Sync"), onclick: "doTriggerSlowSync", className: "enyo-button-dark" },
				{ kind: "Button", tabIndex: "2",  caption: $L("Do Auto Discovery"), onclick: "doDiscovery", className: "enyo-button-dark" },
				{ kind: "Button", tabIndex: "3",  caption: $L("Start Sync"), onclick: "doSync", className: "enyo-button-dark" }
			]},
			{kind: "VFlexBox", className: "box-center", flex: 1, pack: "center", align: "center", components: [
				{ kind: "SpinnerLarge", name: "spinner" }
			]}
		]},
		{className: "accounts-footer-shadow", tabIndex: -1}
	],
	create: function () {
		this.inherited(arguments);

		this.$.findAccounts.call({query: {from: "org.webosports.cdav.account.config:1"}});
	},
	refreshAccounts: function (inSender, inResponse) {
		debug("Response from db: " + JSON.stringify(inResponse));

		this.accounts = inResponse.results;
		var i, items = [];

		if (this.accounts.length > 0) {
			for (i = 0; i < this.accounts.length; i += 1) {
				items.push({caption: this.accounts[i].name, value: this.accounts[i].accountId});
			}
		} else {
			items.push({caption: $L("No accounts"), value: false});
			this.$.picker.setDisabled(true);
		}
		this.$.picker.setItems(items);
		this.$.picker.setValue(items[0].value);
		this.$.picker.render();

		if (this.accounts.length > 0) {
			this.accountChanged();
		}
	},
	showError: function (msg) {
		debug("Error: " + msg);
		this.$.success.setContent("");
		this.$.alert.setContent(msg);
	},
	showSuccess: function (msg) {
		debug("Success: " + msg);
		this.$.alert.setContent("");
		this.$.success.setContent(msg);
	},
	doTriggerSlowSync: function () {
		var accountId = this.$.picker.getValue();

		debug("AccountId: " + JSON.stringify(accountId));
		if (accountId) {
			this.inidcateActivity();
			this.showError("");
			debug("Starting call...");
			this.$.triggerSlowSync.call({
				accountId: accountId
			});
			debug("... done... ");
		}
	},
	doDiscovery: function () {
		var accountId = this.$.picker.getValue();

		if (accountId) {
			this.inidcateActivity();
			this.showError("");
			this.$.discovery.call({
				accountId: accountId
			});
		}
	},
	doSync: function () {
		var accountId = this.$.picker.getValue();

		if (accountId) {
			this.inidcateActivity();
			this.showError("");
			this.$.sync.call({
				accountId: accountId
			});
		}
	},
	cdavOK: function (inSender, inResponse) {
		this.endAcitivity();

		debug("Success Response: " + JSON.stringify(inResponse));
		this.showSuccess("Method success: " + JSON.stringify(inResponse));
	},
	cdavFailed: function (inSender, inResponse) {
		this.endAcitivity();

		debug("Error Response: " + JSON.stringify(inResponse));
		this.showError("Method failure: " + JSON.stringify(inResponse));
	},
	inidcateActivity: function () {
		this.$.buttonContainer.hide();
		this.$.spinner.show();
	},
	endAcitivity: function () {
		this.$.spinner.hide();
		this.$.buttonContainer.show();
	},

	resetStats: function () {
		this.$.numContacts.setContent($L("Number of contacts: tbd"));
		this.$.numCalendars.setContent($L("Number of calendars: tbd"));
		this.$.numEvents.setContent($L("Number of events: tbd"));

		this.$.running.setContent($L("Sync is not running."));
		this.$.lastMessage.setContent($L("Status: "));
		this.$.numDownloaded.setContent($L("Downloads: "));
		this.$.numUploaded.setContent($L("Uploads: "));
	},
	gotConactNumbers: function (inSender, inResponse) {
		if (inResponse) {
			console.log("Got contactNumbers: " + JSON.stringify(inResponse));
			this.$.numContacts.setContent($L("Number of contacts: ") + inResponse.count);
		}
	},
	gotCalendarNumbers: function (inSender, inResponse) {
		if (inResponse) {
			console.log("Got calendarNumbers: " + JSON.stringify(inResponse));
			this.$.numCalendars.setContent($L("Number of calendars: ") + inResponse.count);
		}
	},
	gotCalendarEventNumbers: function (inSender, inResponse) {
		if (inResponse) {
			console.log("Got calendarEventNumbers: " + JSON.stringify(inResponse));
			this.$.numEvents.setContent($L("Number of events: ") + inResponse.count);
		}
	},
	accountChanged: function () {
		console.log("accountChanged to " + this.$.picker.getValue());
		this.resetStats();
		this.getStats();
		this.getStatus();
	},
	getStats: function () {
		var accountId = this.$.picker.getValue();
		this.$.dbContactWatch.cancel();
		this.$.dbCalendarWatch.cancel();
		this.$.dbCalendarEventWatch.cancel();
		if (accountId) {
			console.log("Getting stats...");
			this.contactsWatchRequest = this.$.dbContactWatch.call({ query: { limit: 1, where: [{ "prop": "accountId", op: "=", val: accountId}], select: ["_id"] }, watch: true, count: true });
			this.calendarsWatchRequest = this.$.dbCalendarWatch.call({ query: { limit: 1, where: [{ "prop": "accountId", op: "=", val: accountId}], select: ["_id"] }, watch: true, count: true });
			this.calendarEventsWatchRequest = this.$.dbCalendarEventWatch.call({ query: { limit: 1, where: [{ "prop": "accountId", op: "=", val: accountId}], select: ["_id"] }, watch: true, count: true });
		}
	},
	getStatus: function () {
		var accountId = this.$.picker.getValue();
		this.$.checkStatus.cancel();
		if (accountId) {
			console.log("Getting status...");
			this.$.checkStatus.call({accountId: accountId});
		}
	},
	statusResult: function (inSender, status) {
		console.log("Got status: " + JSON.stringify(status));
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
						this.$.running.setContent($L("Sync for " + kind + " is running."));
						stat = status[kind];
						if (stat.status) {
							this.$.lastMessage.setContent("Status: " + stat.status);
						}
						if (stat.uploadTotal) {
							this.$.numDownloaded.setContent("Uploading " + (stat.uploadsDone || 0) + " of " + stat.uploadTotal);
						} else {
							this.$.numUploaded.setContent($L("Uploads: "));
						}
						if (stat.downloadTotal) {
							this.$.numDownloaded.setContent("Downloading " + (stat.downloadsDone || 0) + " of " + stat.downloadTotal);
						} else {
							this.$.numDownloaded.setContent($L("Downloads: "));
						}
					}
				}
			}

		} else {
			this.$.running.setContent($L("Sync is not running."));
			this.$.lastMessage.setContent($L("Status: "));
			this.$.numDownloaded.setContent($L("Downloads: "));
			this.$.numUploaded.setContent($L("Uploads: "));
		}
	}

});
