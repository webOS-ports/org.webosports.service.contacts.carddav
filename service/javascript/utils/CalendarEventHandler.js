/*jslint node: true, nomen: true */
/*global Log, DB, Kinds, checkResult, Future, iCal */

var CalendarEventHandler = (function () {
	"use strict";

	function getParent(event) {
		var future = new Future(),
			parentEvent;

		if (event.parentId) {
			Log.debug("--> Is child event.");
			future.nest(DB.get([event.parentId]));
		} else {
			future.result = {returnValue: true, noChild: true};
		}

		future.then(function parentCB() {
			var result = checkResult(future);

			if (result.returnValue) {
				if (result.noChild) {
					if (event.rrule) {
						Log.debug("--> Is parent event.");
						parentEvent = event;
					} else {
						future.result = {returnValue: true, normalEvent: true};
					}
				} else {
					parentEvent = result.results[0];
				}

				if (parentEvent) {
					future.result = {returnValue: true, normalEvent: false, parent: parentEvent};
				}
			} else {
				future.result = result;
			}
		});

		return future;
	}

	function getChildren(event) {
		var future = DB.find({
			from: Kinds.objects.calendarevent.id,
			where: [
				{
					prop: "parentId",
					op: "=",
					val: event._id
				}
			]
		});

		return future;
	}

	function findEventByRemoteId(remoteId) {
		return DB.find({
			from: Kinds.objects.calendarevent.id,
			where: [
				{
					prop: "remoteId",
					op: "=",
					val: remoteId
				}
			]
		});
	}

	return {
		/**
		 * Generates remoteId string from uri
		 * @param uri
		 * @param config object with preventDuplicateCalendarEntries entry
		 * @return remoteId string
		 */
		fillParentIds: function (remoteId, event, children) {
			var future;
			//get parent Id:
			future = findEventByRemoteId(remoteId);

			future.then(this, function getObjCB() {
				var result = checkResult(future), r = result.results;
				if (result.returnValue === true && r.length > 0 && r[0] && r[0]._id) {
					Log.debug("Entry with id ", r[0]._id, " found for ", remoteId);
					future.result = {returnValue: true, ids: [r[0]._id]};
				} else {
					Log.debug("No entry found for ", remoteId, ": ", result);
					future.nest(DB.reserveIds(1));
				}
			});

			future.then(this, function idCB() {
				var result = checkResult(future);
				if (result.returnValue) {
					children.forEach(function (event) {
						event.parentId = result.ids[0];
					});
					event._id = result.ids[0]; //remember reserved id
					future.result = {returnValue: true};
				} else {
					Log.log("Could not get parent id. Why?", result);
					future.result = {returnValue: false};
				}

			});

			return future;
		},

		//only a stub for now.
		parseICal: function (ical) {
			return iCal.parseICal(ical);
		},

		//could possibly upload events multiple times... i.e. if multiple children changed, I ignore that here.
		buildIcal: function (event) {
			var future = new Future(),
				parentEvent;

			Log.debug("Building iCal for ", event);

			//try to get parent of recurring event stuff.
			future.nest(getParent(event));

			//process parent. If event has rrule is potential parent itself.
			future.then(this, function parentCB() {
				var result = checkResult(future);

				if (result.returnValue) {
					if (result.normalEvent) {
						Log.debug("Normal event.");
						//just an ordinary event, process it and return ical data.
						future.nest(iCal.generateICal(event));
					} else {
						parentEvent = result.parent;
						future.nest(getChildren(parentEvent));
					}
				} else {
					future.result = result;
				}
			});

			future.then(this, function () {
				var result = checkResult(future);
				if (result.returnValue && !result.result) { //either no success or ordinary event that already was processed.
					if (result.results.length > 0) {
						//have children!
						result.results.forEach(function (e, index) {
							e.uid = parentEvent.uid || parentEvent.uId;
							e.relateTo = e.uid;
							e.remoteId = parentEvent.remoteId + "exception" + index;
							e.uri = parentEvent.uri;
						});

						future.nest(iCal.generateICalWithExceptions(parentEvent, result.results));
					} else {
						//no children => just process the event.
						future.nest(iCal.generateICal(parentEvent));
					}
				} else {
					future.result = result;
				}
			});

			future.then(this, function () {
				var result = checkResult(future);

				if (parentEvent) {
					Log.debug("Have parent, set uri and etag to correct values.");
					result.uri = parentEvent.uri;
					result.etag = parentEvent.etag;
				}

				future.result = result;
			});

			return future;
		},

		processEvent: function (entries, entriesIndex, remoteId, result) {
			var entry = entries[entriesIndex], future = new Future();

			if (entry.obj.rrule) {
				Log.debug("Event has rrule, deleting child events for remoteId ", remoteId, " and entry ", entry);
				future.nest(findEventByRemoteId(remoteId));
				future.then(function findByRemoteIdCB() {
					var result = checkResult(future), toMerge = [], parentId;
					Log.debug("Find event returned: ", result);
					result.results.forEach(function (res) {
						if (res.parentId || res.relatedTo || res.parentDtstart) {
							res._del = true;
							res.preventSync = true;
							toMerge.push(res);
						} else {
							Log.debug("Found partent with id ", res._id);
							parentId = res._id;
						}
					});

					Log.debug("To delete events: ", toMerge);
					if (toMerge.length) {
						future.nest(DB.merge(toMerge));
					} else {
						future.result = { returnValue: false};
					}

					future.then(function delByRemoteIDCD() {
						var result = checkResult(future);
						Log.debug("Delete children by remoteId result: ", result);
						if (parentId) {
							Log.debug("Have parentId, use that to delete, too.");
							future.nest(getChildren({_id: parentId}));
						} else {
							future.result = result;
						}
					});

					//delete by parentId here, too, because webOS creates new events for exceptions that don't have
					//the remoteId set and are not caught by the above method. This will happen during upsync
					//and might provoke db errors on device.
					//But if we don't do that here, we will have exceptions showing up to often.
					future.then(function getChildrenCB() {
						var result = checkResult(future);
						if (parentId) {
							Log.debug("Got children by parentId: ", result);
							toMerge = [];
							if (result.results && result.results.length) {
								result.results.forEach(function (res) {
									if (res.parentId || res.relatedTo || res.parentDtstart) {
										res._del = true;
										res.preventSync = true;
										toMerge.push(res);
									}
								});
							}

							Log.debug("To delete events by parentId: ", toMerge);
							if (toMerge.length) {
								future.nest(DB.merge(toMerge));
							} else {
								future.result = { returnValue: false};
							}
						} else {
							future.result = { returnValue: false};
						}
					});

					future.then(function delChildrenCB() {
						var result = checkResult(future);
						Log.debug("Delete children by parentId result: ", result);
						future.result = {returnValue: true};
					});
				});
			} else {
				future.result = {returnValue: true};
			}

			future.then(function () {
				checkResult(future);
				if (result.hasExceptions) {
					//is calendarevent with rrule and exceptions

					//add the exceptions to the end of the entries, indicating that they are already downloaded.
					result.exceptions.forEach(function (event, index) {
						event.collectionId = entries[entriesIndex].collectionId;
						event.uid = entries[entriesIndex].uid || entries[entriesIndex].uId;
						event.remoteId = entries[entriesIndex].remoteId;
						entries.push({
							alreadyDownloaded: true,
							obj: event,
							uri: entries[entriesIndex].uri + "exception" + index,
							collectionId: entries[entriesIndex].collectionId,
							etag: entries[entriesIndex].etag
						});
					});

					future.nest(CalendarEventHandler.fillParentIds(remoteId, result, result.exceptions));
				} else {
					future.result = {returnValue: true};
				}
			});

			return future;
		}
	};
}());

module.exports = CalendarEventHandler;
