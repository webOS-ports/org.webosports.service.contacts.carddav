/*global console, exports, global, require */

var fs = global.fs;
if (!global.fs) {
	fs = require("fs");
}

var dummy = function () {"use strict"; return undefined; };

var log = function (str) {
	"use strict";
	console.error(str);
};

var filestream;
exports.setFilename = function (fn) {
	"use strict";
	if (filestream) {
		filestream.end();
	}
	if (fn) {
		try {
			filestream = fs.createWriteStream(fn, {flags: "w+"});

			filestream.on("error", function (err) {
				if (err) {
					console.error("Could not create file (error-event) " + fn, err);
				} else {
					console.error("Error..?");
				}
				filestream = false;
			});
		} catch (e) {
			console.error("Could not create file (exception) " + fn, e);
		}
	}
};

/*
 * The log goes to the system log and to a file readable over USB, so credentials,
 * HTTP payloads and what people keep in their calendars and address books must
 * never reach it. Logged objects lose these keys, wherever they are nested.
 */
var REDACTED = "<redacted>";
var SECRET_KEYS = /^(authorization|proxy-authorization|cookie|set-cookie|authtoken|access_token|refresh_token|id_token|client_secret|password|keydata|credentials|userauth|oauth|body|parsedbody)$/i;

var PERSONAL_NAMES = "subject|summary|location|notes?|description|comments?|attendees?|organizer|" +
	"names?|displayname|givenname|familyname|middlename|fullname|nickname|fn|username|user|" +
	"emails?|phonenumbers?|phones?|ims|address|addresses|urls|organizations?|relations|" +
	"birthday|anniversary|photos?|vcard|ical|dtstart|dtend|due|completed|rrule|exdates|rdates|recurrenceid";
var PERSONAL_KEYS = new RegExp("^(" + PERSONAL_NAMES + ")$", "i");

var isPrivateKey = function (key) {
	"use strict";
	return SECRET_KEYS.test(key) || PERSONAL_KEYS.test(key);
};

var redactKey = function (key, value) {
	"use strict";
	return isPrivateKey(key) ? REDACTED : value;
};

/* The same for text that was already turned into a string before logging. */
var PERSONAL_VALUES = new RegExp("(\\\\*)\"(" + PERSONAL_NAMES + ")\\1\"\\s*:\\s*", "gi");
var CARD_OR_CALENDAR = /BEGIN:(VCARD|VCALENDAR|VEVENT|VTODO)[\s\S]*?(END:\1|$)/gi;
var MAIL_ADDRESS = /[A-Za-z0-9._+\-]+(@|%40)[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+/g;
var SECRET_VALUES = /(access_token|refresh_token|id_token|client_secret|authToken|password|keydata)(\\*"?\s*[:=]\s*)/gi;

// Index just past the closing quote of a value opened by backslashes + quote at start.
var endOfQuoted = function (text, start, backslashes) {
	"use strict";
	var i, run;
	for (i = start; i < text.length; i += 1) {
		if (text.charAt(i) === "\"") {
			run = 0;
			while (i - run - 1 >= start && text.charAt(i - run - 1) === "\\") {
				run += 1;
			}
			if (run === backslashes || (backslashes === 0 && run % 2 === 0)) {
				return i + 1;
			}
		}
	}
	return text.length; // unterminated: drop the rest rather than risk showing it
};

// Index just past a JSON array or object that opens at start.
var endOfNested = function (text, start, backslashes) {
	"use strict";
	var i = start, depth = 0, ch, quote = new Array(backslashes + 1).join("\\") + "\"";
	while (i < text.length) {
		ch = text.charAt(i);
		if (text.substr(i, quote.length) === quote) {
			i = endOfQuoted(text, i + quote.length, backslashes);
		} else {
			if (ch === "[" || ch === "{") {
				depth += 1;
			} else if (ch === "]" || ch === "}") {
				depth -= 1;
				if (depth === 0) {
					return i + 1;
				}
			}
			i += 1;
		}
	}
	return text.length; // unterminated: drop the rest rather than risk showing it
};

var scrubValues = function (text, pattern) {
	"use strict";
	var out = "", last = 0, match, pos, slashes, end, first, key;

	pattern.lastIndex = 0;
	match = pattern.exec(text);
	while (match) {
		pos = pattern.lastIndex;
		slashes = 0;
		while (text.charAt(pos + slashes) === "\\") {
			slashes += 1;
		}
		first = text.charAt(pos + slashes);
		if (first === "\"") {
			end = endOfQuoted(text, pos + slashes + 1, slashes);
		} else if (first === "[" || first === "{") {
			// an array has no quote of its own: its strings are escaped like the key before it
			key = match[0].lastIndexOf("\"");
			slashes = 0;
			while (key > slashes && match[0].charAt(key - slashes - 1) === "\\") {
				slashes += 1;
			}
			end = endOfNested(text, pos, slashes);
		} else {
			end = pos;
			while (end < text.length && !/[&\s,;}"'\\]/.test(text.charAt(end))) {
				end += 1;
			}
		}
		out += text.slice(last, pos) + REDACTED;
		last = end;
		pattern.lastIndex = Math.max(end, pos);
		match = pattern.exec(text);
	}
	return out + text.slice(last);
};

var scrub = function (text) {
	"use strict";
	return scrubValues(scrubValues(text, SECRET_VALUES), PERSONAL_VALUES)
		.replace(CARD_OR_CALENDAR, "<$1 " + REDACTED + ">")
		.replace(MAIL_ADDRESS, REDACTED)
		.replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+\/._~=\-]{8,}/g, "$1 " + REDACTED)
		.replace(/\bDigest\s+username=[^\n]*/g, "Digest " + REDACTED);
};

var printObj = function (obj, depth) {
	"use strict";
	var key, msg = "{";
	if (undefined === depth) {
		depth = 0;
	}
	if (typeof obj === "string") {
		return obj;
	}

	try {
		msg = JSON.stringify(obj, redactKey);
	} catch (e) {
		if (depth < 5) {
			for (key in obj) {
				if (isPrivateKey(key)) {
					msg += " " + key + ": \"" + REDACTED + "\",";
				} else if (obj.hasOwnProperty(key)) {
					try {
						msg += " " + key + ": " + JSON.stringify(obj[key], redactKey) + ",";
					} catch (e1) {
						msg += " " + key + ": " + printObj(obj[key], depth + 1) + ",";
					}
				}
			}
			//strings are immutable: assigning to msg[i] threw in strict mode.
			msg = msg.replace(/,$/, "") + " }";
		} else {
			msg = "...";
		}
	}
	return msg;
};

var logBase = function () {
	"use strict";
	var i, pos, datum, argsArr = Array.prototype.slice.call(arguments, 0),
		data;

	for (i = 0; i < argsArr.length; i += 1) {
		argsArr[i] = printObj(argsArr[i], 0);
	}

	data = scrub(argsArr.join(""));
	if (filestream) {
		try {
			filestream.write(new Date() + ": " + data + "\n");
		} catch (error) {
			console.error("Unable to write to file: ", error);
		}
	}

	// I want ALL my logs!
	data = data.split("\n");
	for (i = 0; i < data.length; i += 1) {
		datum = data[i];

		if (datum.length < 500) {
			log(datum);
		} else {
			// Do our own wrapping
			for (pos = 0; pos < datum.length; pos += 500) {
				log(datum.slice(pos, pos + 500));
			}
		}
	}
};

exports.printObj                = printObj;
exports.log                     = logBase;
exports.debug                   = logBase;
exports.log_icalDebug           = dummy; // prints whole events and contacts
exports.log_calDavDebug         = logBase;
exports.log_httpClient          = logBase;
exports.log_calDavParsingDebug  = dummy;
