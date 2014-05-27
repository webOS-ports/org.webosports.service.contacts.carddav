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


//node in webos is a bit picky about require paths. Really point it to the library here.
var servicePath = fs.realpathSync('.');
console.log("Service Path: " + servicePath);
var Log = require(servicePath + "/javascript/utils/Log.js");
var CalDav = require(servicePath + "/javascript/utils/CalDav.js");
var httpClient = require(servicePath + "/javascript/utils/httpClient_legacy.js");

console.error("--------->Loaded Libraries OK1");

process.on("uncaughtException", function (e) {
    Log.log("Uncaought error:" + e.stack);
    //throw e;
});

