/*jslint nomen: true, node: true */
/*global Log, checkResult, Kinds, DB, Future */

var ETag = (function () {
	"use strict";
	return {
		/**
		 * Finds an entry form an array by remoteId.
		 * Used for etag directories and collections.
		 * @param remoteId, remoteId to search for
		 * @param objs, array of objects to search through
		 * @param key optional key, default is remoteId
		 * @return found object, undefined if found nothing.
		 */
		findMatch: function (remoteId, objs, key) {
			var i;
			if (!key) {
				key = "remoteId";
			}
			for (i = 0; i < objs.length; i += 1) {
				if (objs[i][key] === remoteId) {
					return objs[i];
				}
			}
		},

		/**
		 * Method to test for orphaned objects, i.e. objects not in an existing collection anymore.
		 * Hopefully this will be unnecessary sometime in the future, but currently I
		 * observe objects not getting deleted if calendar/contactset get's removed.
		 * This happens only sometimes. Maybe failure somewhere during sync is involved.
		 * @param l, entry to check for orphanism.
		 */
		isOrphanedEntry: function (l, SyncKey) {
			var key, cids = [];

			function folderCB(folder) {
				cids.push(folder.collectionId);
			}

			for (key in Kinds.objects) {
				if (Kinds.objects.hasOwnProperty(key)) {
					SyncKey.forEachFolder(Kinds.objects[key].name, folderCB);
				}
			}

			if (l.calendarId) {
				l.doDelete = true;
				cids.forEach(function (cid) {
					if (l.calendarId === cid) {
						l.doDelete = false;
					}
				});

				if (l.doDelete) {
					Log.debug(l.remoteId, " seems to be orphaned entry left from collection change. Do delete.");
					return true;
				}
			}
			return false;
		},


		/**
		 * Parses remote & local etag directories and identifies differences.
		 * @param remoteEtags remote etag directory
		 * @param localEtags local etag cirectory
		 * @param currentCollectionId for delete checks
		 * @param key the key to check for, defaults to "etag".
		 * @return entries array with one entry: {uri, etag, doDelete, add}
		 */
		parseEtags: function (remoteEtags, localEtags, currentCollectionId, SyncKey, key) {
			var entries = [], l, r, found, i, stats = {add: 0, del: 0, update: 0, noChange: 0, orphaned: 0, retriesNecessary: 0};
			Log.log("Got local etags: ", localEtags.length);
			Log.log("Got remote etags: ", remoteEtags.length);

			if (!key) {
				key = "etag";
			}

			//we need update. Determine which objects to update.
			//1. get etags and uris from server.
			//2. get local etags and uris from device db
			//compare the sets.
			//uri only on server => needs to be added
			//uri on server & local, etag same => no (remote) change.
			//uri on server & local, but etag differs => needs to be updated (local changes might be lost)
			//local with uri, but not on server => deleted on server, delete local (local changes might be lost)
			//two local with same uri: delete one
			//locally deleted object are downloaded, deleted on server and then delete is downloaded again. Need more investigation
			//DO NOT INCLUDE DELETED HERE!
			for (i = 0; i < localEtags.length; i += 1) {
				l = localEtags[i];
				if (l.remoteId) {

					//filter orphaned entries in different collections.
					if (!this.isOrphanedEntry(l, SyncKey)) {
						found = false;
						r = this.findMatch(l.remoteId, remoteEtags);

						if (r) {
							if (r.found) {
								Log.log("Found local duplicate.");
							} else {
								found = true;
								r.found = true;
								if (l[key] !== r[key]) { //have change on server => need update.
									entries.push(r);
									stats.update += 1;
								} else {
									if (l.uploadFailed) { //retry upload if no change on server only.
										l.doRetry = true;
										entries.push(l);
										//Log.debug("RETRY ALREADY ON SERVER => ", entries);
										stats.retriesNecessary += 1;
									} else {
										stats.noChange += 1;
									}
								}
							}
						}

						//not found => deleted on server.
						if (!found) {
							//only delete if object is in same collection.
							if (!l.calendarId || l.calendarId === currentCollectionId) {
								if (l.uploadFailed) { //upload failed and not on server => probably was never on server
									stats.retriesNecessary += 1;
									l.doRetry = true;
									entries.push(l);
								} else {
									l.doDelete = true;
									stats.del += 1;
									entries.push(l);
								}
							}
						}
					} else {
						stats.orphaned += 1;
					}
				}
			}

			//find completely new remote objects
			for (i = 0; i < remoteEtags.length; i += 1) {
				r = remoteEtags[i];
				if (!r.found) { //was not found localy, need add!
					stats.add += 1;
					r.add = true;
					entries.push(r);
				}
			}

			Log.log("Got ", entries.length, " remote changes: ", stats);
			return entries;
		},

		/**
		 * Gets etags and uris from the db. etags and uris are currently saved together with the
		 * database objects (i.e. with the contact or calendarevent).
		 * @param kindName
		 * @return future, result.results will be array of { etag, uri, remoteId, _id, calendarId } objects
		 */
		getLocalEtags: function (kindName, clientId) {
			var query =
				{
					from: Kinds.objects[kindName].id,
					//we could filter for calendarId here. Issue is that we then get adds, if
					//collections overlap, i.e. if events/contacts are in multiple collections on the server
					//at the same time.
					where: [ { prop: "accountId", op: "=", val: clientId } ],
					incDel: false, //DO NOT INCLUDE DELETED HERE! Leads to a ton of issues and deleted stuff on server!
					select: ["etag", "remoteId", "_id", "uri", "calendarId", "parentId", "uploadFailed"],
					limit: 100
				}, future, outerFuture = new Future(), results = [];

			function processResult() {
				var result = checkResult(future);
				if (result.returnValue === true) {
					Log.debug("Got ", result.results.length, " etags.");
					result.results.forEach(function (obj) {
						if (!obj.parentId) { //remove exceptions of events, because they share the same URI.
							results.push(obj);
						} else {
							Log.debug("Skipped child event.");
						}
					});

					if (result.next) {
						query.page = result.next;
						future.nest(DB.find(query, false, true));
						future.then(processResult);
					} else {
						Log.debug("All in all got ", results.length, " etags.");
						outerFuture.result = {returnValue: true, results: results};
					}
				} else {
					future.result = result;
				}
			}

			future = DB.find(query, false, true);
			future.then(processResult);

			return outerFuture;
		}
	};
}());

module.exports = ETag;
