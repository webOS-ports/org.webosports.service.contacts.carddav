/*jslint node: true */
/*global Future, fs, Log */

var vCardReader = function () {
	"use strict";
	var lines = [],
		index = 0;

	function extractPhotoType(line) {
		var startIndex, endIndex, endIndex2, type;

		startIndex = line.indexOf("TYPE=");
		if (startIndex >= 0) {
			startIndex += 5;
			endIndex = line.indexOf(";", startIndex);
			endIndex2 = line.indexOf(":", startIndex);

			if (endIndex > 0 && endIndex2 > 0) {
				endIndex = Math.min(endIndex, endIndex2);
			} else if (endIndex2 > 0) {
				endIndex = endIndex2;
			}
			type = line.substring(startIndex, endIndex);
		}

		if (type) {
			type = "." + type.toLowerCase();
		} else {
			type = ".jpeg";
		}
		return type;
	}

	//The value of a line for a property, which may carry a group ("item1.TEL"), in any case.
	function propertyPattern(field) {
		return new RegExp("^(?:[A-Za-z0-9\\-]+\\.)?" + field + "(?=[;:])", "i");
	}

	//The colon that ends the parameters, those can hold quoted colons.
	function valueStart(line) {
		var i, quoted = false;
		for (i = 0; i < line.length; i += 1) {
			if (line[i] === '"') {
				quoted = !quoted;
			} else if (line[i] === ":" && !quoted) {
				return i + 1;
			}
		}
		return line.length;
	}

	function extractField(field) {
		var i, pattern = propertyPattern(field);
		for (i = 0; i < lines.length; i += 1) {
			if (pattern.test(lines[i])) {
				return lines[i].substring(valueStart(lines[i]));
			}
		}
	}

	//yyyy-mm-dd from the forms of RFC 2426 section 3.1.5 and RFC 6350 section 4.3. webOS has no
	//date without a year, 1900 stands in for it.
	function normalizeDate(value) {
		var parts = (/^(\d{4}|--)-?(\d\d)-?(\d\d)/).exec(value || "");
		if (!parts) {
			return undefined;
		}
		return (parts[1] === "--" ? "1900" : parts[1]) + "-" + parts[2] + "-" + parts[3];
	}

	function normalizeLine(line) {
		var start, date;
		if (propertyPattern("TEL").test(line)) {
			start = valueStart(line);
			return line.substring(0, start) + line.substring(start).replace(/^tel:/i, "").replace(/;ext=/i, " x");
		}
		if (propertyPattern("BDAY").test(line)) {
			start = valueStart(line);
			date = normalizeDate(line.substring(start));
			return date ? line.substring(0, start) + date : line;
		}
		return line;
	}

	return {
		processString: function (string, version) {
			if (version === "2.1") {
				string = string.replace(/\=\r?\n/g, ""); //replace all =\n, those are newlines in datablocks
			}

			string = string.replace(/\r?\n[ \t]/g, ""); //a line break before space or tab folds a line.
			lines = string.split(/\r?\n/);
			index = 0;

			//remove empty lines from vCard.
			var i, emptyLine = /^[A-Za-z;\-_]*:[;]*$/;
			for (i = lines.length - 1; i >= 0; i -= 1) {
				if (emptyLine.test(lines[i])) {
					lines.splice(i, 1);
				} else {
					lines[i] = normalizeLine(lines[i]);
				}
			}
		},

		extractPhoto: function () {
			var i = 0,
				pattern = propertyPattern("PHOTO"),
				value,
				dataUri,
				photo = {
					photoData: "",
					photoType: "none"
				};

			for (i = 0; i < lines.length; i += 1) {
				if (pattern.test(lines[i])) {
					value = lines[i].substring(valueStart(lines[i]));
					photo.photoType = extractPhotoType(lines[i]);
					dataUri = (/^data:image\/([a-z0-9.+\-]+)(?:;[^,]*)?;base64,(.*)$/i).exec(value);

					if (dataUri) { //how vCard 4 embeds a picture.
						photo.photoData = dataUri[2];
						photo.photoType = "." + dataUri[1].toLowerCase().replace("jpg", "jpeg");
					} else if ((/^https?:\/\//i).test(value)) {
						photo.photoUrl = value;
					} else if (!(/^[a-z][a-z0-9+.\-]*:/i).test(value)) {
						photo.photoData = value;
					}

					//remove line from vCard.
					lines.splice(i, 1);
					break;
				}
			}

			return photo;
		},

		extractUID: function () {
			return extractField("UID");
		},

		extractFullName: function () {
			return extractField("FN");
		},

		extractAnniversary: function () {
			return normalizeDate(extractField("ANNIVERSARY") || extractField("X-ANNIVERSARY"));
		},

		extractCategories: function () {
			return extractField("CATEGORIES");
		},

		readLine: function () {
			var line = lines[index] || "";
			index += 1;
			if (index >= lines.length) {
				return null;
			} else {
				return line;
			}
		},

		peek: function () {
			var line = lines[index] || "";
			if (index >= lines.length) {
				return null;
			} else {
				return line;
			}
		},

		writeToFile: function (filename) {
			var future = new Future();

			fs.writeFile(filename, lines.join("\r\n"), function (err) {
				if (err) {
					Log.log("Could not write vCard to file: ", filename, " Error: ", err);
				}
				future.result = {returnValue: !err};
			});

			return future;
		},

		writePhoto: function (photo, filename) {
			var future = new Future(),
				buff = photo.buffer || new Buffer(photo.photoData, "base64");

			Log.debug("writing photo to:", filename);
			fs.writeFile(filename, buff, function (err) {
				if (err) {
					Log.log("Could not write photo to file: ", filename, " Error: ", err);
				}
				future.result = {returnValue: !err};
			});

			return future;
		}
	};
};

module.exports = vCardReader;
