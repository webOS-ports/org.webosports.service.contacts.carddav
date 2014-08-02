/*global Future, fs, Log, servicePath */

var Quoting = require(servicePath + "/javascript/utils/Quoting.js");

var vCardWriter = function () {
    "use strict";
    var lines = [],
        closed = false;

    return {
        //not really necessary for us...
        getSize: function () {
            return lines.join("\r\n").length;
        },

        getData: function () {
            return lines.join("\r\n");
        },

        //reset file content.
        open: function () {
            lines = [];
            closed = false;
        },

        close: function () {
            closed = true;
            return true;
        },

        writeLine: function (line) {
            if (!closed) {
                lines.push(line);
            }
        },

        createPhotoBlob: function (photos) {
            var future = new Future(), blob = "", photo, i, photoType;
            Log.log_icalDebug("Creating photo blob...");

            for (i = 0; i < photos.length; i += 1) {
                //Select smaller photo?
                if (photos[i].type === "type_square") {
                    photo = photos[i];
                    break;
                }
            }
            if (!photo) { //if no "square" photo, just take first one.
                photo = photos[0];
            }

            Log.log_icalDebug("Photo:", photo);
            //if we got a photo, build blob.
            if (photo) {
                photoType = photo.localPath.substring(photo.localPath.indexOf(".") + 1);
                photoType = photoType.toUpperCase();

                fs.readFile(photo.localPath, function (err, data) {
                    if (err) {
                        Log.log("Could not read file", photo.localPath, ":", err);
                        future.result = {blob: ""};
                    } else {
                        Log.log_icalDebug("Photo read...");
                        blob = "PHOTO;ENCODING=b;TYPE=" + photoType + ":" + data.toString("base64");
                        blob = Quoting.fold(blob) + "\r\n";
                        Log.log_icalDebug("Blob: \n", blob);

                        future.result = {blob: blob};
                    }
                });

            } else {
                Log.log_icalDebug("Urgs...??");
                future.result = {blob: blob};
            }

            return future;
        },

        readFile: function (filename) {
            var future = new Future();
            fs.readFile(filename, "utf-8", function (err, data) {
                if (err) {
                    Log.log("Could not read back vCard from ", filename, ": ", err);
                } else {
                    Log.log("Read vCard from " + filename + ": " + data);
                }

                future.result = {returnValue: !err, data: data};
                fs.unlink(filename);
            });

            return future;
        }
    };
};

module.exports = vCardWriter;
