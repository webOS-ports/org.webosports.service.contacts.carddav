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

    function extractField(field) {
        var i;
        for (i = 0; i < lines.length; i += 1) {
            if (lines[i].indexOf(field) === 0) {
                return lines[i].substring(lines[i].indexOf(":") + 1);
            }
        }
    }

    return {
        processString: function (string, version) {
            if (version === "2.1") {
                string = string.replace(/\=\r?\n/g, ""); //replace all =\n, those are newlines in datablocks
            }

            string = string.replace(/\r?\n /g, ""); //replace all \n+space, those are newlines in datablocks
            lines = string.split(/\r?\n/);
            index = 0;

            //remove empty lines from vCard.
            var i, emptyLine = /^[A-Za-z;\-_]*:[;]*$/;
            for (i = lines.length - 1; i >= 0; i -= 1) {
                if (emptyLine.test(lines[i])) {
                    lines.splice(i, 1);
                }
            }
        },

        extractPhoto: function () {
            var i = 0,
                photo = {
                    photoData: "",
                    photoType: "none"
                };

            for (i = 0; i < lines.length; i += 1) {
                if (lines[i].indexOf("PHOTO") === 0) {
                    //add value of current line to photodata.
                    photo.photoData = lines[i].substring(lines[i].indexOf(":") + 1);

                    //get photoType
                    photo.photoType = extractPhotoType(lines[i]);

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
                buff = new Buffer(photo.photoData, "base64");

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
