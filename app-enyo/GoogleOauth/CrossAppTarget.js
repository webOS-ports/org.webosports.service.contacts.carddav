/*jslint sloppy: true */
/*global enyo, $L, console, setTimeout, PalmSystem */

function log(msg) {
    console.error(msg);
}

function debug(msg) {
    console.error(msg);
}

var BASE_URL = "https://accounts.google.com/o/oauth2/";
var CLIENT_ID = "272134554501-k5k377p7i1psit075to941cpbgahqn69.apps.googleusercontent.com";
var CLIENT_SECRET = "TiN4hzrMTxXP0szqQTDxRAfy";

enyo.kind({
    name: "Main.CrossAppLaunch",
    width: "100%",
    height: "100%",
    kind: "VFlexBox",
    className: "enyo-bg",
    components: [
        { name: "getAccessToken", kind: "WebService", url: BASE_URL + "token", method: "POST",
            onSuccess: "gotAccessToken", onFailure: "getAccessTokenFailed" },
        {kind: "ApplicationEvents", onWindowParamsChange: "windowParamsChangeHandler"},
        { kind: "PageHeader", content: "Sign In with Google", pack: "center" },
        { name: "alert", flex: 1, style: "margin-bottom:30px;text-align:center; background-color:red; color:yellow;", showing: false },
        {kind: "InputBox", components: [
            {kind: "Input", hint: "Account Name", value: "", name: "txtUsername", tabIndex: "0", spellcheck: false,
                className: "enyo-first babelfish", flex: 1, autocorrect: false, autoCapitalize: "lowercase", components: [
                {content: "Name"}
            ]}
        ]},
        { kind: "WebView", flex: 9, onPageTitleChanged: "gotAuthToken"},
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

        var url = BASE_URL + "auth?client_id=" +
                  encodeURIComponent(CLIENT_ID) +
                  "&response_type=code" +
                  "&redirect_uri=" + encodeURIComponent("urn:ietf:wg:oauth:2.0:oob") +
                  "&scope=" + encodeURIComponent("https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/carddav https://www.googleapis.com/auth/contacts");

        if (this.params && this.params.account && this.params.account.credentials && this.params.account.credentials.user) {
            url += "&login_hint=" + encodeURIComponent(this.params.account.credentials.user);
        }

        this.$.webView.setUrl(url);

        console.error("<<<<<<<<<<<<<<<<<<<< create");
    },
    gotAuthToken: function (inSender, inResponse) {
        if (this.doing) {
            return;
        }

        debug("Got response: " + JSON.stringify(inResponse));
        var start = inResponse.indexOf("code=") + 5,
            code;
        if (start >= 5) {
            code = inResponse.substring(start);
            debug("Got code: " + code);

            this.doing = true;
            this.$.getAccessToken.call({
                code:           code,
                client_id:      CLIENT_ID,
                client_secret:  CLIENT_SECRET,
                redirect_uri:   "urn:ietf:wg:oauth:2.0:oob", //means token will be returned as title of page.
                grant_type:     "authorization_code"
            });
        } else {
            log("Could not extract code: " + start);
        }
    },
    gotAccessToken: function (inSender, inResponse) {
        debug("Got access token: " + JSON.stringify(inResponse));

        if (!this.params) {
            this.showLoginError("Please do run this from account app, not stand alone.");
            return;
        }

        this.accountSettings = {};
        var i, template = this.params.template,
            username = this.$.txtUsername.getValue(),
            credentials = {
                access_token: inResponse.access_token,
                refresh_token: inResponse.refresh_token,
                token_type: inResponse.token_type,
                oauth: true,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                authToken: inResponse.token_type + " " + inResponse.access_token,
                refresh_url: BASE_URL + "token"
            };
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

        if (!username) {
            username = Date.now();
        }

        for (i = 0; i < template.capabilityProviders.length; i += 1) {
            if (template.capabilityProviders[i].capability === "CONTACTS") {
                template.capabilityProviders[i].enabled = true;
                template.capabilityProviders[i].loc_name = "Google Contacts";
                break;
            }
            if (template.capabilityProviders[i].capability === "CALENDAR") {
                template.capabilityProviders[i].enabled = true;
                template.capabilityProviders[i].loc_name = "Google Calendar";
                break;
            }
        }

        template.config.credentials = credentials;
        this.accountSettings = {
            template: template,
            username: username,
            credentials: credentials,
            config: template.config,
            alias: "C+Dav Google",
            returnValue: true
        };
        //Pop back to Account Creation Dialog
        // Set val as a parameter to be passed back to our source application
        debug("Returning: " + JSON.stringify(this.accountSettings));
        this.$.crossAppResult.sendResult(this.accountSettings);
        //this.popScene(); hopefully enyo account manager does that for us?
    },
    getAccessTokenFailed: function (inSender, inResponse) {
        log("Failed to get access token: " + JSON.stringify(inResponse));
        this.showLoginError("Failed to get access token. Please try again later.");
    },
    showLoginError: function (msg) {
        this.$.alert.setContent(msg);
        this.$.alert.show();
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
