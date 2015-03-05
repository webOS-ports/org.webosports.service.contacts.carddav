/*global require, console, global, checkResult */

var fs = require("fs");
var path = fs.realpathSync(".");
global.libPath = path + "/../service/javascript/utils/";
global.Log = require("./../service/javascript/utils/Log.js");
global.Future = require("./foundations/Future");
global.checkResult = require("./../service/javascript/utils/checkResult.js");
var mocks = require("./mock.js");
global.httpClient = mocks.httpClient;
global.Class = require("./foundations/class").Class;
global.CalDav = require("./../service/javascript/utils/CalDav.js");
global.Kinds = require("./../service/javascript/kinds.js");

var SyncClient = require("./../service/javascript/assistants/syncassistant.js");
var SyncKey = require("./../service/javascript/utils/SyncKey.js");

global.Log.setFilename("test-empty-ics.txt");

global.httpClient.filename = "test-empty-ics.ics";

var syncClient = new SyncClient();
syncClient.SyncKey = new SyncKey(syncClient.client || {
    transport: {
        syncKey: {
            calendarevent: {
                folderIndex: 0,
                folders: [
                    { name: "folder0" }
                ]
            }
        }
    }
});
syncClient.params = { path: "global/path", userAuth: {}, blacklist: []};

var future = syncClient._downloadData("calendarevent", [{uri: "some-uir", etag: "etag0"}], 0);

future.then(function checkFinish() {
    var result = checkResult(future);
    console.log("Result: ", result);
});
