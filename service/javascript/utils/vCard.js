//JSLint stuff:
/*jslint sloppy: true, nomen: true, regexp: true */
/*global Contacts, fs, log, Future, path, MimeTypes, quoted_printable_decode, quoted_printable_encode, quote, Base64, Buffer */

var vCard = (function () {
	var tmpPath = "/tmp/caldav-contacts/", //don't forget trailling slash!!
		photoPath = "/media/internal/.caldav_photos/",
		vCardIndex = 0;

	function cleanUpEmptyFields(obj) {
		var field;
		if (typeof obj === "object") {
			for (field in obj) {
				if (obj.hasOwnProperty(field)) {
					if (typeof obj[field] === "string") {
						if (obj[field] === "") {
							delete obj[field];
						}
					} else if (typeof obj[field] === "object") {
						cleanUpEmptyFields(obj[field]);
					}
				}
			}
		}
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
		initialize: function () {
			var photo = false, tmp = false, future = new Future(), finished = function () {
				if (tmp && photo) {
					var res = future.result;
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
					fs.mkdir(tmpPath, 0777, function (error) {
						if (error) {
							log("Could not create tmp-path, error: " + JSON.stringify(error));
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
					fs.mkdir(photoPath, 0777, function (error) {
						if (error) {
							log("Could not create photo-path, error: " + JSON.stringify(error));
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

		//parameters:
		//vcard = text representation of vcard
		//account = full account object.
		//serverData = configuration data of the server..
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
				log("Empty vCard received.");
				return new Future({returnValue: false});
			}

			log("Writing vCard to file " + filename);
			log_icalDebug("vCard data: " + input.vCard);

			if (input.vCard.indexOf("VERSION:3.0") > -1) {
				version = "3.0";
			} else if (input.vCard.indexOf("VERSION:2.1") > -1) {
				version = "2.1";
				input.vCard = input.vCard.replace(/\=\r?\n/g, ''); //replace all =\n, those are newlines in datablocks
			}

			input.vCard = input.vCard.replace(/\r?\n /g, ''); //replace all \n+space, those are newlines in datablocks
			lines = input.vCard.split(/\r?\n/);
			data = [];
			for (i = 0; i < lines.length; i += 1) {
				currentLine = lines[i];
				//log("CurrentLine: " + currentLine);
				//check for start of photo mode
				if (currentLine.indexOf("PHOTO") > -1) {
					log("got photo...");
					photoData = currentLine.substring(currentLine.indexOf(":") + 1);

					photoType = extractPhotoType(currentLine);

					//log("PhotoData: " + photoData);
				} else if (!emptyLine.test(currentLine)) {
					if (version === "2.1") {
						//log("Decode, because version " + version);
						currentLine = quoted_printable_decode(currentLine);
						currentLine = currentLine.replace(/\r?\n=?/g, '\\n');
					}
					//currentLine = unquote(currentLine);
					data.push(currentLine);
				} else {
					log_icalDebug("Skipping empty line " + currentLine);
				}
			}
			input.vCard = data.join("\r\n");
			log_icalDebug("vCard data cleaned up: " + input.vCard);
			fs.writeFile(filename, input.vCard, "utf-8", function (err) {
				if (err) {
					log("Could not write vCard to file: " + filename + " Error: " + JSON.stringify(err));
				} else {
					log("Saved vCard to " + filename);
					//setup importer
					vCardImporter = new Contacts.vCardImporter({filePath: filename, importToAccountId: input.account.accountId, version: version});
					//do import:
					var future = vCardImporter.readVCard();
					future.then(function (f) {
						if (f.result[0]) {
							var obj = f.result[0].getDBObject(), key, buff;
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

							log("Contact: " + JSON.stringify(obj));
							//cleanUpEmptyFields(obj);
							//log("Contact after cleanup: " + JSON.stringify(obj));
							fs.unlink(filename);

							log("PhotoData Length: " + photoData.length);
							if (photoData.length > 0) { //got a photo!! :)
								log("Writing photo!");
								buff = new Buffer(photoData, 'base64');
								filename = photoPath + (input.account.name || "nameless") + obj.name.givenName + obj.name.familyName + photoType;
								log("writing photo to: " + filename);
								fs.writeFile(filename, buff, function (err) {
									if (err) {
										log("Could not write photo to file: " + filename + " Error: " + JSON.stringify(err));
									}
								});
								obj.photos.push({localPath: filename, primary: false, type: "type_big"});
								obj.photos.push({localPath: filename, primary: false, type: "type_square"});
							}

							resFuture.result = {returnValue: true, result: obj};
						} else {
							log("No result from conversion: ", f.result);
							fs.unlink(filename);
							resFuture.result = {returnValue: false, result: {}};
						}
					});
				}
			});

			return resFuture;
		},

		//input:
		//contactId
		generateVCard: function (input) {
			var resFuture = new Future(), note,
				filename = tmpPath + (input.accountName || "nameless") + "_" + vCardIndex + ".vcf",
				version = "3.0",
				contactId = input.contact._id,
				vCardExporter = new Contacts.VCardExporter({ filePath: filename, version: version });

			vCardIndex += 1;

			log("Got contact: " + JSON.stringify(input.contact));
			Contacts.Utils.defineConstant("kind", input.kind, Contacts.Person);
			log("Get contact " + contactId + " transfer it to version " + version + " vCard.");
			vCardExporter.exportOne(contactId, false).then(function (future) {
				log("webOS saved vCard to " + filename);
				log("result: " + JSON.stringify(future.result));
				fs.readFile(filename, "utf-8", function (err, data) {
					if (err) {
						log("Could not read back vCard from " + filename + ": " + JSON.stringify(err));
						resFuture.result = { returnValue: false };
					} else {
						log("Read vCard from " + filename + ": " + data);

						data = applyHacks(data, input.server);
						data = data.replace(/\nTYPE=:/g, "URL:"); //repair borked up URL thing on webOS 3.X. Omitting type here..

						//webos seems to "forget" the note field.. add it here.
						if (input.contact && input.contact.note) {
							note = input.contact.note;
							if (note) {
								note.replace(/[^\r]\n/g, "\r\n");
							}
							note = quote(note);
							log("Having note: " + note);
							data = data.replace("END:VCARD", "NOTE:" + note + "\r\nEND:VCARD");
						}

						if (input.contact && input.contact.uId) {
							data = data.replace("END:VCARD", "UID:" + input.contact.uId + "\r\nEND:VCARD");
						}

						log("Modified data: " + data);
						resFuture.result = { returnValue: true, result: data };
					}
					fs.unlink(filename);
				});
			});

			return resFuture;
		},

		cleanUp: function (account) {
			var future = new Future();
			log("Contact cleanup called for " + tmpPath);
			fs.readdir(tmpPath, function (err, files) {
				var i, name = (account.name || "nameless") + "_", filename;
				for (i = 0; i < files.length; i += 1) {
					filename = files[i];
					log("Filename: " + filename);
					if (filename.indexOf(name) === 0) {
						log("Deleting " + filename);
						fs.unlink(tmpPath + filename);
					} else {
						log("Not deleting file " + filename + " in temp path. Match results: " + filename.indexOf(name));
					}
				}
				future.result = { returnValue: true };
			});
			log("Returninig future");
			return future;
		}
	}; //end of public interface
}());
