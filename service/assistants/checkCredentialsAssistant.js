/* Simple debug function to print out to console error */
var debug = function (param) {
    console.error("DEBUG: " + param);
};

/* Validate contact username/password */
var checkCredentialsAssistant = function (future) {};

checkCredentialsAssistant.prototype.run = function (future) {
    var args = this.controller.args;
    debug("Account args =" + JSON.stringify(args));

    // Base64 encode username and password
    var base64Auth = "Basic " + Base64.encode(args.username + ":" + args.password);

    // Test basic authentication. If this fails username and or password is wrong
    AjaxCall.get(args.url, {headers: {"Authorization": base64Auth, "Connection": "keep-alive"}}).then (function (f2)
    {
        // Check if we are getting a 200 return code for success
        if (f2.result.status == 200)
        {
            // Pass back credentials and config (username/password/url); config is passed to onCreate where
            // we will save username/password/url in encrypted storage
            debug("Password accepted");
            future.result = {returnValue: true, "credentials": {"common": {"password": args.password, "username": args.username, "url": args.url}},
                                                "config": {"password": args.password, "username": args.username, "url": args.url}};
        }
        else {
            debug("Password rejected");
            future.result = {"errorCode": "401_UNAUTHORIZED", "returnValue": false};
        }
    });
};
