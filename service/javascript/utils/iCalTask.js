/*jslint node: true, nomen: true */
/*global Future, Log, checkResult, libPath */

/*
 * Tasks (VTODO, RFC 5545 section 3.6.2) as objects of com.palm.task:1.
 * A task is read through the event parser, which knows about folding, quoting and time zones:
 * its due date takes the place of the start of an event.
 */
var iCal = require(libPath + "iCal.js");
var Time = require(libPath + "iCalTimeHandling.js");
var Quoting = require(libPath + "Quoting.js");

var iCalTask = (function () {
	"use strict";
	var NO_DUE_DATE = "DTSTART:20000101T000000Z",
		PRIORITY_HIGH = 1,
		PRIORITY_NORMAL = 2,
		PRIORITY_LOW = 3;

	function unfold(ical) {
		return ical.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
	}

	function nameOf(line) {
		return (/^[^;:]*/).exec(line)[0].toUpperCase();
	}

	function valueOf(line) {
		return line.substring(line.indexOf(":") + 1).trim();
	}

	//RFC 5545 section 3.8.1.9: 1 to 4 are high, 5 is medium, 6 to 9 are low, 0 says nothing.
	function priorityOf(value) {
		var number = parseInt(value, 10);
		if (number >= 1 && number <= 4) {
			return PRIORITY_HIGH;
		}
		if (number >= 6 && number <= 9) {
			return PRIORITY_LOW;
		}
		return PRIORITY_NORMAL;
	}

	//Splits the calendar into the first task that is not a changed occurrence and the rest.
	function findTask(lines) {
		var outside = [], task, current, depth = 0;
		lines.forEach(function (line) {
			var upper = line.toUpperCase().trim();
			if (!current && upper === "BEGIN:VTODO") {
				current = [];
				depth = 0;
			} else if (current && upper === "END:VTODO" && depth === 0) {
				if (!task && !current.some(function (entry) { return nameOf(entry) === "RECURRENCE-ID"; })) {
					task = current;
				}
				current = undefined;
			} else if (current) {
				if ((/^BEGIN:/).test(upper)) {
					depth += 1;
				} else if ((/^END:/).test(upper)) {
					depth -= 1;
				} else if (depth === 0) {
					current.push(line);
				}
			} else if (line !== "") {
				outside.push(line);
			}
		});
		return {task: task, outside: outside};
	}

	return {
		/**
		 * @param ical text of a calendar object
		 * @return future, result.result is the task. result.cancelled is set if the object holds
		 *         nothing to show: a cancelled task or no task at all, collections can mix both.
		 */
		parseTask: function (ical) {
			var future = new Future(), lines, parts, kept, task, due, values = {};

			if (!(/BEGIN:VCALENDAR/i).test(ical || "")) {
				future.result = {returnValue: false};
				return future;
			}
			lines = unfold(ical);
			parts = findTask(lines);
			if (!parts.task) {
				future.result = {returnValue: true, cancelled: true};
				return future;
			}

			parts.task.forEach(function (line) {
				values[nameOf(line)] = line;
			});
			if (values.STATUS && valueOf(values.STATUS).toUpperCase() === "CANCELLED") {
				future.result = {returnValue: true, cancelled: true};
				return future;
			}

			due = values.DUE;
			kept = ["SUMMARY", "DESCRIPTION", "UID"].filter(function (name) {
				return values[name];
			}).map(function (name) {
				return values[name];
			});
			kept.push(due ? "DTSTART" + due.substring(3) : NO_DUE_DATE);

			task = parts.outside.filter(function (line) {
				return line.toUpperCase().trim() !== "END:VCALENDAR";
			}).concat(["BEGIN:VEVENT"], kept, ["END:VEVENT", "END:VCALENDAR", ""]).join("\r\n");

			future.nest(iCal.parseICal(task));
			future.then(function () {
				var result = checkResult(future), event = result.result, status, percent, object;
				if (result.returnValue !== true || !event) {
					Log.log("Could not read a task.");
					future.result = {returnValue: false};
					return;
				}
				status = values.STATUS ? valueOf(values.STATUS).toUpperCase() : "";
				percent = values["PERCENT-COMPLETE"] ? parseInt(valueOf(values["PERCENT-COMPLETE"]), 10) : 0;
				object = {
					subject: event.subject || "",
					notes: event.note || "",
					completed: status === "COMPLETED" || !!values.COMPLETED || percent === 100,
					completedDate: null,
					priority: priorityOf(values.PRIORITY ? valueOf(values.PRIORITY) : 0),
					dueDate: due ? event.dtstart : null,
					uid: values.UID ? valueOf(values.UID) : undefined
				};
				if (object.completed && values.COMPLETED) {
					object.completedDate = Time.iCalTimeToWebOsTime(valueOf(values.COMPLETED));
				}
				future.result = {returnValue: true, result: object};
			});
			return future;
		},

		/**
		 * @param task object of com.palm.task:1
		 * @param now time to state as the moment of writing
		 * @return text of a calendar object
		 */
		generateTask: function (task, now) {
			var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//webOS Ports//C+DAV Connector//EN", "BEGIN:VTODO"];

			function utc(time) {
				return new Date(time).toISOString().replace(/[\-:]|\.\d+/g, "");
			}

			function text(name, value) {
				lines.push(Quoting.fold(name + ":" + Quoting.quote(value)));
			}

			lines.push("UID:" + (task.uid || task.remoteId || task._id));
			lines.push("DTSTAMP:" + utc(now));
			text("SUMMARY", task.subject || "");
			if (task.notes) {
				text("DESCRIPTION", task.notes);
			}
			if (task.dueDate) {
				lines.push("DUE:" + utc(task.dueDate));
			}
			lines.push("PRIORITY:" + ({1: 1, 3: 9}[task.priority] || 5));
			if (task.completed) {
				lines.push("STATUS:COMPLETED", "PERCENT-COMPLETE:100");
				lines.push("COMPLETED:" + utc(task.completedDate || now));
			} else {
				lines.push("STATUS:NEEDS-ACTION");
			}
			lines.push("END:VTODO", "END:VCALENDAR", "");
			return lines.join("\r\n");
		}
	};
}());

module.exports = iCalTask;
