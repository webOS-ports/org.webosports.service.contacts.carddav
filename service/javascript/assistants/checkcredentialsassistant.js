/*jslint nomen: true */
/*global CalDav, DB, searchAccountConfig, Future, Log, UrlSchemes, Transport, checkResult, servicePath */
/*exported checkCredentialsAssistant*/
var KeyStore = require(servicePath + "/javascript/utils/KeyStore.js");
var Base64 = require(servicePath + "/javascript/utils/Base64.js");

/* Validate contact username/password */
var checkCredentialsAssistant = function () { "use strict"; };

checkCredentialsAssistant.prototype.run = function (outerfuture) {
    "use strict";
    var args = this.controller.args, base64Auth, future = new Future(), url = args.url, name = args.name;
    //debug("Account args =", args);

    // Base64 encode username and password
    base64Auth = "Basic " + Base64.encode(args.username + ":" + args.password);

    if (args && args.config) {
        if (!url) {
            url = args.config.url;
        }
        if (!name) {
            name = args.config.name;
        }
    }

    if (args.accountId) {
        Log.debug("Have account id => this is change credentials call, get config object from db.");
        future.nest(searchAccountConfig(args));
    } else {
        future.result = {returnValue: true,  config: {url: url}};
    }

    //build result and send it back to UI.
    function buildResult() {
        outerfuture.result = {
            success: true,
            credentials: {
                common: {
                    password: args.password,
                    username: args.username,
                    url: url
                }
            },
            config: {
                password: args.password,
                username: args.username,
                url: url,
                name: name
            }
        };
    }

    future.then(this, function gotConfigObject() {
        var result = checkResult(future), path, newPath;
        if (result.returnValue === true) {
            this.config = result.config;
        }
        if (url) {
            path = url;
        } else {
            if (this.config && this.config.url) {
                path = this.config.url;
            } else {
                Log.log("No URL. Can't check credentials!");
                outerfuture.result = {returnValue: false, success: false, reason: "Could not determine URL..."};
                throw new Transport.AuthenticationError();
            }
        }

        //try to augment URL for known servers:
        newPath = UrlSchemes.resolveURL(path, args.username, "checkCredentials");
        if (newPath) {
            path = newPath;
        }

        // Test basic authentication. If this fails username and or password is wrong
        future.nest(CalDav.checkCredentials({authToken: base64Auth, path: path}));
    });

    future.then(this, function credentialsCheckCB() {
        var result = checkResult(future), authToken, msg, exception;
        // Check if we are getting a good return code for success
        if (result.returnValue === true) {
            // Pass back credentials and config (username/password/url);
            // config is passed to onCreate where
            // we will save username/password in encrypted storage
            Log.debug("Password accepted");

            if (args.accountId) {
                Log.log("Had account id => this is change credentials call, update config object");
                authToken = "Basic " + Base64.encode(args.username + ":" + args.password);
                this.client.userAuth = {"user": args.username, "password": args.password, "authToken": authToken};

                future.nest(KeyStore.putKey(args.accountId, this.client.userAuth));
            } else {
            //send results back to UI:
                buildResult();
            }

        } else {
            Log.debug("Password rejected");
            switch (result.exception.returnCode) {
            case 404:
                msg = "URL wrong, document not found. - URL: " + result.uri;
                exception = new Transport.BadRequestError(msg);
                break;
            case 403:
                msg = "Access forbidden, probably server or URL issue. - URL: " + result.uri;
                exception = new Transport.BadRequestError(msg);
                break;
            case 401:
                msg = "Credentials are wrong. - URL: " + result.uri;
                exception = new Transport.AuthenticationError(msg);
                break;
            case 405:
                msg = "Method not allowed, probably URL is no caldav/carddav URL. Please look up configuration of your server or report back to developers. - URL: " + result.uri;
                exception = new Transport.BadRequestError(msg);
                break;
            default:
                msg = "Connection issue: " + result.returnCode + ". Maybe try again later or check url. - URL: " + result.uri;
                exception = new Transport.TimeoutError(msg);
                break;
            }
            outerfuture.setException(exception);
            Log.log("Error in CheckCredentials: ", exception.toString());
            outerfuture.result = {returnValue: false, success: false, reason: msg, url: result.uri};
            throw exception;
        }
    });

    future.then(this, function updateCredentialsCB() {
        var result = checkResult(future);
        Log.debug("------------->Modified Key: ", result);

        if (this.config) {
            this.config.accountId = args.accountId || this.config.accountId;
            this.config.name = args.name || this.config.name;
            this.config.username = args.username || args.user || this.config.username;
            this.config.url = args.url || this.config.url;

            if (this.config._id && this.config._kind) {
                future.nest(DB.merge([this.config]));
            } else {
                Log.log("Did not have config object in DB. Won't put new one to prevent duplicates.");
                buildResult();
            }
        } else {
            Log.log("No config found => can't save it.");
            buildResult();
        }
    });

    future.then(this, function mergeCB() {
        var result = checkResult(future.result);
        Log.log("Stored config in config db: ", result);
        buildResult();
    });

    return outerfuture;
};
