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
                        Log.log("Refresh of token successful.");
                        future.result = {returnValue: true};
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
        }
    };
}());

module.exports = OAuth;