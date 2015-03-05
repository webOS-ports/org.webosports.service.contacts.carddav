/*global require, console, global, Future */

var fs = require("fs");
var path = fs.realpathSync(".");
global.libPath = path + "/../service/javascript/utils/";
global.checkResult = require("./../service/javascript/utils/checkResult");
global.Log = require("./../service/javascript/utils/Log.js");
global.Future = require("./foundations/Future");
var CalDav = require("./../service/javascript/utils/CalDav.js");

global.Log.setFilename("test-no-ctag-but-etag.txt");

global.httpClient = require("./mock.js").httpClient;
global.httpClient.filename = "test-no-ctag-but-etag.xml";

var future = CalDav.checkForChanges({userAuth: {}, path: "/"});

future.then(function () {
    "use strict";
    console.log("CheckForChanges result: ", future.result);
});
