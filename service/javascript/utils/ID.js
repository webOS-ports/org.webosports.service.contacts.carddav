/*jslint node: true */
/*global Log */

var url = require("url");   //required to parse urls

var ID = (function () {
	"use strict";
	return {
		/**
		 * Generates remoteId string from uri
		 * @param uri
		 * @param config object with preventDuplicateCalendarEntries entry
		 * @return remoteId string
		 */
		uriToRemoteId: function (uri, config) {
			var i;
			if (!uri) {
				return undefined;
			}

			if (config.preventDuplicateCalendarEntries) {
				for (i = uri.length - 1; i >= 0; i -= 1) {
					if (uri.charAt(i) === "/") {
						return uri.substring(i + 1);
					}
				}
			}
			return uri; //fallback
		},

		/**
		 * This method is used to find the correct URI from a local/remote object pair.
		 * @param kindName
		 * @param obj
		 * @param config object
		 */
		findURIofRemoteObject: function (kindName, obj, SyncKey) {
			Log.log("\n\n**************************SyncAssistant: _findURIofRemoteObject *****************************");
			var uri, prefix, remoteId;

			if (!obj) {
				obj = { local: {}, remote: {} };
			}

			uri = obj.local.uri;
			if (!uri) {

				//get the URL of a addressbook or calendar.
				if (obj.local.calendarId) {
					SyncKey.forEachFolder(kindName, function (folder) {
						if (folder.collectionId === obj.local.calendarId) {
							prefix = folder.uri;
						}
					});
				}

				if (!prefix) {
					//if no collection, use first folder. This should not happen. But it happened due to bug with calendar-deletion.
					Log.debug("Had no folder for collectionId ", obj.local.calendarId);
					prefix = SyncKey.getFolder(kindName, 0).uri;
					obj.local.calendarId = SyncKey.getFolder(kindName, 0).collectionId;
				}

				prefix = url.parse(prefix).pathname || "/";

				if (prefix.charAt(prefix.length - 1) !== "/") {
					prefix += "/";
				}

				//if we already have a remoteId somewhere, keep it.
				if (obj.remote.remoteId) {
					remoteId = obj.remote.remoteId;
				} else if (obj.local.remoteId) {
					remoteId = obj.local.remoteId;
				}

				if (!remoteId) {
					//generate a "random" uri.
					remoteId = this.getNewRemoteObject();
				}

				//we assume that getNewRemoteObject() was called before and did not create a full URI remote id.
				uri = prefix + remoteId;
			} else {
				remoteId = obj.local.remoteId;
				if (!remoteId) {
					remoteId = ID.uriToRemoteId(uri, SyncKey.getConfig());
				}
			}

			obj.remote.uri = uri;
			if (SyncKey.getConfig().preventDuplicateCalendarEntries) {
				obj.remote.remoteId = remoteId;
				obj.local.remoteId = remoteId;
			} else {
				obj.remote.remoteId = uri;
				obj.local.remoteId = uri;
			}
			obj.local.uri = uri;
			obj.local.uid = remoteId;
		}
	};
}());

module.exports = ID;
