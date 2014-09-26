/*global require, console, global */

var fs = require("fs");

var path = fs.realpathSync(".");
global.servicePath = path + "/../service";
global.Log = require("./../service/javascript/utils/Log.js");
var CalDav = require("./../service/javascript/utils/CalDav.js");
var xml = require("./foundations/xml.js");
var fs = require("fs");

global.Log.setFilename("test-folder-parsing.txt");

fs.readFile("test-folder-parsing-iCloud.xml", function (err, data) {
    "use strict";
    if (err) {
        throw err;
    }

    var parsedBody = xml.xmlstr2json(data.toString("utf-8")),
        folders = CalDav.testFolderParsing(parsedBody);
    console.log("Folders: ", folders);
});
