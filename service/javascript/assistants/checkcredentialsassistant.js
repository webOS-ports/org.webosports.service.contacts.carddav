/*jslint sloppy: true, node: true */
/*global debug, Base64, CalDav, Future, log, getTransportObjByAccountId */

/* Validate contact username/password */
var checkCredentialsAssistant = function () {};

checkCredentialsAssistant.prototype.run = function (outerfuture) {
	var args = this.controller.args, base64Auth, future = new Future();
	debug("Account args =" + JSON.stringify(args));

	// Base64 encode username and password
	base64Auth = "Basic " + Base64.encode(args.username + ":" + args.password);

	if (!args.url) {
		debug("No URL supplied. Maybe we got called to change credentials?");
		future.nest(getTransportObjByAccountId(args)); //needs to have accountId
	} else {
		future.result = {returnValue: true, obj: { config: {url: args.url}}};
	}

	future.then(this, function gotTransportObject() {
		var result = future.result, path;
		debug("Result: " + JSON.stringify(result));
		if (args.url) {
			path = CalDav.setHostAndPort(args.url);
		} else {
			if (result.account && result.account.config && result.account.config.url) {
				path = CalDav.setHostAndPort(result.account.config.url);
			} else {
				log("No URL. Can't check credentials!");
				outerfuture.result = {success: false, returnValue: false}
				return outerfuture;
			}
		}

		// Test basic authentication. If this fails username and or password is wrong
		future.nest(CalDav.checkCredentials({authToken: base64Auth, path: path}));

		future.then(function (f2) {
			var result = f2.result;
			// Check if we are getting a good return code for success
			if (result.returnValue === true) {
				// Pass back credentials and config (username/password/url); config is passed to onCreate where
				// we will save username/password/url in encrypted storage
				debug("Password accepted");
				outerfuture.result = {success: true, "credentials": {"common": {"password": args.password, "username": args.username, "url": args.url}},
									  "config": {"password": args.password, "username": args.username, "url": args.url}
									 };
			} else {
				debug("Password rejected");
				outerfuture.result = {success: false};
			}
		});
	});

	return outerfuture;
};
