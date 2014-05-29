/*jslint node: true */
/*global Future, Log, httpClient, checkResult */

var OAuth = (function () {
    "use strict";
    return {
        refreshToken: function (credObj) {
            var future = new Future(),
                data = "client_id=" + credObj.client_id + "&client_secret=" + credObj.client_secret + "&refresh_token=" + credObj.refresh_token + "&grant_type=refresh_token",
                options = { method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}};

            Log.debug("Refreshing token from: ", credObj);
            //fill host and stuff.
            httpClient.parseURLIntoOptions(credObj.refresh_url, options);
            Log.debug("Options: ", options);

            future.nest(httpClient.sendRequest(options, data));

            future.then(function () {
                var result = checkResult(future), obj;
                if (result.returnValue === true) {
                    try {
                        obj = JSON.parse(result.body);
                        credObj.access_token = obj.access_token || credObj.access_token;
                        credObj.token_type = obj.token_type || credObj.token_type;
                        credObj.authToken = credObj.token_type + " " + credObj.access_token;
                        credObj.expires = Date.now() + obj.expires_in * 1000;
                        Log.log("Refresh of token successful, expires: ", obj.expires_in);
                        future.result = {returnValue: true, credentials: credObj};
                    } catch (e) {
                        Log.log("Exception during processing refresh result: ", e);
                        future.result = {returnValue: false};
                    }
                } else {
                    Log.log("Could not refresh_token: ", result.returnCode);
                    future.result = {returnValue: false};
                }
            });

            return future;
        },

        needsRefresh: function (credObj) {
            if (credObj.expires_in) {
                if (Date.now() < credObj.expires_in) {
                    Log.log(Date.now(), " < ", credObj.expires_in, " => we can still use it.");
                    return false;
                }
            }
            return true;
        }
    };
}());

module.exports = OAuth;
