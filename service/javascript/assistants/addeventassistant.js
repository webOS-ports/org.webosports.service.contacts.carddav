/*global Log, DB, checkResult, fs, Future, servicePath, Kinds */

var iCal = require(servicePath + "/javascript/utils/iCal.js");
var CalendarEventHandler = require(servicePath + "/javascript/utils/CalendarEventHandler.js");

var AddEventAssistant = function () { "use strict"; };

function removeIds(obj) {
    "use strict";
    var key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) {
            if (key === "_id") {
                delete obj[key];
            } else if (typeof obj[key] === "object") {
                obj[key] = removeIds(obj[key]);
            }
        }
    }
    return obj;
}

function parseAndPut(ics, filename) {
    "use strict";
    var future = new Future();
    future.nest(iCal.parseICal(ics));

    future.then(function () {
        var result = checkResult(future), objs = [];
        Log.log("parse result: ", result);

        if (result.returnValue === true) {
            objs.push(result.result);
            result.result.remoteId = filename;
            if (result.hasExceptions) {
                future.nest(CalendarEventHandler.fillParentIds(filename, result.result, result.exceptions));
                objs = objs.concat(result.exceptions);
            } else {
                future.result = {returnValue: true};
            }
        }

        objs.forEach(function (event) {
            event._kind = Kinds.objects.calendarevent.id;
        });

        future.then (function idCB() {
            checkResult(future);
            Log.debug("Putting: ", objs);
            future.nest(DB.put(objs));
        });
    });

    return future;
}

AddEventAssistant.prototype.run = function (outerFuture) {
    "use strict";
    var args = this.controller.args, filename, parse = false;

    if (args.json) {
        filename = args.json;
    } else if (args.ics) {
        filename = args.ics;
        parse = true;
    }

    if (filename) {
        fs.readFile(filename, function (err, data) {
            if (err) {
                Log.log("Could not read ", args.json);
            } else {

                if (parse) {
                    parseAndPut(data.toString("utf8"), filename).then(function (future) {
                        var result = checkResult(future);
                        Log.log("Parse & Put Result: ", result);
                        outerFuture.result = result;
                    });
                } else {
                    var obj = JSON.parse(data), objs;

                    obj = removeIds(obj);

                    if (obj.length >= 0) {
                        objs = obj;
                    } else {
                        objs = [obj];
                    }

                    DB.put(objs).then(function (future) {
                        var result = checkResult(future);
                        Log.log("Put result: ", result);
                        outerFuture.result = result;
                    });
                }
            }
        });
    }

    return outerFuture;
};
