/*global global, require, Log, Future */

var fs = require("fs");
var path = fs.realpathSync(".");
global.libPath = path + "/../service/javascript/utils/";
global.Log = require("./../service/javascript/utils/Log.js");
global.xml = require("./foundations/xml.js");
global.CalDav = require("./../service/javascript/utils/CalDav.js");
global.httpClient = require("./../service/javascript/utils/httpClient.js");
global.Future = require("./foundations/Future");
var AuthManager = require("./../service/javascript/utils/AuthManager.js");
global.checkResult = require("./../service/javascript/utils/checkResult.js");
global.UrlSchemes = {
    resolveURL: function () {
        "use strict";
        return false;
    }
};


var userAuth = {
    user: "test",
    password: "caldav"
};

var url = "http://192.168.0.2/webdav/";

var params = { userAuth: userAuth, path: url, cardDav: true };

var future = new Future();

future.nest(AuthManager.checkAuth(userAuth, url));

future.then(function checkCB() {
    "use strict";
    var result = future.result;
    Log.log("Result: ", result);

    future.nest(global.CalDav.downloadObject(params, {uri: "/webdav/blub.txt"}));
});

future.then(function checkCB() {
    "use strict";
    var result = future.result;
    Log.log("Result-Get: ", result);

    future.nest(global.CalDav.downloadEtags(params));
});

future.then(function checkCB() {
    var result = future.result;
    Log.log("Etags-Get: ", result);
});
