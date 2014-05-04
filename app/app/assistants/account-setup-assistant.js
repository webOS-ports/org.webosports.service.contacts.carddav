/*jslint sloppy: true, browser: true, devel: true */
/*global PalmCall, Mojo, log, $L, showError */
/* Simple debug function to print out to console error */
var debug = function (param) {
    console.error("DEBUG: " + param);
};

function AccountSetupAssistant(params) {
    /* this is the creator function for your scene assistant object. It will be passed all the
       additional parameters (after the scene name) that were passed to pushScene. The reference
       to the scene controller (this.controller) has not be established yet, so any initialization
       that needs the scene controller should be done in the setup function below. */
    this.params = params;
    debug("Got params: " + JSON.stringify(this.params));
}

AccountSetupAssistant.prototype.setup = function () {
    /* this function is for setup tasks that have to happen when the scene is first created */
    /* use Mojo.View.render to render view templates and add them to the scene, if needed */

    this.account = { credentials: {}};
    this.account.isModified = true;

    if (!this.account.credentials) {
        this.account.credentials = {};
    }

    /* setup widgets here */
    this.controller.setupWidget("txtName", { modelProperty: "name", hintText: $L("Display Name"), textCase: Mojo.Widget.steModeLowerCase }, this.account);
    this.controller.setupWidget("txtURL", { modelProperty: "url", hintText: $L("URL"), textCase: Mojo.Widget.steModeLowerCase }, this.account);
    this.controller.setupWidget("txtUser", { modelProperty: "user", hintText: $L("Username"), textCase: Mojo.Widget.steModeLowerCase}, this.account.credentials);
    this.controller.setupWidget("txtPass", { modelProperty: "password", hintText: $L("Password"), textCase: Mojo.Widget.steModeLowerCase}, this.account.credentials);

    this.btnSaveModel = { buttonClass: 'primary', label: $L("Check Credentials"), disabled: false};
    this.controller.setupWidget("btnSave", {type: Mojo.Widget.activityButton}, this.btnSaveModel);
    Mojo.Event.listen(this.controller.get("btnSave"), Mojo.Event.tap, this.checkCredentials.bind(this));

    this.spinnerModel = { spinning: false };
    this.controller.setupWidget("saveSpinner", this.attributes = { spinnerSize: "large" }, this.spinnerModel);
    this.controller.get('Scrim').hide();

    if (!this.params) {
        setTimeout(function () {
            this.disableControls();
            showError(this.controller, "Account App", "Please run this from account app, not standalane.");
        }.bind(this), 100);
    }
};

AccountSetupAssistant.prototype.enableControls = function () {
    //Disable spinning login button
    this.controller.get("btnSave").mojo.deactivate();
    this.controller.get('Scrim').hide();
    this.controller.get('saveSpinner').mojo.stop();

    //Enable other controls
    this.account.disabled = false;
};

AccountSetupAssistant.prototype.disableControls = function () {
    //Disable spinning login button
    this.controller.get("btnSave").mojo.activate();
    this.controller.get('Scrim').show();
    this.controller.get('saveSpinner').mojo.start();

    //disable other controls
    this.account.disabled = true;
};

AccountSetupAssistant.prototype.checkCredentials = function () {
    this.disableControls();
    var i, credFuture;

    if (!this.account.name) {
        log("Need account.name to add account");
        this.showLoginError("Account Name", "Please specify a valid account name.");
        return;
    }

    if (!this.account.url) {
        log("Need account.url to add account");
        this.showLoginError("URL", "Please specify a valid account url.");
        return;
    }

    if (!this.account.credentials.user) {
        log("Need account.username to add account");
        this.showLoginError("username", "Please specify a valid account username.");
        return;
    }

    if (!this.account.credentials.password) {
        log("Need account.password to add account");
        this.showLoginError("Password", "Please specify a valid account password.");
        return;
    }

    credFuture = PalmCall.call("palm://org.webosports.cdav.service/", "checkCredentials", {
        username: this.account.credentials.user,
        password: this.account.credentials.password,
        url: this.account.url,
        name: this.account.name
    });
    credFuture.then(this, function (f) {
        try {
            var exception = f.exception, result = f.result, template;
            if (result && result.success) {
                debug("Check credentials came back successful");

                this.accountSettings = {};
                template = this.params.initialTemplate;
                template.config = this.account;
                delete template.username;
                delete template.password;

                for (i = 0; i < template.capabilityProviders.length; i += 1) {
                    if (template.capabilityProviders[i].capability === "CONTACTS") {
                        template.capabilityProviders[i].enabled = true;
                        template.capabilityProviders[i].loc_name = this.account.name + " Contacts";
                        break;
                    }
                }

                template.loc_name = this.account.name;
                this.accountSettings = {
                    template: this.params.initialTemplate,
                    username: this.account.credentials.user,
                    alias: this.account.name,
                    defaultResult: {
                        result: {
                            returnValue: true,
                            credentials: this.account.credentials,
                            config: this.account
                        }
                    }
                };
                //Pop back to Account Creation Dialog
                this.popScene();
            } else {
                log("CheckCredentials came back, but failed, message: " + result.reason);
                this.showLoginError("Credentials", "Credentials were wrong or could not be checked." + (result.reason ? " Message: " + result.reason : ""));
            }
        } catch (e) {
            log("Future exception: " + JSON.stringify(e));
            this.showLoginError("Credentials", "Credentials were wrong or could not be checked. " + e.innerError);
        }
    });
};

AccountSetupAssistant.prototype.showLoginError = function (ErrorTitle, ErrorText) {
    showError(this.controller, ErrorTitle, ErrorText);

    this.enableControls();
    return;
};

AccountSetupAssistant.prototype.popScene = function () {
    if (this.params) {
        if (this.params.aboutToActivateCallback !== undefined) {
            this.params.aboutToActivateCallback(true);
        }
        debug("AccountSetupAssistant popping scene.");
        Mojo.Log.info("AccountSetupAssistant popping scene.");
        Mojo.Log.info("AccountSetupAssistant accountSettings=", JSON.stringify(this.accountSettings));
    }
    this.controller.stageController.popScene(this.accountSettings);
};

AccountSetupAssistant.prototype.activate = function (event) {
    /* put in event handlers here that should only be in effect when this scene is active. For
       example, key handlers that are observing the document */
};

AccountSetupAssistant.prototype.aboutToDeactivate = function (event) {
};

AccountSetupAssistant.prototype.deactivate = function (event) {
    /* remove any event handlers you added in activate and do any other cleanup that should happen before
       this scene is popped or another scene is pushed on top */
};

AccountSetupAssistant.prototype.cleanup = function (event) {
    /* this function should do any cleanup needed before the scene is destroyed as
       a result of being popped off the scene stack */
};
