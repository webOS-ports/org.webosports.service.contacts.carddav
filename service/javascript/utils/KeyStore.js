/**************************************************
KeyStore - used to handle storage of authentication data
within key manager.
**************************************************/
/*jslint nomen: true, node: true */
/*global PalmCall, Log, checkResult, servicePath */
//this is taken from MojoSyncFramework example in PalmSDK
var Base64 = require(servicePath + "/javascript/utils/Base64.js");

var KeyStore = (function () {
	"use strict";
	var KEYMGR_URI = "palm://com.palm.keymanager/",
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
			var result = checkResult(future);
			if (result.returnValue === false && !!result.keyname) {
				keydata = {};
				future.result = {};
			} else {
				// Remove the key with this accountId, so it can be replaced
				//console.log("------>made API _putCredentials call remove");
				future.nest(PalmCall.call(KEYMGR_URI, "remove", {
					keyname: accountId
				}));
			}
		});

		future.then(function () {
			checkResult(future); //ignore result.
			keydata = value;

			//console.log("------>made API _putCredentials call store - Data:" + JSON.stringify(keydata));
			future.nest(PalmCall.call(KEYMGR_URI, "store", {
				keyname: accountId,
				keydata: JSON.stringify(keydata),
				type:    "ASCIIBLOB",
				nohide:  true
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
			var success, credentials, result = checkResult(future);

			if (result.returnValue !== false && result.keydata) {
				credentials = JSON.parse(result.keydata);

				if (credentials) {
					future.result = {
						credentials: credentials
					};
					success = true;
				}
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
			var r = checkResult(future),
				success;

			success = r.returnValue !== false && !!r.keyname;

			future.result = {
				"value": success
			};
		});
		return future;
	};

	return {
		/**
		 * check if the key was stored in DB
		 * @key key, i.e. accountId
		 * @return future
		 */
		checkKey: function (key) {
			return _hasCredentials(Base64.encode(key));
		},
		/**
		 * puts new key into db
		 * @param key, i.e the accountId
		 * @param dataValue, the data to store encrypted
		 * @return future
		 */
		putKey: function (key, dataValue) {
			return _putCredentials(Base64.encode(key), dataValue);
		},
		/**
		 * get & decrypted content from the db.
		 * @key key, i.e. accountId
		 * @return future
		 */
		getKey: function (key) {
			return _getCredentials(Base64.encode(key));
		},
		/**
		 * delete key from db
		 * @key key, i.e. accountId
		 * @return future
		 */
		deleteKey: function (key) {
			return _deleteCredentials(Base64.encode(key));
		}
	};
}());

module.exports = KeyStore;
