/*jslint node: true, nomen: true */
/*global Log, DB, checkResult, fs, Future, libPath, Kinds, iCal */

var vCard = require(libPath + "vCard.js");
var CalendarEventHandler = require(libPath + "CalendarEventHandler.js");

var AddItemAssistant = function () { "use strict"; };

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

function parseAndPut(data, filename, contact) {
	"use strict";
	var future = new Future();

	if (contact) {
		future.nest(vCard.parseVCard({account: { name: "addItemAssistant",
												kind: Kinds.objects.contact.id },
									  vCard: data}));
	} else {
		future.nest(iCal.parseICal(data));

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

			future.then(function idCB() {
				checkResult(future);
				Log.debug("Putting: ", objs);
				future.nest(DB.put(objs));
			});
		});
	}

	return future;
}

AddItemAssistant.prototype.run = function (outerFuture) {
	"use strict";
	var args = this.controller.args, filename, parse = false, contact = false;

	if (args.json) {
		filename = args.json;
		if (args.contact) {
			contact = true;
		}
	} else if (args.ics) {
		filename = args.ics;
		parse = true;
	} else if (args.vcf) {
		filename = args.vcf;
		parse = true;
		contact = true;
	}

	if (filename) {
		fs.readFile(filename, function (err, data) {
			if (err) {
				Log.log("Could not read ", filename);
			} else {

				if (parse) {
					parseAndPut(data.toString("utf8"), filename, contact).then(function (future) {
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
