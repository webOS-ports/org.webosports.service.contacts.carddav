/*global global, require */

var fs = require("fs");

var path = fs.realpathSync(".");
global.servicePath = path + "/../service";


global.Log = require('./../service/javascript/utils/Log.js');
var httpClient = require('./../service/javascript/utils/httpClient.js');
var CalDav = require("./../service/javascript/utils/CalDav.js");

global.Future = require("./foundations/Future");
global.checkResult = require("./../service/javascript/utils/checkResult.js");

var options = {
    method: "GET",
    headers: {
        Prefer: "return-minimal", //don't really know why that is.
        "Content-Type": "text/xml; charset=utf-8", //necessary
        Connection: "keep-alive",
        Authorization: "blub",
        "User-Agent": "org.webosports.cdav-connector"
    }
};
httpClient.parseURLIntoOptions("https://www.google.de/", options);

options.headers.Depth = 0;
options.method = "GET";
var data = "<d:propfind xmlns:d=\"DAV:\"><d:prop><d:current-user-principal /></d:prop></d:propfind>";


var future = httpClient.sendRequest(options, data);
