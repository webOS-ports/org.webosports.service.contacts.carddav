/*jslint sloppy: true, browser: true, nomen: true */
/*global enyo, $L, console, setTimeout, PalmSystem */

/* Nothing logged here may carry a token, code, secret or password: the console
   ends up in the system log. */
function log(msg) {
	console.error(msg);
}

function debug(msg) {
	console.error(msg);
}

/*
 * The Google OAuth client is the builder's own: no client id or secret is in
 * this repository (the ones it once had are public and are to be revoked). The
 * LuneOS build puts them in place of these placeholders from
 * GOOGLE_CDAV_CLIENT_ID and GOOGLE_CDAV_CLIENT_SECRET (meta-luneos'
 * org.webosports.cdav.bb). Unfilled, sign-in says so instead of starting.
 */
var CLIENT_ID = "PLACEHOLDER_GOOGLE_CDAV_CLIENT_ID";
var CLIENT_SECRET = "PLACEHOLDER_GOOGLE_CDAV_CLIENT_SECRET";

/* matched by prefix, so filling the placeholders in at build time cannot change this test */
function googleClientConfigured(inId, inSecret) {
	return [inId, inSecret].every(function (v) {
		return typeof v === "string" && v !== "" && v.indexOf("PLACEHOLDER_") !== 0;
	});
}

enyo.kind({
	name: "Main.CrossAppLaunch",
	width: "100%",
	height: "100%",
	kind: "VFlexBox",
	className: "enyo-bg",
	components: [
		{ name: "googleOAuthStart", kind: "PalmService", service: "palm://org.webosports.service.cdav/",
			method: "googleOAuthStart", onSuccess: "signInReady", onFailure: "getAccessTokenFailed" },
		{ name: "googleOAuthExchange", kind: "PalmService", service: "palm://org.webosports.service.cdav/",
			method: "googleOAuthExchange", onSuccess: "gotTokens", onFailure: "getAccessTokenFailed" },
		//used to change credentials:
		{ name: "checkCredentials", kind: "PalmService", service: "palm://org.webosports.service.cdav/",
			method: "checkCredentials", onSuccess: "credentialsCameBack", onFailure: "credentialsCameBack" },
		{kind: "ApplicationEvents", onWindowParamsChange: "windowParamsChangeHandler"},
		{ kind: "PageHeader", content: "Sign in with Google", pack: "center" },
		{ name: "description", style: "padding:20px;text-align:center;",
			content: "Google's sign-in opens in a separate window. After you allow access, C+DAV downloads your contacts and calendars to this device. It does not change anything in your Google account." },
		{ layoutKind: "HFlexLayout", pack: "center", components: [
			{ name: "signInButton", kind: "Button", caption: "Continue to Google", onclick: "startSignIn", className: "enyo-button-affirmative" }
		]},
		/* The Accounts app sends an account with a credentials error (and Contacts or Calendar any
		   account) here instead of to its own settings screen, so removing it has to be possible here. */
		{ name: "removeAccountButton", kind: "Accounts.RemoveAccount", showing: false,
			onAccountsRemove_Removing: "removingAccount", onAccountsRemove_Done: "accountRemoved" },
		{ name: "alert", flex: 1, style: "margin-bottom:30px;text-align:center; background-color:red; color:yellow;", showing: false },
		{ flex: 9 },
		{kind: "CrossAppResult", name: "crossAppResult" },
		{className: "accounts-footer-shadow", tabIndex: -1},
		{kind: "Toolbar", className: "enyo-toolbar-light", components: [
			{ name: "doneButton", kind: "Button", caption: "Back", onclick: "doBack", className: "accounts-toolbar-btn"}
		]}
	],
	create: function () {
		this.inherited(arguments);
		console.error(">>>>>>>>>>>>>>>>>>>> create");

		if (PalmSystem.launchParams) {
			this.params = JSON.parse(PalmSystem.launchParams);
		}

		if (enyo.windowParams) {
			this.params = enyo.windowParams;
		}

		/* before the client check: an account must stay removable in a build without a client */
		if (this.params && this.params.mode === "modify" && this.params.account &&
				(this.params.account.credentialError || this.params.capability)) {
			this.$.removeAccountButton.init(this.params.account, this.params.capability);
			this.$.removeAccountButton.show();
		}

		if (!googleClientConfigured(CLIENT_ID, CLIENT_SECRET)) {
			log("Google OAuth client id/secret were not set at build time.");
			this.$.signInButton.hide();
			this.showLoginError($L("Google sign-in is not available in this build."));
			return;
		}

		if (this.params.mode === "modify" && this.params.account) {
			this.accountId = this.params.account._id;
			log("Stored accountId: " + this.accountId);
		}

		console.error("<<<<<<<<<<<<<<<<<<<< create");
	},
	startSignIn: function () {
		var loginHint;

		if (this.params && this.params.account && this.params.account.credentials) {
			loginHint = this.params.account.credentials.user;
		}
		this.$.alert.hide();
		this.$.signInButton.setDisabled(true);
		this.$.googleOAuthStart.call({clientId: CLIENT_ID, loginHint: loginHint});
	},
	signInReady: function (inSender, inResponse) {
		if (!inResponse.url) {
			this.getAccessTokenFailed(inSender, inResponse);
			return;
		}
		this.signIn = inResponse;
		this.oauthWindow = window.OAuthWindow.open({
			url: inResponse.url,
			name: "googleSignIn",
			redirectPrefix: inResponse.redirectUri,
			onRedirect: this.gotRedirect.bind(this),
			onError: this.showLoginError.bind(this)
		});
	},
	gotRedirect: function (url) {
		var query = {};

		this.oauthWindow = null;
		(url.split("#")[0].split("?")[1] || "").split("&").forEach(function (part) {
			var pos = part.indexOf("=");
			if (pos > 0) {
				query[part.substring(0, pos)] = decodeURIComponent(part.substring(pos + 1).replace(/\+/g, " "));
			}
		});

		if (query.state !== this.signIn.state) {
			log("Sign-in redirect had the wrong state.");
			this.showLoginError($L("Sign-in failed. Please try again."));
		} else if (!query.code) {
			log("Sign-in was refused: " + query.error);
			this.showLoginError($L("Google did not allow the sign-in."));
		} else {
			debug("Got authorization code.");
			this.$.pageHeader.setContent("Getting access token from google...");
			this.$.googleOAuthExchange.call({
				code: query.code,
				codeVerifier: this.signIn.codeVerifier,
				clientId: CLIENT_ID,
				clientSecret: CLIENT_SECRET
			});
		}
	},
	gotTokens: function (inSender, inResponse) {
		if (!inResponse.access_token) {
			this.getAccessTokenFailed(inSender, inResponse);
			return;
		}
		debug("Got access token.");
		this.token_response = inResponse;
		this.gotName(inSender, {email: inResponse.email});
	},
	gotName: function (inSender, inResponse) {
		debug("Got user name.");

		if (!this.params) {
			this.showLoginError("Please do run this from account app, not stand alone.");
			return;
		}
		this.$.pageHeader.setContent("All done, returning to account manager soon.");

		this.accountSettings = {};
		var i, template = this.params.template || this.params.account,
			username = inResponse.email,
			credentials = {
				access_token: this.token_response.access_token,
				refresh_token: this.token_response.refresh_token,
				token_type: this.token_response.token_type,
				oauth: true,
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				authToken: this.token_response.token_type + " " + this.token_response.access_token,
				refresh_url: this.token_response.refresh_url,
				expires: Date.now() + this.token_response.expires_in * 1000,
				username: username
			},
			config;

		if (template) {
			config = template.config;
		}

		if (!config) {
			//LuneOS no template in params hack
			config = {
				name: "Google C+DAV",
				urlScheme: "google",
				url: "https://www.googleapis.com/caldav/v2",
				credentials: credentials
			};
		}

		if (!username) {
			username = Date.now();
		}

		if (this.params.mode === "create") {
			if (!template) {
				this.showLoginError("Account App", "Internal error: No template. Please report this issue.");
				return;
			} else {
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


				if (!template.config) {
					template.config = config;
				} else {
					template.config.credentials = credentials;
				}
			}
		}

		this.accountSettings = {
			template: template,
			username: username,
			credentials: credentials,
			config: config,
			alias: username,
			returnValue: true
		};

		if (this.accountId) {
			//store new tokens:
			this.$.checkCredentials.call({
				accountId: this.accountId,
				oauth: credentials,
				url: config.url,
				urlScheme: config.urlScheme,
				name: config.name
			});
		} else {
			//Pop back to Account Creation Dialog
			// Set val as a parameter to be passed back to our source application
			debug("Returning account settings.");
			this.$.crossAppResult.sendResult(this.accountSettings);
		}
	},
	getAccessTokenFailed: function (inSender, inResponse) {
		log("Failed to get access token: " + (inResponse && inResponse.error));
		this.showLoginError("Failed to get access token. Please try again later.");
	},
	showLoginError: function (msg) {
		this.$.alert.setContent(msg);
		this.$.alert.show();
		this.$.signInButton.setDisabled(false); //lets the user try again.
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
				console.error("Got params with template.");
			} else {
				console.error("Skipping params, because they don't contain template information.");
			}

		}

		console.error("<<<<<<<<<<<<<<<<<<<< windowParamsChangeHandler");
	},
	removingAccount: function () {
		if (this.oauthWindow) {
			this.oauthWindow.close();
			this.oauthWindow = null;
		}
		this.$.signInButton.setDisabled(true);
		this.$.doneButton.setDisabled(true);
	},
	accountRemoved: function () {
		log("Account removed.");
		this.$.crossAppResult.sendResult({returnValue: false});
	},
	doBack: function () {
		if (this.oauthWindow) {
			this.oauthWindow.close();
		}
		this.$.crossAppResult.sendResult({returnValue: false});
	},
	credentialsCameBack: function (inSender, inResponse) {
		log("Credentials store came back: " + (inResponse && inResponse.returnValue));
		this.$.crossAppResult.sendResult(this.accountSettings);
	}
});
