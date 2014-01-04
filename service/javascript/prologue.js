/*jslint sloppy: true */
/*global IMPORTS, console, require:true, process */
console.error("Starting to load libraries");

//... Load the Foundations library and create
//... short-hand references to some of its components.
var Transport = IMPORTS["mojoservice.transport"];
var Sync = IMPORTS["mojoservice.transport.sync"];
var Foundations = IMPORTS.foundations;
var Contacts = IMPORTS.contacts;
var Calendar = IMPORTS.calendar;
var Globalization = IMPORTS.globalization.Globalization;

var Assert = Foundations.Assert;
var AjaxCall = Foundations.Comms.AjaxCall;
var Class = Foundations.Class;
var DB = Foundations.Data.DB;
var Future = Foundations.Control.Future;
var Activity = Foundations.Control.Activity;
//var ObjectUtils = Foundations.ObjectUtils; //don't know what we need that for..
var PalmCall = Foundations.Comms.PalmCall;
var xml = IMPORTS["foundations.xml"];

//now add some node.js imports:
if (typeof require === "undefined") {
	require = IMPORTS.require;
}
var querystring = require('querystring');
var fs = require('fs'); //required for own node modules and current vCard converter.
var path = require('path'); //required for vCard converter.
var http = require('http'); //required for own httpClient. Not using AjaxCall, because
							//it is broken in 2.2.4 and can't handle custom ports, only 80 and 443
var url = require('url');   //required to parse urls

//node in webos is VERY picky about require paths. Really point it to the library here.
//var servicePath = fs.realpathSync('.');
//require.paths.push(servicePath + '/node_modules/xml2js/lib');
//require.paths.push(servicePath + '/node_modules/xml2js/node_modules/sax/lib'); //required by xml2js
//var xml2js = require('xml2js');

console.error("--------->Loaded Libraries OK1");

var dummy = function () {};

var printObj = function (obj, depth) {
    var key, msg = "{";
    if (depth < 5) {
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                try {
                    msg += " " + key + ": " + JSON.stringify(obj[key]) + ",";
                } catch (e) {
                    msg += " " + key + ": " + printObj(obj[key], depth + 1) + ",";
                }
            }
        }
        msg[msg.length - 1] = "}";
    } else {
        msg = "...";
    }
    return msg;
};

var logBase = function () {
    var i, pos, datum, argsArr = Array.prototype.slice.call(arguments, 0),
        data;

    for (i = 0; i < argsArr.length; i += 1) {
        if (typeof argsArr[i] !== "string") {
            try {
                argsArr[i] = JSON.stringify(argsArr[i]);
            } catch (e) {
                argsArr[i] = printObj(argsArr[i], 0);
            }
        }
    }

    data = argsArr.join(" ");

    // I want ALL my logs!
    data = data.split("\n");
    for (i = 0; i < data.length; i += 1) {
        datum = data[i];
        if (datum.length < 500) {
            console.error(datum);
        } else {
            // Do our own wrapping
            for (pos = 0; pos < datum.length; pos += 500) {
                console.error(datum.slice(pos, pos + 500));
            }
        }
    }
};

var log = logBase;

var log_icalDebug = dummy;

var log_calDavDebug = dummy;

var log_calDavParsingDebug = dummy;

/* Simple debug function to print out to console error, error because other stuff does not show up in sys logs.. */
var debug = logBase;

process.on("uncaughtException", function (e) {
	log("Uncaought error:", e);
	//throw e;
});
