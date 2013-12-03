/*jslint sloppy: true, node: true, nomen: true */
/*global debug, Base64, CalDav, DB, searchAccountConfig, Future, log */

/* Validate contact username/password */
var checkCredentialsAssistant = function () {};

checkCredentialsAssistant.prototype.run = function (outerfuture) {
	var args = this.controller.args, base64Auth, future = new Future();
	debug("Account args =" + JSON.stringify(args));

	// Base64 encode username and password
	base64Auth = "Basic " + Base64.encode(args.username + ":" + args.password);

	if (!args.url) {
		debug("No URL supplied. Maybe we got called to change credentials?");
		future.nest(searchAccountConfig(args));
	} else {
		future.result = {returnValue: true, obj: { config: {url: args.url}}};
	}

	future.then(this, function gotConfigObject() {
		var result = future.result, path, config;
		debug("Result: " + JSON.stringify(result));
		if (result.returnValue === true) {
			config = result.config;
		}
		if (args.url) {
			path = CalDav.setHostAndPort(args.url);
		} else {
			if (config && config.url) {
				path = CalDav.setHostAndPort(config.url);
			} else {
				log("No URL. Can't check credentials!");
				outerfuture.result = {success: false, returnValue: false};
				return outerfuture;
			}
		}

		// Test basic authentication. If this fails username and or password is wrong
		future.nest(CalDav.checkCredentials({authToken: base64Auth, path: path}));

		future.then(function () {
			var result = future.result, config;
			// Check if we are getting a good return code for success
			if (result.returnValue === true) {
				// Pass back credentials and config (username/password/url); 
				// config is passed to onCreate where
				// we will save username/password in encrypted storage
				debug("Password accepted");
				
				if (args.accountId && config) {
					log("Had account id => this is change credentials call, update config object");
					config.accountId = args.accountId || config.accountId;
					config.name = args.name || config.name;
					config.username = args.username || config.username;
					config.url = args.url || config.url;
					
					if (config._id && config._kind) {
						DB.merge([config]).then(function mergeCB() {
							var result = future.result || future.exception;
							log("Stored config in config db: " + JSON.stringify(result));
						});
					} else {
						log("Did not have config object in DB. Won't put new one to prevent duplicates.");
					}
				}

				//send results back to UI:
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
			} else {
				debug("Password rejected");
				outerfuture.result = {success: false};
			}
		});
	});

	return outerfuture;
};
