/*jslint regexp: true, node: true, nomen: true, newcap: true */
/*global Contacts, fs, Log, Future, libPath, checkResult */

var path = require("path"); //required for vCard converter.
var Quoting = require(libPath + "Quoting.js");
var vCardReader = require(libPath + "vCardReader.js");
var vCardWriter = require(libPath + "vCardWriter.js");

var vCard = (function () {
	"use strict";
	var tmpPath = "/tmp/caldav-contacts/", //don't forget trailling slash!!
		photoPath = "/media/internal/.caldav_photos/",
		vCardIndex = 0;

	function applyHacks(data, server) {
		if (server === "egroupware") {
			data = data.replace(/TEL;TYPE=CELL,VOICE/g, "TEL;TYPE=CELL");
			data = data.replace(/CELL;VOICE/g, "CELL");
		}

		return data;
	}

	function repairNote(note, data) {
		//webos seems to "forget" the note field.. add it here.
		if (note) {
			note.replace(/[^\r]\n/g, "\r\n");
		}
		note = Quoting.fold(Quoting.quote(note));
		Log.log("Having note:", note);
		return data.replace("END:VCARD", "NOTE:" + note + "\r\nEND:VCARD");
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
				future = new Future(),
				filename = tmpPath + (input.account.name || "nameless") + "_" + vCardIndex + ".vcf",
				vCardImporter,
				version,
				photo,
				uid,
				categories,
				filewritten = false,
				reader = new vCardReader();

			vCardIndex += 1;
			if (!input.vCard) {
				Log.log("Empty vCard received.");
				return new Future({returnValue: false});
			}

			Log.log_icalDebug("vCard data:", input.vCard);

			if (input.vCard.indexOf("VERSION:3.0") > -1) {
				version = "3.0";
			} else if (input.vCard.indexOf("VERSION:2.1") > -1) {
				version = "2.1";
			}

			reader.processString(input.vCard, version);
			photo = reader.extractPhoto();
			uid = reader.extractUID();
			categories = reader.extractCategories();

			//setup importer
			vCardImporter = new Contacts.vCardImporter({
				filePath: filename,
				importToAccountId: input.account.accountId,
				version: version
			});

			if (vCardImporter.setVCardFileReader) {
				vCardImporter.setVCardFileReader(reader);
				future.result = {returnValue: true};
			} else {
				Log.log("Patch not installed => Need to write vCard to file.");
				future.nest(reader.writeToFile(filename));
				filewritten = true;
			}

			//do import:
			future.then(function () {
				var result = checkResult(future);
				if (result.returnValue) {
					future.nest(vCardImporter.readVCard());
				} else {
					resFuture.result = {returnValue: false};
				}
			});

			future.then(function () {
				var result = checkResult(future), obj, key;

				if (filewritten) {
					fs.unlink(filename);
				}

				if (result[0]) { //result[0] is a Contact!
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
					obj.uid = uid;
					obj.categories = categories;

					if (photo.photoData.length > 0) { //got a photo!! :)
						filename = photoPath + (input.account.name || "nameless") + obj.name.givenName + obj.name.familyName + photo.photoType;
						reader.writePhoto(photo, filename).then(function () {
							//storing those here and NOT using ContactsLib to set photos introduces the issue that photos will always stay
							//but I did not manage to show the photo in all places in webos.
							obj.photos.push({localPath: filename, primary: true, type: "type_big"});
							obj.photos.push({localPath: filename, primary: false, type: "type_square"});
							obj.photos.push({localPath: filename, primary: false, type: "type_list"});
							future.result = {returnValue: true, obj: obj};
						});
					} else {
						//no photo, continue.
						future.result = {returnValue: true, obj: obj};
					}
				} else { //no contact, some error must have happend.
					Log.log("No result from conversion: ", result);
					resFuture.result = {returnValue: false, result: {}};
				}
			});

			future.then(function () {
				var result = checkResult(future);
				Log.debug("Result from write photo: ", result);
				resFuture.result = {returnValue: true, result: result.obj};
			});

			return resFuture;
		},

		/**
		 * generates a textual vCard from webOS contact object
		 * @param input webOS contact object
		 * @return future, result.result will contain the text representation uppon success
		 */
		generateVCard: function (input) {
			var resFuture = new Future(),
				future = new Future(),
				filename = tmpPath + (input.accountName || "nameless") + "_" + vCardIndex + ".vcf",
				version = "3.0",
				data,
				contactId = input.contact._id,
				vCardExporter = new Contacts.VCardExporter({
					filePath: filename,
					version: version,
					charset: Contacts.VCard.CHARSET.UTF8,
					useFileCache: false
				}),
				writer = new vCardWriter(),
				filewritten = false,
				contact = new Contacts.Contact(input.contact),
				person = new Contacts.Person();

			Log.log("Got contact: ", input.contact);
			vCardIndex += 1;
			person.populateFromContact(contact);

			if (vCardExporter.setVCardFileWriter) {
				vCardExporter.setVCardFileWriter(writer);
			} else {
				Contacts.Utils.defineConstant("kind", input.kind, Contacts.Person);
				Log.log("Patch not installed => Need to write vCard to file.");
				filewritten = true;
			}

			Log.log("Get contact ", contactId, " transfer it to version ", version, " vCard.");
			future.nest(vCardExporter.exportOne(contactId, false, person));

			future.then(function () {
				Log.log("result: ", checkResult(future));
				if (filewritten) {
					Log.log("webOS saved vCard to ", filename);
					future.nest(writer.readFile(filename));
				} else {
					future.result = {returnValue: true, data: writer.getData()};
				}
			});

			future.then(function () {
				var result = checkResult(future);
				if (result.returnValue) {
					data = result.data;
					data = applyHacks(data, input.server);
					data = data.replace(/\nTYPE=:/g, "\nURL:"); //repair borked up URL thing on webOS 3.X. Omitting type here..

					//repair note if patch was not applied.
					if (filewritten) {
						data = repairNote(input.contact.note, data);
					}

					if (contact.uId) {
						contact.uid = contact.uid || contact.uId;
						delete contact.uId;
					}

					//need to add uId in any case, vCard export can't do that for us, because it works on contacts:
					if (input.contact.uid) {
						data = data.replace("END:VCARD", "UID:" + input.contact.uid + "\r\nEND:VCARD");
					}

					//add categories if contact had them
					if (input.contact.categories) {
						data = data.replace("END:VCARD", "CATEGORIES:" + input.contact.categories + "\r\nEND:VCARD");
					}

					if (input.contact.photos && input.contact.photos.length > 0) {
						future.nest(writer.createPhotoBlob(input.contact.photos));
					} else {
						future.result = { returnValue: true};
					}
				} else {
					resFuture.result = { returnValue: false };
				}
			});

			future.then(function photoBlobCB() {
				var result = checkResult(future);
				if (result.blob) {
					data = data.replace("END:VCARD", result.blob + "END:VCARD");
				}
				Log.debug("Modified data:", data);
				resFuture.result = { returnValue: true, result: data };
			});

			return resFuture;
		}
	}; //end of public interface
}());

module.exports = vCard;
