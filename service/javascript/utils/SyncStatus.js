/*jslint node: true */
/*global Log*/

var SyncStatus = (function () {
	"use strict";
	var perAccountStatus = {},
		callbacks = {};

	function callCallbacks(accountId) {
		var cbs = callbacks[accountId];
		if (cbs) {
			cbs.forEach(function (cb) {
				if (typeof cb === "function") {
					cb(perAccountStatus[accountId]);
				}
			});
		}
	}

	function setValue(accountId, kindName, field, value, silent) {
		var acctObj = perAccountStatus[accountId], kind;
		if (!acctObj) {
			acctObj = {};
			perAccountStatus[accountId] = acctObj;
		}
		kind = acctObj[kindName];
		if (!kind) {
			kind = {};
			acctObj[kindName] = kind;
		}

		//transport running status to outside
		if (field === "running") {
			acctObj.running = value;
		}

		kind[field] = value;
		if (!silent) {
			callCallbacks(accountId);
		}
	}

	function clearNumbers(accountId, kindName) {
		var acctObj = perAccountStatus[accountId], kind;
		if (acctObj) {
			kind = acctObj[kindName];
			if (kind) {
				delete kind.uploadsDone;
				delete kind.uploadTotal;
				delete kind.downloadsDone;
				delete kind.downloadTotal;
			}
		}
	}

	function getValue(accountId, kindName, field) {
		if (!perAccountStatus[accountId]) {
			return;
		}
		if (!perAccountStatus[accountId][kindName]) {
			return;
		}
		return perAccountStatus[accountId][kindName][field];
	}

	return {
		setStatus: function (accountId, kindName, msg) {
			setValue(accountId, kindName, "status", msg);
		},

		setUploadTotal: function (accountId, kindName, num) {
			setValue(accountId, kindName, "uploadsDone", 0, true);
			setValue(accountId, kindName, "uploadTotal", num);
		},

		setDownloadTotal: function (accountId, kindName, num) {
			setValue(accountId, kindName, "downloadsDone", 0, true);
			setValue(accountId, kindName, "downloadTotal", num);
		},

		uploadedOne: function (accountId, kindName) {
			setValue(accountId, kindName, "uploadsDone", (getValue(accountId, kindName, "uploadsDone") || 0) + 1);
		},

		downloadedOne: function (accountId, kindName) {
			setValue(accountId, kindName, "downloadsDone", (getValue(accountId, kindName, "downloadsDone") || 0) + 1);
		},

		setRunning: function (accountId, kindName) {
			clearNumbers(accountId, kindName);
			setValue(accountId, kindName, "running", true);
		},

		setDone: function (accountId, kindName) {
			clearNumbers(accountId, kindName);
			setValue(accountId, kindName, "running", false);
		},

		registerChangeCallback: function (accountId, callback) {
			if (!callbacks[accountId]) {
				callbacks[accountId] = [];
			}
			if (typeof callback === "function") {
				callbacks[accountId].push(callback);
			}
		},

		deregisterChangeCallback: function (accountId, callback) {
			if (!callbacks[accountId]) {
				return;
			}
			var index = callbacks[accountId].indexOf(callback);
			if (index >= 0) {
				callbacks[accountId].splice(index, 1);
			}
		},

		getStatus: function (accountId) {
			if (!perAccountStatus[accountId]) {
				return {running: false};
			}
			return perAccountStatus[accountId];
		}
	};
}());

module.exports = SyncStatus;
