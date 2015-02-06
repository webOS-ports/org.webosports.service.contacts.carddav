/*exported Transport, Sync, Contacts, Calendar, Globalization, Assert, Class, DB, Future, Activity, PalmCall, Log,
           xml, querystring, fs, CalDav, httpClient, checkResult, SyncAssistant, vCard, Kinds, KindsCalendar, KindsContacts */
/*global IMPORTS, console, require:true, process */
console.error("Starting to load libraries");

//... Load the Foundations library and create
//... short-hand references to some of its components.
var Transport = IMPORTS["mojoservice.transport"];
var Sync = IMPORTS["mojoservice.transport.sync"];
var Foundations = IMPORTS.foundations;
var Contacts = IMPORTS.contacts;
var Calendar = IMPORTS.calendar;
//var Globalization = IMPORTS.globalization.Globalization;

var Class = Foundations.Class;
var DB = Foundations.Data.DB;
var Future = Foundations.Control.Future;
var Activity = Foundations.Control.Activity;
var PalmCall = Foundations.Comms.PalmCall;
var xml = IMPORTS["foundations.xml"];

//now add some node.js imports:
if (typeof require === "undefined") {
	require = IMPORTS.require;
}
var querystring = require("querystring");
var fs = require("fs"); //required for own node modules and current vCard converter.

//node in webos is a bit picky about require paths. Really point it to the library here.
var servicePath = fs.realpathSync(".");
console.log("Service Path: " + servicePath);
var Log = require(servicePath + "/javascript/utils/Log.js");
Log.setFilename("/media/internal/.org.webosports.cdav.service.log");
var CalDav = require(servicePath + "/javascript/utils/CalDav.js");
var nodejsMajorVersion = Number(process.version.match(/^v\d+\.(\d+)/)[1]);
if (nodejsMajorVersion >= 4) {
	var httpClient = require(servicePath + "/javascript/utils/httpClient.js");
} else {
	var httpClient = require(servicePath + "/javascript/utils/httpClient_legacy.js");
}
var checkResult = require(servicePath + "/javascript/utils/checkResult.js");
var KindsModule = require(servicePath + "/javascript/kinds.js");
var Kinds = KindsModule.Kinds;
var KindsCalendar = KindsModule.KindsCalendar;
var KindsContacts = KindsModule.KindsContacts;

//load assistants:
var SyncAssistant = require(servicePath + "/javascript/assistants/syncassistant.js");

console.error("--------->Loaded Libraries OK1");

process.on("uncaughtException", function (e) {
	"use strict";
	Log.log("Uncaought error:" + e.stack);
	//throw e;
});

