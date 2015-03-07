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

var printObj = function (obj, depth) {
	"use strict";
	var key, msg = "{";
	if (depth < 5) {
		for (key in obj) {
			if (obj.hasOwnProperty(key)) {
				try {
					msg += " " + key + ": " + JSON.stringify(obj[key]) + ",";
				} catch (e) {
					msg += " " + key + ": " + printObj(obj[key], depth + 1) + ",";
				}
			}
		}
		msg[msg.length - 1] = "}";
	} else {
		msg = "...";
	}
	return msg;
};

var logBase = function () {
	"use strict";
	var i, pos, datum, argsArr = Array.prototype.slice.call(arguments, 0),
		data;

	for (i = 0; i < argsArr.length; i += 1) {
		if (typeof argsArr[i] !== "string") {
			try {
				argsArr[i] = JSON.stringify(argsArr[i]);
			} catch (e) {
				argsArr[i] = printObj(argsArr[i], 0);
			}
		}
	}

	data = argsArr.join("");
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
