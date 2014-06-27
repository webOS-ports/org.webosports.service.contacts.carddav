/*global Future, Log, httpClient, checkResult */

var OAuth = (function () {
    "use strict";
    return {
        /**
         * Refreshes oauth token with server
         * @param credObj that contains client_di, client_secrect, refresh_token, refresh_url.
         * @return future with result.credentials the augmented credObj to store in DB.
         */
        refreshToken: function (credObj) {
            var future = new Future(),
                data = "client_id=" + credObj.client_id + "&client_secret=" + credObj.client_secret + "&refresh_token=" + credObj.refresh_token + "&grant_type=refresh_token",
                options = { method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}};

            //fill host and stuff.
            httpClient.parseURLIntoOptions(credObj.refresh_url, options);

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
                    Log.log("Could not refresh_token: ", result);
                    future.result = {returnValue: false};
                }
            });

            return future;
        },

        /**
         * Checks credObj.expires if the tokens need a refresh
         * @param credObj, necessary is the "expires" field,
         *           which is a JS timestamp until when the token is valid.
         * @return true, if a refrehs is needed.
         */
        needsRefresh: function (credObj) {
            if (credObj.expires) {
                if (Date.now() < credObj.expires) {
                    return false;
                }
            }
            return true;
        }
    };
}());

module.exports = OAuth;
