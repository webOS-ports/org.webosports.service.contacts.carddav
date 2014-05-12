/**************************************************
KeyStore - used to handle storage of authentication data
within key manager.
**************************************************/
/*jslint nomen: true, sloppy: true */
/*global Future, PalmCall, Log, Base64 */
//this is taken from MojoSyncFramework example in PalmSDK. What License is this under??
var KeyStore = (function () {
    var keyStoreFuture = new Future(null),
        KEYMGR_URI = "palm://com.palm.keymanager/",
        _putCredentials,
        _getCredentials,
        _deleteCredentials,
        _hasCredentials;

    _putCredentials = function (accountId, value) {
        var keydata, future;

        //console.log("------>made API call _putCredentials using accountId:" + accountId);
        future = PalmCall.call(KEYMGR_URI, "fetchKey", {
            keyname: accountId
        });

        future.then(function () {
            try { // Fire the exception if there is one
                future.getResult();
            } catch (e) {
                keydata = {};
                future.result = {};
                return;
            }

            keydata = JSON.parse(future.result.keydata);

            // Remove the key with this accountId, so it can be replaced
            //console.log("------>made API _putCredentials call remove");
            future.nest(PalmCall.call(KEYMGR_URI, "remove", {
                "keyname": accountId
            }));
        });

        future.then(function () {
            try {
                future.getResult();
            } catch (e) {
                //ignore error?
            }
            keydata = value;

            //console.log("------>made API _putCredentials call store - Data:" + JSON.stringify(keydata));
            future.nest(PalmCall.call(KEYMGR_URI, "store", {
                keyname: accountId,
                keydata: JSON.stringify(keydata),
                type:        "ASCIIBLOB",
                nohide:    true
            }));
        });
        return future;
    };

    _getCredentials = function (accountId) {
        //console.log("------>made API call get");
        var future = PalmCall.call(KEYMGR_URI, "fetchKey", {
            keyname: accountId
        });
        future.then(function () {
            var success, credentials;

            try {
                credentials = JSON.parse(future.result.keydata);

                if (credentials) {
                    future.result = {
                        credentials: credentials
                    };
                    success = true;
                }
            } catch (e) {
            }

            if (!success) {
                future.setException({
                    message: "Credentials for key '" + accountId + "' not found ",
                    errorCode: "CREDENTIALS_NOT_FOUND"
                });
            }

        });

        return future;
    };

    _deleteCredentials = function (accountId) {
        //console.log("------>made API call delete");
        return PalmCall.call(KEYMGR_URI, "remove", {
            keyname: accountId
        });
    };

    _hasCredentials = function (accountId) {
        Log.log("------>made API call has credentials");
        var future = PalmCall.call(KEYMGR_URI, "keyInfo", {
            keyname: accountId
        });
        future.then(function () {
            var r,
                success;

            try {
                r = future.result;
                success = true;
            } catch (e) {
                success = false;
            }
            future.result = {
                "value": success
            };
        });
        return future;
    };

    return {
        checkKey: function (key) {
            return _hasCredentials(Base64.encode(key));
        },
        putKey: function (key, dataValue) {
            return _putCredentials(Base64.encode(key), dataValue);
        },
        getKey: function (key) {
            return _getCredentials(Base64.encode(key));
        },
        deleteKey: function (key) {
            return _deleteCredentials(Base64.encode(key));
        }
    };
}());
