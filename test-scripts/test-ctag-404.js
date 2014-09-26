/*global require, console, global, Future */

var fs = require("fs");

var path = fs.realpathSync(".");
global.servicePath = path + "/../service";
global.checkResult = require("./../service/javascript/utils/checkResult");
global.Log = require("./../service/javascript/utils/Log.js");
global.Future = require("./../service/javascript/Future");
var CalDav = require("./../service/javascript/utils/CalDav.js");
var xml = require("./xml.js");

global.Log.setFilename("test-ctag-404.txt");

global.httpClient = {
    sendRequest: function () {
        var future = new Future();

        fs.readFile("test-ctag-404.xml", function (err, data) {
            "use strict";
            if (err) {
                throw err;
            }

            var parsedBody = xml.xmlstr2json(data.toString("utf-8"));

            future.result = {returnValue: true, parsedBody: parsedBody};
        });

        return future;
    },

    parseURLIntoOptions: function () {}
};

var future = CalDav.checkForChanges({userAuth: {}, path: "/"});

future.then(function () {
    console.log("CheckForChanges result: ", future.result);
});
