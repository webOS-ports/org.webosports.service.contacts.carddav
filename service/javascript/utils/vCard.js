/*jslint regexp: true */
/*global Contacts, fs, Log, Future, servicePath, Buffer, checkResult */

var path = require("path"); //required for vCard converter.
var Quoting = require(servicePath + "/javascript/utils/Quoting.js");

var vCard = (function () {
    "use strict";
    var tmpPath = "/tmp/caldav-contacts/", //don't forget trailling slash!!
        photoPath = "/media/internal/.caldav_photos/",
        vCardIndex = 0;

    function extractPhotoType(line) {
        var startIndex, endIndex, endIndex2, type;

        startIndex = line.indexOf("TYPE=");
        if (startIndex >= 0) {
            startIndex += 5;
            Log.log_icalDebug("StartIndex:", startIndex);

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
            type = ".jpg";
        }
        Log.log_icalDebug("Read Photo Type:", type, "from", startIndex);
        return type;
    }

    function createPhotoBlob(photos) {
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
    }

    function applyHacks(data, server) {
        if (server === "egroupware") {
            data = data.replace(/TEL;TYPE=CELL,VOICE/g, "TEL;TYPE=CELL");
            data = data.replace(/CELL;VOICE/g, "CELL");
        }

        return data;
    }

    //public interface:
    return {
        /**
         * Required for initialisation of vCard parser. Will basically create
         * a temporary directory in /tmp
         * @return future wait for future result to be sure that this is ready.
         */
        initialize: function () {
            var photo = false, tmp = false, future = new Future(), finished = function () {
                if (tmp && photo) {
                    var res = checkResult(future);
                    if (!res) {
                        res = {};
                    }
                    res.vCard = true;
                    future.result = res;
                }
            };

            //check that a temporary file path exists to save/read vcards to.
            path.exists(tmpPath, function (exists) {
                if (!exists) {
                    fs.mkdir(tmpPath, parseInt("777", 8), function (error) {
                        if (error) {
                            Log.log("Could not create tmp-path, error:", error);
                        }
                        tmp = true;
                        finished();
                    });
                } else {
                    tmp = true;
                    finished();
                }
            });

            //create path for photos:
            path.exists(photoPath, function (exists) {
                if (!exists) {
                    fs.mkdir(photoPath, parseInt("777", 8), function (error) {
                        if (error) {
                            Log.log("Could not create photo-path, error:", error);
                        }
                        photo = true;
                        finished();
                    });
                } else {
                    photo = true;
                    finished();
                }
            });

            return future;
        },

        /**
         * parses a vcard into a webOS data object.
         * @param input text representation of vcard
         * @return future, result.result will contain the object uppon success.
         */
        parseVCard: function (input) {
            var resFuture = new Future(),
                filename = tmpPath + (input.account.name || "nameless") + "_" + vCardIndex + ".vcf",
                vCardImporter,
                currentLine,
                lines,
                data,
                i,
                version,
                photoData = "",
                emptyLine = /^[A-Za-z;\-_]*:[;]*$/,
                //for extracting photo type.
                photoType;

            vCardIndex += 1;

            if (!input.vCard) {
                Log.log("Empty vCard received.");
                return new Future({returnValue: false});
            }

            Log.log("Writing vCard to file", filename);
            Log.log_icalDebug("vCard data:", input.vCard);

            if (input.vCard.indexOf("VERSION:3.0") > -1) {
                version = "3.0";
            } else if (input.vCard.indexOf("VERSION:2.1") > -1) {
                version = "2.1";
                input.vCard = input.vCard.replace(/\=\r?\n/g, ""); //replace all =\n, those are newlines in datablocks
            }

            input.vCard = input.vCard.replace(/\r?\n /g, ""); //replace all \n+space, those are newlines in datablocks
            lines = input.vCard.split(/\r?\n/);
            data = [];
            for (i = 0; i < lines.length; i += 1) {
                currentLine = lines[i];
                //log("CurrentLine: " + currentLine);
                //check for start of photo mode
                if (currentLine.indexOf("PHOTO") > -1) {
                    Log.log("got photo...");
                    photoData = currentLine.substring(currentLine.indexOf(":") + 1);

                    photoType = extractPhotoType(currentLine);

                    //log("PhotoData: " + photoData);
                } else if (!emptyLine.test(currentLine)) {
                    data.push(currentLine);
                } else {
                    Log.log_icalDebug("Skipping empty line", currentLine);
                }
            }
            input.vCard = data.join("\r\n");
            Log.log_icalDebug("vCard data cleaned up:", input.vCard);
            fs.writeFile(filename, input.vCard, "utf-8", function (err) {
                if (err) {
                    Log.log("Could not write vCard to file:", filename, "Error:", err);
                } else {
                    Log.log("Saved vCard to", filename);
                    //setup importer
                    vCardImporter = new Contacts.vCardImporter({filePath: filename, importToAccountId: input.account.accountId, version: version});
                    //do import:
                    var future = vCardImporter.readVCard();
                    future.then(function (f) {
                        var result = checkResult(f), obj, key, buff;
                        if (result[0]) {
                            obj = result[0].getDBObject();
                            obj._kind = input.account.kind;

                            //prevent overriding of necessary stuff.
                            for (key in obj) {
                                if (obj.hasOwnProperty(key)) {
                                    if (obj[key] === undefined || obj[key] === null) {
                                        //log("Deleting entry " + key + " from obj.");
                                        delete obj[key];
                                    }
                                }
                            }
                            delete obj.accounts;
                            delete obj.accountId;
                            delete obj.syncSource;

                            Log.log("Contact:", obj);
                            fs.unlink(filename);

                            Log.log("PhotoData Length:", photoData.length);
                            if (photoData.length > 0) { //got a photo!! :)
                                Log.log("Writing photo!");
                                buff = new Buffer(photoData, "base64");
                                filename = photoPath + (input.account.name || "nameless") + obj.name.givenName + obj.name.familyName + photoType;
                                Log.log("writing photo to:", filename);
                                fs.writeFile(filename, buff, function (err) {
                                    if (err) {
                                        Log.log("Could not write photo to file:", filename, "Error:", err);
                                    }
                                });
                                obj.photos.push({localPath: filename, primary: false, type: "type_big"});
                                obj.photos.push({localPath: filename, primary: false, type: "type_square"});
                            }

                            resFuture.result = {returnValue: true, result: obj};
                        } else {
                            Log.log("No result from conversion: ", result);
                            fs.unlink(filename);
                            resFuture.result = {returnValue: false, result: {}};
                        }
                    });
                }
            });

            return resFuture;
        },

        /**
         * generates a textual vCard from webOS contact object
         * @param input webOS contact object
         * @return future, result.result will contain the text representation uppon success
         */
        generateVCard: function (input) {
            var resFuture = new Future(), note,
                filename = tmpPath + (input.accountName || "nameless") + "_" + vCardIndex + ".vcf",
                version = "3.0",
                contactId = input.contact._id,
                vCardExporter = new Contacts.VCardExporter({ filePath: filename, version: version });

            vCardIndex += 1;

            Log.log("Got contact:", input.contact);
            Contacts.Utils.defineConstant("kind", input.kind, Contacts.Person);
            Log.log("Get contact", contactId, "transfer it to version", version, "vCard.");
            vCardExporter.exportOne(contactId, false).then(function (future) {
                Log.log("webOS saved vCard to ", filename);
                Log.log("result: ", checkResult(future));
                fs.readFile(filename, "utf-8", function (err, data) {
                    if (err) {
                        Log.log("Could not read back vCard from", filename, ":", err);
                        resFuture.result = { returnValue: false };
                    } else {
                        Log.log("Read vCard from " + filename + ": " + data);

                        data = applyHacks(data, input.server);
                        data = data.replace(/\nTYPE=:/g, "\nURL:"); //repair borked up URL thing on webOS 3.X. Omitting type here..

                        //webos seems to "forget" the note field.. add it here.
                        if (input.contact && input.contact.note) {
                            note = input.contact.note;
                            if (note) {
                                note.replace(/[^\r]\n/g, "\r\n");
                            }
                            note = Quoting.fold(Quoting.quote(note));
                            Log.log("Having note:", note);
                            data = data.replace("END:VCARD", "NOTE:" + note + "\r\nEND:VCARD");
                        }

                        if (input.contact && input.contact.uId) {
                            data = data.replace("END:VCARD", "UID:" + input.contact.uId + "\r\nEND:VCARD");
                        }

                        if (input.contact && input.contact.photos && input.contact.photos.length > 0) {
                            createPhotoBlob(input.contact.photos).then(this, function photoBlobCB(f) {
                                var result = checkResult(f);
                                data = data.replace("END:VCARD", result.blob + "END:VCARD");
                                resFuture.result = { returnValue: true, result: data};
                            });
                        } else {
                            Log.log("Modified data:", data);
                            resFuture.result = { returnValue: true, result: data };
                        }
                    }
                    fs.unlink(filename);
                });
            });

            return resFuture;
        }
    }; //end of public interface
}());

module.exports = vCard;
