/**
 * This handles authentication stuff.
 * Supports:
 * - basic auth,
 * - MD5 Digest auth,
 * - OAuth (with OAuth.js)
 *
 * OAuth keys are refreshed if necessary.
 * Can switch from basic auth to MD5 digest, if necessary.
 */
/*global servicePath, checkResult, Future, CalDav, UrlSchemes */

var OAuth = require(servicePath + "/javascript/utils/OAuth.js");

var AuthManager = (function() {
    "use strict";

    function doOAuthCheck(userAuth) {
        var future = new Future();
        if(OAuth.needsRefresh(userAuth)) {
            future.nest(OAuth.refreshToken(userAuth));

            future.then(function refreshCB(future) {
                var result = checkResult(future);
                //just pipe oauth result through:
                future.result = result;
            });
        } else {
            future.result = {returnValue: true};
        }
        return future;
    }

    return {
        checkAuth: function (userAuth, url) {
            var path, future = new Future(), outerFuture = new Future();
            //for OAuth: maybe need to refresh tokens.
            if (userAuth.oauth) {
                return doOAuthCheck(userAuth); //no need for the other stuff.
            }
            //work around: :)
            outerFuture.result = {returnValue: true};
            return outerFuture;

            path = UrlSchemes.resolveURL(url, userAuth.username, "checkCredentials");
            if (!path) {
                path = url;
            }
            future.nest(CalDav.checkCredentials({authToken: userAuth.authToken, path: path}));

            future.then(function() {
                var result = checkResult(future);
                if (result.returnValue) {
                    //all is fine, coninue! :)
                    outerFuture.result = {returnValue: true};
                } else {

                }
            });

            return outerFuture;
        }
    };
}());

module.exports = AuthManager;
