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
/*global servicePath, checkResult, Future, CalDav, UrlSchemes, Log */

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

    function parseDigest(header) {
        var obj = {}, parts;
        header = header.substr(6).trim(); //remove "Digest "
        parts = header.split(/,\s+/);
        parts.forEach(function (str) {
            var kv = str.split("=");
            obj[kv.shift()] = kv.join("=").replace(/["']/g, "");
        });

        return obj;
    }

    function getDigestToken(headers, method, uri, userAuth) {
        if (headers["www-authenticate"] && headers["www-authenticate"].indexOf("Digest") === 0) {
            Log.debug("Had www-authenticate header!");
            var crypto = require("crypto");
            var ha1 = crypto.createHash("md5"),
                ha2 = crypto.createHash("md5"),
                token = crypto.createHash("md5"),
                authString,
                cnonce = String(Date.now());
            userAuth.digest = parseDigest(headers["www-authenticate"]);

            ha1.update([userAuth.user, userAuth.digest.realm, userAuth.password].join(":"));
            ha2.update([method, uri].join(":"));

            if (userAuth.digest.qop === "auth") {
                //"1" == count, "" = empty client nonce.
                token.update([ha1.digest("hex"), userAuth.digest.nonce, "00000001", cnonce, userAuth.digest.qop, ha2.digest("hex")].join(":"));
            }

            /*authParams = {
                username: userAuth.user,
                realm: userAuth.digest.realm,
                nonce: userAuth.digest.nonce,
                uri: uri,
                qop: userAuth.digest.qop,
                response: token,
                nc: "1",
                cnonce: ""
            };*/
            authString = "Digest " + [
                ["username=\"", userAuth.user, "\""].join(""),
                ["realm=\"", userAuth.digest.realm, "\""].join(""),
                ["nonce=\"", userAuth.digest.nonce, "\""].join(""),
                ["uri=\"", uri, "\""].join(""),
                ["qop=", userAuth.digest.qop].join(""),
                ["response=\"", token.digest("hex"), "\""].join(""),
                ["nc=", "00000001"].join(""),
                ["cnonce=\"", cnonce, "\""].join("")
            ].join(", ");

            Log.debug("authString: ", authString);

            return authString;
        } else {
            Log.debug("No www-authenticate header???", headers);
        }
    }

    return {
        getDigestToken: getDigestToken,

        checkAuth: function (userAuth, url) {
            Log.debug("AUTH CHECK STARTING.1");
            var path, future = new Future(), outerFuture = new Future();
            //for OAuth: maybe need to refresh tokens.
            if (userAuth.oauth) {
                return doOAuthCheck(userAuth); //no need for the other stuff.
            }

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

                    if (result.returnCode === 401) {
                        var urlParser = require("url");
                        var authString = getDigestToken(result.headers, "PROPFIND", urlParser.parse(path).pathname, userAuth);
                        if (authString) {
                            Log.debug("Trying digest auth.");
                            userAuth.authToken = authString;
                            future.nest(CalDav.checkCredentials({authToken: userAuth.authToken, path: path}));
                        } else {
                            Log.debug("CREDENTIALS ARE WRONG!!");
                            outerFuture.result = result;
                        }
                    } else {
                        Log.debug("Not 401 error => not testing digest.");
                        outerFuture.result= result;
                    }
                }
            });

            future.then(function () {
                var result = checkResult(future);
                Log.debug("RESULT OF DIGEST AUTH: ", result);
                if (result.returnValue) {
                    Log.debug("auth ok.");
                } else {
                    Log.debug("auth failed.");
                }
                outerFuture.result = result;
            });

            return outerFuture;
        }
    };
}());

module.exports = AuthManager;
