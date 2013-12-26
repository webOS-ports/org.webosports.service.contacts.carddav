//JSLint options:
/*global $L, Mojo, AppAssistant, console, PalmCall */
function MainAssistant() {
    "use strict";
}

MainAssistant.prototype.setup = function () {
    "use strict";
    this.triggerSlowModel = {label: $L("Trigger Slow Sync"), disabled: true};
    this.discoveryModel = {label: $L("Do auto discovery"), disabled: true};
    this.startSyncModel = {label: $L("Start sync"), disabled: true};

    //this.controller.setupWidget(Mojo.Menu.appMenu, {}, AppAssistant.prototype.MenuModel);

    /* setup widgets here */
    this.controller.setupWidget("btnTriggerSlow", {}, this.triggerSlowModel);
    this.controller.setupWidget("btnTriggerDiscovery", {}, this.discoveryModel);
    this.controller.setupWidget("btnStartSync", {}, this.startSyncModel);

    this.dropboxModel = {choices: [], disabled: true };
    this.dropBox = this.controller.setupWidget("lsAccounts", {label: $L("Account")}, this.dropboxModel);

    this.spinnerModel = { spinning: true };
    this.controller.setupWidget("loadSpinner", this.attributes = { spinnerSize: "large" }, this.spinnerModel);

    /* add event handlers to listen to events from widgets */
    Mojo.Event.listen(this.controller.get("btnTriggerSlow"), Mojo.Event.tap, this.triggerSlow.bind(this));
    Mojo.Event.listen(this.controller.get("btnTriggerDiscovery"), Mojo.Event.tap, this.startDiscovery.bind(this));
    Mojo.Event.listen(this.controller.get("btnStartSync"), Mojo.Event.tap, this.startSync.bind(this));
};

MainAssistant.prototype.startSync = function (event) {
    "use strict";
    this.callService("sync");
};

MainAssistant.prototype.startDiscovery = function (event) {
    "use strict";
    this.callService("discovery");
};

MainAssistant.prototype.triggerSlow = function (event) {
    "use strict";
    this.callService("triggerSlowSync");
};

MainAssistant.prototype.callService = function (method) {
    "use strict";
    console.error("Selecting account " + this.dropboxModel.value);
    this.currentAccount = this.dropboxModel.value;
    if (this.currentAccount !== -1) {
        PalmCall.call("palm://org.webosports.cdav.service/",
                      method,
                      this.accounts[this.currentAccount]).then(this, function serviceCB(f) {
            var result = f.result;
            this.showMessage(method + " Result", "Sync result: " + JSON.stringify(result));
        });
    } else {
        this.showMessage($L("Error"), "You need to select an account first.");
    }
};

MainAssistant.prototype.refreshAccounts = function () {
    "use strict";
    var i;
    this.dropboxModel.choices = [];
    for (i = 0; i < this.accounts.length; i += 1) {
        console.error("Got account: " + this.accounts[i].name);
        this.dropboxModel.choices.push({label: this.accounts[i].name, value: i});
    }

    if (!this.dropboxModel.value || this.dropboxModel.value < 0 || this.dropboxModel.value >= this.accounts.length) {
        this.dropboxModel.value = 0;
    }

    this.dropboxModel.disabled = false;
    this.controller.modelChanged(this.dropboxModel);
    this.controller.get('Scrim').hide();
    this.controller.get('loadSpinner').mojo.stop();
    this.triggerSlowModel.disabled = false;
    this.discoveryModel.disabled = false;
    this.startSyncModel.disabled = false;
    this.controller.modelChanged(this.triggerSlowModel);
    this.controller.modelChanged(this.discoveryModel);
    this.controller.modelChanged(this.startSyncModel);
};

MainAssistant.prototype.activate = function (event) {
    "use strict";
    this.triggerSlowModel.disabled = true;
    this.discoveryModel.disabled = true;
    this.startSyncModel.disabled = true;
    this.controller.modelChanged(this.triggerSlowModel);
    this.controller.modelChanged(this.discoveryModel);
    this.controller.modelChanged(this.startSyncModel);
    this.controller.get('Scrim').show();
    this.controller.get('loadSpinner').mojo.start();

    PalmCall.call("palm://com.palm.db/", "find",
                  {query: {from: "org.webosports.cdav.account.config:1"}}).then(this, function (f) {
        var result = f.result;
        if (result.returnValue === true) {
            console.error("Got accounts.");
            this.accounts = f.result.results;
            console.error("Now have " + this.accounts.length + " accounts.");
            if (this.accounts.length > 0) {
                this.currentAccount = 0;
            }
            this.refreshAccounts();
            console.error("Ready to go.");
        } else {
            console.error("Could not get accounts..." + JSON.stringify(f.result));
            this.showMessage("Error", "Could not get accounts. Error: " + JSON.stringify(f.result));
        }
    });
};

MainAssistant.prototype.showMessage = function (title, message) {
    "use strict";
    this.controller.showAlertDialog({
        title: title,
        message: message,
        choices: [{label: $L("OK"), value: "OK"}]
    });
};


MainAssistant.prototype.deactivate = function (event) {
    "use strict";
	/* remove any event handlers you added in activate and do any other cleanup that should happen before
	   this scene is popped or another scene is pushed on top */
};

MainAssistant.prototype.cleanup = function (event) {
    "use strict";
	/* this function should do any cleanup needed before the scene is destroyed as
	   a result of being popped off the scene stack */
};
