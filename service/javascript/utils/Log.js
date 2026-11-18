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
 * The log goes to the system log and to a file readable over USB, so credentials
 * and HTTP payloads must never reach it. Logged objects lose these keys, wherever
 * they are nested.
 */
var REDACTED = "<redacted>";
var SECRET_KEYS = /^(authorization|proxy-authorization|cookie|set-cookie|authtoken|access_token|refresh_token|id_token|client_secret|password|keydata|credentials|userauth|oauth|body|parsedbody)$/i;

var redactKey = function (key, value) {
	"use strict";
	return SECRET_KEYS.test(key) ? REDACTED : value;
};

/* The same for text that was already turned into a string before logging. */
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

var scrub = function (text) {
	"use strict";
	var out = "", last = 0, match, pos, slashes, end;

	SECRET_VALUES.lastIndex = 0;
	match = SECRET_VALUES.exec(text);
	while (match) {
		pos = SECRET_VALUES.lastIndex;
		slashes = 0;
		while (text.charAt(pos + slashes) === "\\") {
			slashes += 1;
		}
		if (text.charAt(pos + slashes) === "\"") {
			end = endOfQuoted(text, pos + slashes + 1, slashes);
		} else {
			end = pos;
			while (end < text.length && !/[&\s,;}"'\\]/.test(text.charAt(end))) {
				end += 1;
			}
		}
		out += text.slice(last, pos) + REDACTED;
		last = end;
		SECRET_VALUES.lastIndex = Math.max(end, pos);
		match = SECRET_VALUES.exec(text);
	}
	out += text.slice(last);

	return out.replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+\/._~=\-]{8,}/g, "$1 " + REDACTED)
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
				if (SECRET_KEYS.test(key)) {
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
exports.log_icalDebug           = logBase;
exports.log_calDavDebug         = logBase;
exports.log_httpClient          = logBase;
exports.log_calDavParsingDebug  = dummy;
