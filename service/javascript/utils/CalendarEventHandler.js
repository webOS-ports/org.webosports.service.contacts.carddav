/*global Log, DB, Kinds, checkResult, Future, servicePath */

var iCal = require(servicePath + "/javascript/utils/iCal.js");

var CalendarEventHandler = (function () {
    "use strict";

    function getParent(event) {
        var future = new Future(),
            parentEvent;

        if (event.parentId) {
            future.nest(DB.get([event.parentId]));
        } else {
            future.result = {returnValue: true, noChild: true};
        }

        future.then(function parentCB() {
            var result = checkResult(future);

            if (result.returnValue) {
                if (result.noChild) {
                    if (event.rrule) {
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
            future = DB.find({
                from: Kinds.objects.calendarevent.id,
                where: [
                    {
                        prop: "remoteId",
                        op: "=",
                        val: remoteId
                    }
                ]
            });

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

            //try to get parent of recurring event stuff.
            future.nest(getParent(event));

            //process parent. If event has rrule is potential parent itself.
            future.then(this, function parentCB() {
                var result = checkResult(future);

                if (result.returnValue) {
                    if (result.normalEvent) {
                        //just an ordinary event, process it and return ical data.
                        future.nest(iCal.generateICal(event));
                    } else {
                        parentEvent = result.parent;
                        future.nest(getChildren(parentEvent));
                    }
                }
            });

            future.then(this, function () {
                var result = checkResult(future);
                if (result.returnValue && !result.result) { //either no success or ordinary event that already was processed.
                    if (result.results.length > 0) {
                        //have children!
                        future.nest(iCal.generateICalWithExceptions(parentEvent, result.results));
                    } else {
                        //no children => just process the event.
                        future.nest(iCal.generateICal(parentEvent));
                    }
                } else {
                    future.result = result;
                }
            });

            return future;
        }
    };
}());

module.exports = CalendarEventHandler;
