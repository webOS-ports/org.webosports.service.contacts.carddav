/*jslint sloppy: true */
/*global enyo, $L, console, setTimeout, PalmSystem */

function log(msg) {
    console.error(msg);
}

function debug(msg) {
    console.error(msg);
}

enyo.kind({
    name: "Main.CrossAppLaunch",
    width: "100%",
    kind: "VFlexBox",
    className: "enyo-bg",
    components: [
        { name: "checkCredentials", kind: "PalmService", service: "palm://org.webosports.cdav.service/",
            method: "checkCredentials", onSuccess: "credentialsOK", onFailure: "credentialsWrong" },
        {kind: "ApplicationEvents", onWindowParamsChange: "windowParamsChangeHandler"},
        { kind: "PageHeader", content: "Sign In", pack: "center" },
        { kind: "Scroller", flex: 1, style: "margin:30px;", components: [
            { name: "alert", style: "margin-bottom:30px;text-align:center; background-color:red; color:yellow;" },
            { kind: "RowGroup", caption: "Connection settings", components: [
                {kind: "InputBox", components: [
                    {kind: "Input", hint: "Name", value: "", name: "txtServerName", tabIndex: "0", spellcheck: false,
                        className: "enyo-first babelfish", flex: 1, autocorrect: false, autoCapitalize: "lowercase", components: [
                        {content: "Name"}
                    ]}
                ]},
                {kind: "InputBox", components: [
                    {kind: "Input", hint: "URL", value: "https://", name: "txtURL", tabIndex: "0", spellcheck: false,
                        className: "enyo-first babelfish", flex: 1, autocorrect: false, autoCapitalize: "lowercase", inputType: "url", components: [
                        {content: "URL"}
                    ]}
                ]},
                {kind: "InputBox", components: [
                    {kind: "Input", hint: "Username", value: "", name: "txtUsername", tabIndex: "0", spellcheck: false,
                        className: "enyo-first babelfish", flex: 1, autocorrect: false, autoCapitalize: "lowercase", inputType: "email", components: [
                        {content: "Username"}
                    ]}
                ]},
                {kind: "InputBox", components: [
                    {kind: "PasswordInput", hint: "Password", value: "", name: "txtPassword", tabIndex: "0", spellcheck: false,
                        className: "enyo-first babelfish", flex: 1, autocorrect: false, autoCapitalize: "lowercase", components: [
                        {content: "Password"}
                    ]}
                ]},
                { kind: "Button", tabIndex: "4",  caption: "Check Credentials", onclick: "doCheckCredentials", className: "enyo-button-dark" }
            ]}
        ]},
        {kind: "CrossAppResult", name: "crossAppResult" },
        {className: "accounts-footer-shadow", tabIndex: -1},
        {kind: "Toolbar", className: "enyo-toolbar-light", components: [
            { name: "doneButton", kind: "Button", caption: "Back", onclick: "doBack", className: "accounts-toolbar-btn"}
        ]}
    ],
    create: function () {
        this.inherited(arguments);
        console.error(">>>>>>>>>>>>>>>>>>>> create");
        console.error("Parameters: " + JSON.stringify(arguments));

        if (PalmSystem.launchParams) {
            console.error("Params from PalmSystem: " + PalmSystem.launchParams);
            this.params = JSON.parse(PalmSystem.launchParams);
        }

        if (enyo.windowParams) {
            console.error("Params from enyo: " + JSON.stringify(enyo.windowParams));
            this.params = enyo.windowParams;
        }

        console.error("<<<<<<<<<<<<<<<<<<<< create");
    },
    showLoginError: function (caption, msg) {
        this.$.alert.setContent(msg);
    },
    doCheckCredentials: function () {
        // Capture the user data
        this.account = {
            name: this.$.txtServerName.getValue(),
            url: this.$.txtURL.getValue(),
            credentials: {
                user: this.$.txtUsername.getValue(),
                password: this.$.txtPassword.getValue()
            }
        };

        this.$.alert.setContent("");
        if (!this.params) {
            console.error("No params!");
            this.$.alert.setContent($L("No parameters received. This needs to be called from Account Manager."));
            return;
        }

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

        enyo.scrim.show();
        this.showLoginError("", "");
        this.$.checkCredentials.call({
            username: this.account.credentials.user,
            password: this.account.credentials.password,
            url: this.account.url,
            name: this.account.name
        });
    },
    credentialsOK: function (inSender, inResponse) {
        debug("Service Response: " + JSON.stringify(inResponse));
        if (inResponse.success) {
            debug("Check credentials came back successful");

            if (!this.params) {
                this.showLoginError("Account App", "Please do run this from account app, not stand alanoe.");
                return;
            }

            this.accountSettings = {};
            var i, template = this.params.template;
            if (!template) {
                template = {
                    "templateId": "org.webosports.cdav.account",
                    "loc_name": "C+DAV Connector",
                    "readPermissions": [
                        "org.webosports.cdav.service",
                        "com.palm.service.contacts",
                        "com.palm.service.contacts.linker",
                        "com.palm.app.contacts"
                    ],
                    "writePermissions": [
                        "org.webosports.cdav.service",
                        "com.palm.app.accounts",
                        "com.palm.app.contacts"
                    ],
                    "validator": {
                        "address": "palm://org.webosports.cdav.service/checkCredentials",
                        "customUI": {
                            "appId": "org.webosports.cdav.app",
                            "name": "index.html"
                        }
                    },
                    "onCredentialsChanged": "palm://org.webosports.cdav.service/onCredentialsChanged",
                    "loc_usernameLabel": "Username",
                    "icon": {
                        "loc_32x32": "images/webos-ports32.png"
                    },
                    "capabilityProviders": [
                        {
                            "capability": "CONTACTS",
                            "id": "org.webosports.cdav.contact",
                            "onCreate": "palm://org.webosports.cdav.service/onContactsCreate",
                            "onEnabled": "palm://org.webosports.cdav.service/onContactsEnabled",
                            "onDelete": "palm://org.webosports.cdav.service/onContactsDelete",
                            "sync": "palm://org.webosports.cdav.service/sync",
                            "loc_name": "CardDAV Contacts",
                            "dbkinds": {
                                "contactset": "org.webosports.cdav.contactset:1",
                                "contact": "org.webosports.cdav.contact:1"
                            }
                        },
                        {
                            "capability": "CALENDAR",
                            "id": "org.webosports.cdav.calendar",
                            "onCreate": "palm://org.webosports.cdav.service/onCalendarCreate",
                            "onDelete": "palm://org.webosports.cdav.service/onCalendarDelete",
                            "onEnabled": "palm://org.webosports.cdav.service/onCalendarEnabled",
                            "sync": "palm://org.webosports.cdav.service/sync",
                            "loc_name": "CalDav Calendar",
                            "dbkinds": {
                                "calendar": "org.webosports.cdav.calendar:1",
                                "calendarevent": "org.webosports.cdav.calendarevent:1"
                            }
                        }
                    ]
                };
            }
            template.config = this.account;
            delete template.username;
            delete template.password;

            for (i = 0; i < template.capabilityProviders.length; i += 1) {
                if (template.capabilityProviders[i].capability === "CONTACTS") {
                    template.capabilityProviders[i].enabled = true;
                    template.capabilityProviders[i].loc_name = this.account.name + " Contacts";
                    break;
                }
                if (template.capabilityProviders[i].capability === "CALENDAR") {
                    template.capabilityProviders[i].enabled = true;
                    template.capabilityProviders[i].loc_name = this.account.name + " Calendar";
                    break;
                }
            }

            template.loc_name = this.account.name;
            this.accountSettings = {
                template: this.params.template,
                username: this.account.credentials.user,
                credentials: this.account.credentials,
                config: this.account,
                alias: this.account.name,
                returnValue: true
            };
            //Pop back to Account Creation Dialog
            // Set val as a parameter to be passed back to our source application
            this.$.crossAppResult.sendResult(this.accountSettings);
            //this.popScene(); hopefully enyo account manager does that for us?
        } else {
            this.credentialsWrong(inSender, inResponse);
        }
        enyo.scrim.hide();
    },
    credentialsWrong: function (inSender, inResponse) {
        enyo.scrim.hide();
        log("CheckCredentials came back, but failed.");
        debug("Response: " + JSON.stringify(inResponse));
        this.showLoginError("Credentials", "Credentials were wrong or could not be checked." + (inResponse.reason ? " Message: " + inResponse.reason : ""));
    },
    // called when app is opened or reopened
    windowParamsChangeHandler: function (inSender, event) {
        console.error(">>>>>>>>>>>>>>>>>>>> windowParamsChangeHandler");
        // capture any parameters associated with this app instance
        if (!event || !event.params) {
            console.error("No params received...");
            setTimeout(function () {
                this.$.alert.setContent($L("No parameters received. This needs to be called from Account Manager."));
            }.bind(this), 500);
        } else {
            if (event.params.template) {
                this.params = event.params;
                console.error("Params: " + JSON.stringify(this.params));
            } else {
                console.error("Skipping params, because they don't contain template information.");
            }

        }

        console.error("<<<<<<<<<<<<<<<<<<<< windowParamsChangeHandler");
    },
    doBack: function () {
        this.$.crossAppResult.sendResult({returnValue: false});
    }
});