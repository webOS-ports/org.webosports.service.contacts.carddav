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

    function getDigestToken(userAuth, method, uri) {
        var crypto = require("crypto"),
            ha1 = crypto.createHash("md5"),
            ha2 = crypto.createHash("md5"),
            token = crypto.createHash("md5"),
            authString;

        ha1.update([userAuth.user, userAuth.digest.realm, userAuth.password].join(":"));
        ha2.update([method, uri].join(":"));

        if (userAuth.digest.qop === "auth") {
            //"1" == count, "" = empty client nonce.
            token.update([ha1.digest("hex"), userAuth.digest.nonce, userAuth.digest.count, userAuth.digest.cnonce, userAuth.digest.qop, ha2.digest("hex")].join(":"));
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
            ["nc=", userAuth.digest.count].join(""),
            ["cnonce=\"", userAuth.digest.cnonce, "\""].join("")
        ].join(", ");

        Log.debug("authString: ", authString);

        return authString;

    }

    function getNewDigestToken(headers, method, uri, userAuth) {
        if (headers["www-authenticate"] && headers["www-authenticate"].indexOf("Digest") === 0) {
            Log.debug("Had www-authenticate header!");
            userAuth.digest = parseDigest(headers["www-authenticate"]);
            userAuth.digest.cnonce = String(Date.now());
            userAuth.digest.count = 1;

            return getDigestToken(userAuth, method, uri);
        }

        //if no www-authenticate header, we are really unauthorized, I'd say.
        Log.debug("No www-authenticate header???", headers);
        return undefined; //=> signal error to caller.
    }

    return {
        getDigestToken: getDigestToken,

        getAuthToken: function (method, userAuth, uri) {
            if (userAuth.digest) {
                return getDigestToken(userAuth, method, uri);
            }

            //if not digest, just return stored auth token.
            return userAuth.authToken;
        },

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
            future.nest(CalDav.checkCredentials({userAuth: userAuth, path: path}));

            future.then(function checkCredentialsCB() {
                var result = checkResult(future), urlParser, authString;
                if (result.returnValue) {
                    //all is fine, coninue! :)
                    outerFuture.result = {returnValue: true};
                } else {

                    if (result.returnCode === 401) {
                        urlParser = require("url");
                        authString = getNewDigestToken(result.headers, "PROPFIND", urlParser.parse(path).pathname, userAuth);
                        userAuth.url = urlParser.parse(path).pathname;
                        if (authString) {
                            Log.debug("Trying digest auth.");
                            userAuth.authToken = authString;
                            userAuth.digest.PROPFIND = authString;
                            future.nest(CalDav.checkCredentials({userAuth: userAuth, path: path}));
                        } else {
                            Log.debug("CREDENTIALS ARE WRONG!!");
                            outerFuture.result = result;
                        }
                    } else {
                        Log.debug("Not 401 error => not testing digest.");
                        outerFuture.result = result;
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
