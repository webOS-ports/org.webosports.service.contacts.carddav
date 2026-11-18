/*jslint node: true */
/*global Kinds, libPath */

/*
 * Prepares what goes up to a server. webOS keeps only part of an event or contact, so a changed
 * object must not replace the one on the server: only the fields webOS can edit are taken over,
 * attendees, alarms, photos and whatever else the server holds stay as they are.
 */
var Quoting = require(libPath + "Quoting.js");

var ObjectMerge = (function () {
	"use strict";
	var EVENT_FIELDS = ["SUMMARY", "LOCATION", "DESCRIPTION", "DTSTART", "DTEND", "DURATION", "RRULE", "EXDATE"],
		TASK_FIELDS = ["SUMMARY", "DESCRIPTION", "DUE", "PRIORITY", "STATUS", "PERCENT-COMPLETE", "COMPLETED"],
		CARD_FIELDS = ["FN", "N", "NICKNAME", "TEL", "EMAIL", "ADR", "ORG", "TITLE", "URL", "NOTE", "BDAY"],
		TRUNCATED = "...(truncated)";

	function unfold(text) {
		return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/).filter(function (line) {
			return line !== "";
		});
	}

	function join(lines) {
		return lines.map(Quoting.fold).join("\r\n") + "\r\n";
	}

	//the property name, without a group ("item1.TEL") and parameters.
	function nameOf(line) {
		return (/^(?:[^;:.]+\.)?([^;:]*)/).exec(line)[1].toUpperCase();
	}

	function valueOf(line) {
		return line.substring(line.indexOf(":") + 1).trim();
	}

	function isBegin(line, type) {
		return line.toUpperCase().trim() === "BEGIN:" + type;
	}

	function isEnd(line, type) {
		return line.toUpperCase().trim() === "END:" + type;
	}

	//Calls back with the lines of a component that belong to it and not to one inside it.
	function ownLines(lines, callback) {
		var depth = 0;
		lines.forEach(function (line, index) {
			if ((/^BEGIN:/i).test(line)) {
				depth += 1;
			} else if ((/^END:/i).test(line)) {
				depth -= 1;
			} else if (depth === 1) {
				callback(line, index);
			}
		});
	}

	//The components of a type as ranges, with what tells them apart: the changed occurrence.
	function components(lines, type) {
		var found = [], start = -1;
		lines.forEach(function (line, index) {
			var part;
			if (start < 0 && isBegin(line, type)) {
				start = index;
			} else if (start >= 0 && isEnd(line, type)) {
				part = {start: start, end: index, key: ""};
				ownLines(lines.slice(start, index + 1), function (own) {
					if (nameOf(own) === "RECURRENCE-ID") {
						part.key = valueOf(own).replace(/\D/g, "");
					}
				});
				found.push(part);
				start = -1;
			}
		});
		return found;
	}

	function mergeComponent(server, generated, fields) {
		var managed = fields, taken = [], kept = [];

		ownLines(generated, function (line) {
			if (nameOf(line) === "DESCRIPTION" && valueOf(line).slice(-TRUNCATED.length) === TRUNCATED) {
				//only the start was kept here, the server has all of it.
				managed = managed.filter(function (name) { return name !== "DESCRIPTION"; });
			}
		});
		ownLines(generated, function (line) {
			if (managed.indexOf(nameOf(line)) >= 0) {
				taken.push(line);
			}
		});

		(function () {
			var own = {};
			ownLines(server, function (line, index) {
				own[index] = line;
			});
			kept = server.slice(1, -1).filter(function (line, index) {
				var original = own[index + 1];
				return original === undefined || managed.indexOf(nameOf(original)) < 0;
			});
		}());
		return [server[0]].concat(taken, kept, [server[server.length - 1]]);
	}

	function mergeCalendar(serverText, generatedText, type, fields) {
		var server = unfold(serverText), generated = unfold(generatedText),
			existing = components(server, type), replacements = {}, added = [], result = [], next = 0;

		components(generated, type).forEach(function (part) {
			var lines = generated.slice(part.start, part.end + 1), match = existing.filter(function (candidate) {
				return candidate.key === part.key;
			})[0];
			if (match) {
				replacements[match.start] = {end: match.end, lines: mergeComponent(server.slice(match.start, match.end + 1), lines, fields)};
			} else {
				added = added.concat(lines);
			}
		});

		while (next < server.length) {
			if (replacements[next]) {
				result = result.concat(replacements[next].lines);
				next = replacements[next].end + 1;
			} else {
				if (isEnd(server[next], "VCALENDAR")) {
					result = result.concat(added);
					added = [];
				}
				result.push(server[next]);
				next += 1;
			}
		}
		return join(result);
	}

	return {
		/**
		 * Whether changes of this account are sent to its server. The user has to ask for it, and
		 * never for Google: the sign-in promises that nothing changes in the Google account.
		 */
		uploadAllowed: function (config, kindName) {
			var kind = Kinds.objects[kindName];
			return !!(kind && kind.allowUpsync && config && config.twoWay === true && config.urlScheme !== "google" &&
				!config.oauth && !(/(^|[\/.@])(google|googleusercontent|gmail)\.com/i).test(config.url || ""));
		},

		/**
		 * Takes over the user's choice from the stored config: the service can keep running
		 * while it changes. If it cannot be read, nothing is sent.
		 */
		refreshUploadChoice: function (config, stored) {
			config.twoWay = !!(stored && stored.returnValue === true && stored.config && stored.config.twoWay === true);
		},

		/**
		 * Makes generated calendar text what RFC 4791 section 4.1 asks of a stored object.
		 */
		prepareCalendar: function (text, type, uid, now) {
			var lines = unfold(text).filter(function (line) {
				return nameOf(line) !== "METHOD";
			}), parts = components(lines, type), stamp = new Date(now).toISOString().replace(/[\-:]|\.\d+/g, "");

			parts.reverse().forEach(function (part) {
				var names = [], extra = [];
				ownLines(lines.slice(part.start, part.end + 1), function (line) {
					names.push(nameOf(line));
				});
				if (names.indexOf("UID") < 0) {
					extra.push("UID:" + uid);
				}
				if (names.indexOf("DTSTAMP") < 0) {
					extra.push("DTSTAMP:" + stamp);
				}
				lines.splice.apply(lines, [part.start + 1, 0].concat(extra));
			});
			return join(lines);
		},

		mergeEvent: function (server, generated) {
			return mergeCalendar(server, generated, "VEVENT", EVENT_FIELDS);
		},

		mergeTask: function (server, generated) {
			return mergeCalendar(server, generated, "VTODO", TASK_FIELDS);
		},

		mergeCard: function (serverText, generatedText) {
			var server = unfold(serverText), generated = unfold(generatedText), serverPart = components(server, "VCARD")[0],
				generatedPart = components(generated, "VCARD")[0], fields = CARD_FIELDS, merged;

			if (!serverPart || !generatedPart) {
				return generatedText;
			}
			generated.forEach(function (line) {
				//webOS has no birthday without a year, this is what stands in for it.
				if (nameOf(line) === "BDAY" && (/^1900-/).test(valueOf(line))) {
					fields = fields.filter(function (name) { return name !== "BDAY"; });
				}
			});
			merged = mergeComponent(server.slice(serverPart.start, serverPart.end + 1),
				generated.slice(generatedPart.start, generatedPart.end + 1), fields);
			return join(server.slice(0, serverPart.start).concat(merged, server.slice(serverPart.end + 1)));
		}
	};
}());

module.exports = ObjectMerge;
