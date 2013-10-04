/*jslint sloppy: true, node: true */
/*global debug, Base64, CalDav, url */

/* Validate contact username/password */
var checkCredentialsAssistant = function () {};

checkCredentialsAssistant.prototype.run = function (future) {
    var args = this.controller.args, base64Auth, parsedUrl = url.parse(args.url);
    debug("Account args =" + JSON.stringify(args));

    // Base64 encode username and password
    base64Auth = "Basic " + Base64.encode(args.username + ":" + args.password);

	CalDav.setHostAndPort(args.url);

    // Test basic authentication. If this fails username and or password is wrong
    CalDav.checkCredentials({authToken: base64Auth, path: parsedUrl.pathname}).then(function (f2) {
		var result = f2.result;
        // Check if we are getting a good return code for success
        if (result.returnValue === true) {
            // Pass back credentials and config (username/password/url); config is passed to onCreate where
            // we will save username/password/url in encrypted storage
            debug("Password accepted");
            future.result = {success: true, "credentials": {"common": {"password": args.password, "username": args.username, "url": args.url}},
                                            "config": {"password": args.password, "username": args.username, "url": args.url}
							};
        } else {
            debug("Password rejected");
            future.result = {success: false};
        }
    });
};
