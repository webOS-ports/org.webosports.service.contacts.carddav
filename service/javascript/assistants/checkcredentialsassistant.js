/*jslint sloppy: true, node: true, nomen: true */
/*global debug, Base64, CalDav, DB, searchAccountConfig, Future, log, KeyStore */

/* Validate contact username/password */
var checkCredentialsAssistant = function () {};

checkCredentialsAssistant.prototype.run = function (outerfuture) {
	var args = this.controller.args, base64Auth, future = new Future();
	//debug("Account args =" + JSON.stringify(args));

	// Base64 encode username and password
	base64Auth = "Basic " + Base64.encode(args.username + ":" + args.password);

	if (!args.url) {
		debug("No URL supplied. Maybe we got called to change credentials?");
		future.nest(searchAccountConfig(args));
	} else {
		future.result = {returnValue: true, obj: { config: {url: args.url}}};
	}

	//build result and send it back to UI.
	function buildResult() {
		outerfuture.result = {
			success: true,
			credentials: {
				common: {
					password: args.password,
					username: args.username,
					url: args.url
				}
			},
			config: {
				password: args.password,
				username: args.username,
				url: args.url
			}
		};
	}

	future.then(this, function gotConfigObject() {
		var result = future.result, path;
		if (result.returnValue === true) {
			this.config = result.config;
		}
		if (args.url) {
			path = args.url;
		} else {
			if (this.config && this.config.url) {
				path = this.config.url;
			} else {
				log("No URL. Can't check credentials!");
				outerfuture.result = {success: false, returnValue: false};
				return outerfuture;
			}
		}

		// Test basic authentication. If this fails username and or password is wrong
		future.nest(CalDav.checkCredentials({authToken: base64Auth, path: path}));
	});

	future.then(this, function credentialsCheckCB() {
		var result = future.result, authToken;
		// Check if we are getting a good return code for success
		if (result.returnValue === true) {
			// Pass back credentials and config (username/password/url);
			// config is passed to onCreate where
			// we will save username/password in encrypted storage
			debug("Password accepted");

			if (args.accountId) {
				log("Had account id => this is change credentials call, update config object");
				authToken = "Basic " + Base64.encode(args.username + ":" + args.password);
				this.client.userAuth = {"user": args.username, "password": args.password, "authToken": authToken};

				future.nest(KeyStore.putKey(args.accountId, this.client.userAuth));
			} else {
			//send results back to UI:
				buildResult();
			}

		} else {
			debug("Password rejected");
			outerfuture.result = {returnValue: false, success: false};
		}
	});

	future.then(this, function updateCredentialsCB() {
		var result = future.result || future.exception;
		debug("------------->Modified Key: " + JSON.stringify(result));

		if (this.config) {
			this.config.accountId = args.accountId || this.config.accountId;
			this.config.name = args.name || this.config.name;
			this.config.username = args.username || this.config.username;
			this.config.url = args.url || this.config.url;

			if (this.config._id && this.config._kind) {
				future.nest(DB.merge([this.config]));
			} else {
				log("Did not have config object in DB. Won't put new one to prevent duplicates.");
				buildResult();
			}
		} else {
			log("No config found => can't save it.");
			buildResult();
		}
	});

	future.then(this, function mergeCB() {
		var result = future.result || future.exception;
		log("Stored config in config db: " + JSON.stringify(result));
		buildResult();
	});

	return outerfuture;
};
