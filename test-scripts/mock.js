/*global Future */
/*jshint node: true */

var fs = require("fs");
var xml = require("./foundations/xml.js");

exports.httpClient = {
    filename: "",

    sendRequest: function (options, data) {
        "use strict";
        var future = new Future();

        fs.readFile(this.filename, function (err, data) {
            var strData = data.toString("utf-8");
            if (err) {
                throw err;
            }

            var parsedBody = xml.xmlstr2json(strData);

            future.result = {returnValue: true, parsedBody: parsedBody, body: strData};
        });

        return future;
    },

    parseURLIntoOptions: function (inUrl, options) {
        "use strict";
    },

    setIgnoreSSLCertificateErrorsForHost: function (inUrl, value) {
        "use strict";
    }
};

global.Calendar = {
    TimezoneManager: function () {
        "use strict";
        return {};
    }
};

var Class = require("./foundations/class").Class;
global.Sync = {
    SyncCommand: Class.create({
        initialize: function () { "use strict"; }
    })
};
