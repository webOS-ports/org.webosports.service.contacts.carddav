/*jslint sloppy: true, browser: true, devel: true */
/*global PalmCall, Mojo, log, $L, showError, Ajax */
/* Simple debug function to print out to console error */
var debug = function (param) {
	console.error("DEBUG: " + param);
};

function AccountSetupGoogleAssistant(params) {
	/* this is the creator function for your scene assistant object. It will be passed all the
	   additional parameters (after the scene name) that were passed to pushScene. The reference
	   to the scene controller (this.controller) has not be established yet, so any initialization
	   that needs the scene controller should be done in the setup function below. */
	this.params = params;
	debug("Got params: " + JSON.stringify(this.params));
}

var BASE_URL = "https://accounts.google.com/o/oauth2/";
var CLIENT_ID = "272134554501-k5k377p7i1psit075to941cpbgahqn69.apps.googleusercontent.com";
var CLIENT_SECRET = "TiN4hzrMTxXP0szqQTDxRAfy";

AccountSetupGoogleAssistant.prototype.setup = function () {
	/* this function is for setup tasks that have to happen when the scene is first created */
	/* use Mojo.View.render to render view templates and add them to the scene, if needed */

	this.account = { credentials: {}};

	var url = BASE_URL + "auth?client_id=" +
				  encodeURIComponent(CLIENT_ID) +
				  "&response_type=code" +
				  "&redirect_uri=" + encodeURIComponent("urn:ietf:wg:oauth:2.0:oob") +
				  "&scope=" + encodeURIComponent("https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/carddav  https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile");

	/* setup widgets here */
	this.controller.setupWidget("WebId", {url: url}, {});

	Mojo.Event.listen(this.controller.get("WebId"), Mojo.Event.webViewTitleUrlChanged, this.handleTitle.bind(this));
	Mojo.Event.listen(this.controller.get("WebId"), Mojo.Event.webViewTitleChanged, this.handleTitle.bind(this));

	this.spinnerModel = { spinning: false };
	this.controller.setupWidget("saveSpinner", this.attributes = { spinnerSize: "large" }, this.spinnerModel);
	this.controller.get('Scrim').hide();

	if (!this.params) {
		setTimeout(function () {
			this.disableControls();
			showError(this.controller, "Google-Account App", "Please run this from account app, not standalane.");
		}.bind(this), 100);
	}
};

AccountSetupGoogleAssistant.prototype.handleTitle = function (event) {
	//debug("Title changed: " + event.title);
	var title = event.title || "",
		start = title.indexOf("code=") + 5,
		url = "https://accounts.google.com/o/oauth2/token",
		code,
		future,
		body,
		req;

	if (this.doing) {
		//debug("Already active...");
		return;
	}

	if (start >= 5) {
		code = title.substring(start);
		//debug("Got code: " + code);

		this.controller.get('saveSpinner').mojo.start();
		this.controller.get('Scrim').show();

		body = "code=" + encodeURIComponent(code) +
			   "&client_id=" + encodeURIComponent(CLIENT_ID) +
			   "&client_secret=" + encodeURIComponent(CLIENT_SECRET) +
			   "&redirect_uri=" + encodeURIComponent("urn:ietf:wg:oauth:2.0:oob") + //means token will be returned as title of page.
			   "&grant_type=authorization_code";


		this.doing = true;

		debug("Trying to get token.");
		req = new Ajax.Request(url, {
			method: "POST",
			parameters: {
				code:           code,
				client_id:      CLIENT_ID,
				client_secret:  CLIENT_SECRET,
				redirect_uri:   "urn:ietf:wg:oauth:2.0:oob", //means token will be returned as title of page.
				grant_type:     "authorization_code"
			},
			onSuccess: this.tokenCB.bind(this),
			onFailure: function (response) {
				showError(this.controller, "Token error", "Could not get token: " + JSON.stringify(response));
			}.bind(this)
		});
	} else {
		debug("Could not extract code: " + start);
	}
};

AccountSetupGoogleAssistant.prototype.getName = function (body) {
	debug("Now trying to get name");
	this.req = new Ajax.Request("https://www.googleapis.com/userinfo/v2/me", {
		method: "GET",
		parameters: {
			access_token: body.access_token
		},
		onSuccess: function (response) {
			setTimeout(this.nameCB.bind(this, body, response), 500);
		}.bind(this),
		onFailure: function (response) {
			showError(this.controller, "Token error", "Could not get name: " + JSON.stringify(response));
		}.bind(this)
	});
};

AccountSetupGoogleAssistant.prototype.tokenCB = function (response) {
	var body;
	try {
		if (response.status < 300) { //success
			debug("Got token ok: " + response.responseText);
			body = response.responseJSON || JSON.parse(response.responseText);

			this.getName(body);
		}
	} catch (e) {
		this.controller.get('saveSpinner').mojo.stop();
		this.controller.get('Scrim').hide();

		log("Error during processing response: " + JSON.stringify(e));
		showError(this.controller, "Token Error", "Could not get token: " + JSON.stringify(e));
	}
};

AccountSetupGoogleAssistant.prototype.nameCB = function (credbody, response) {
	try {
		var body;

		debug("Get me came back: " + JSON.stringify(response));
		if (response.status >= 200 && response.status < 300) { //success
			debug("Get me came back: " + response.responseText);
			try {
				body = response.responseJSON || JSON.parse(response.responseText);
			} catch (e1) {
				body = { email: Date.now() };
				log("Could not get username from " + response.responseText + " with code " + response.status + " error: " + e1.message);
				throw response;
			}

			this.preparePop(credbody, body.email);
		} else {
			debug("Get me was unsuccessful: " + JSON.stringify(response));
			throw response;
		}
	} catch (e) {
		this.controller.get('saveSpinner').mojo.stop();
		this.controller.get('Scrim').hide();

		log("Error during processing response: " + JSON.stringify(e));
		showError(this.controller, "Name Error", "Could not get name: " + JSON.stringify(e));
		//no username not THAT critical...
		this.preparePop(credbody, Date.now());
	}
};

AccountSetupGoogleAssistant.prototype.preparePop = function (credbody, username) {
	var template = this.params.initialTemplate;
	this.account.credentials = {
		access_token: credbody.access_token,
		refresh_token: credbody.refresh_token,
		token_type: credbody.token_type,
		oauth: true,
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		authToken: credbody.token_type + " " + credbody.access_token,
		refresh_url: BASE_URL + "token",
		username: username
	};

	this.account.username = username;

	if (!this.account.username) {
		this.account.username = Date.now();
	}

	template.config.credentials = this.account.credentials;
	this.accountSettings = {
		template: template,
		username: this.account.username,
		alias: this.account.username,
		config: template.config,
		defaultResult: {
			result: {
				returnValue: true,
				credentials: this.account.credentials,
				config: template.config
			}
		},
		returnValue: true
	};
	//Pop back to Account Creation Dialog
	this.popScene();
};

AccountSetupGoogleAssistant.prototype.popScene = function () {
	if (this.params) {
		if (this.params.aboutToActivateCallback !== undefined) {
			this.params.aboutToActivateCallback(true);
		}
		debug("AccountSetupGoogleAssistant popping scene.");
		Mojo.Log.info("AccountSetupGoogleAssistant popping scene.");
		Mojo.Log.info("AccountSetupGoogleAssistant accountSettings=", JSON.stringify(this.accountSettings));
	}
	this.controller.stageController.popScene(this.accountSettings);
};

AccountSetupGoogleAssistant.prototype.activate = function (event) {
	/* put in event handlers here that should only be in effect when this scene is active. For
	   example, key handlers that are observing the document */
};

AccountSetupGoogleAssistant.prototype.aboutToDeactivate = function (event) {
};

AccountSetupGoogleAssistant.prototype.deactivate = function (event) {
	/* remove any event handlers you added in activate and do any other cleanup that should happen before
	   this scene is popped or another scene is pushed on top */
};

AccountSetupGoogleAssistant.prototype.cleanup = function (event) {
	/* this function should do any cleanup needed before the scene is destroyed as
	   a result of being popped off the scene stack */
};
