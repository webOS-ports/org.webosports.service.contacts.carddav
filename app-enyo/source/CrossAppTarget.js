/*jslint sloppy: true */
/*global enyo, $L, PalmCall, console */

function log(msg) {
	console.error(msg);
}

function debug(msg) {
	console.error(msg);
}

enyo.kind({
	name: "Main.CrossAppLaunch",
	kind: "Scroller",
	components: [
		{ name: "checkCredentials", kind: "PalmService", service: "palm://org.webosports.service.contacts.carddav.service/",
			method: "checkCredentials", onSuccess: "credentialsOK", onFailure: "credentialsWrong" },
		{kind: "ApplicationEvents", onWindowParamsChange: "windowParamsChangeHandler"},
		{ kind: "PageHeader", content: "WebOs Ports CardDav Credentials Validator" },
		{ style: "margin:30px;", components: [
			{ name: "alert", style: "margin-bottom:30px;text-align:center; background-color:red; color:yellow;" },
			{ kind: "RowGroup", caption: "Text captured from Cross-App Source - App A", components: [
				{ kind: "Input", hint: "Servername", value: "", name: "txtServerName", tabIndex: "0", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase" },
				{ kind: "Input", hint: "URL", value: "", name: "txtURL", tabIndex: "0", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase", inputType: "url" },
				{ kind: "Input", hint: "Username", value: "", name: "txtUsername", tabIndex: "0", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase", inputType: "email" },
				{ kind: "PasswordInput", hint: "Password", value: "", name: "txtPassword", tabIndex: "0", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase" },
				{ kind: "Button", tabIndex: "4",  caption: "Check Credentials", onclick: "doCheckCredentials", className: "enyo-button-dark" }
			]}
		]},
		{kind: "CrossAppResult"}
	],
	create: function () {
		this.inherited(arguments);
		console.error(">>>>>>>>>>>>>>>>>>>> create");
		console.error("Parameters: " + JSON.stringify(arguments));

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
			url: this.account.url
		});
	},
	credentialsOK: function (inSender, inResponse) {
		debug("Service Response: " + JSON.stringify(inResponse));
		if (inResponse.success) {
			debug("Check credentials came back successful");

			this.accountSettings = {};
			var i, template = this.params.template;
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
				"template": this.params.template,
				"username": this.account.credentials.user,
				"credentials": this.account.credentials,
				"config": this.account,
				"returnValue": true
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
			this.$.alert.setContent($L("No parameters received. This needs to be called from Account Manager."));
			return;
		}

		this.params = event.params;
		console.error("Params: " + JSON.stringify(this.params));

		console.error("<<<<<<<<<<<<<<<<<<<< windowParamsChangeHandler");
	}
});
