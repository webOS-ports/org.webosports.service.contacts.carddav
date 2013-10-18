/*jslint sloppy: true */
/*global IMPORTS, console, require:true */
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
var ObjectUtils = Foundations.ObjectUtils; //don't know what we need that for..
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

var log = function (msg) {
	console.error(msg);
};

/* Simple debug function to print out to console error */
var debug = function (msg) {
	console.error(msg);
};

var createLocks = {};
var lockCreateAssistant = function (accountId) {
	debug("Locking account " + accountId + " for creation.");
	if (createLocks[accountId]) {
		debug("Already locked: " + JSON.stringify(createLocks));
		return false;
	} else {
		createLocks[accountId] = true;
		return true;
	}
};

var getTransportObjByAccountId = function (args) {
	var query = {"from": "org.webosports.service.contacts.carddav.account:1"}, future = new Future();

	if (args.id) {
		future.nest(DB.get([args.id]));
	} else {
		future.nest(DB.find(query, false, false));
	}

	future.then(this, function gotDBObject() {
		var result = future.result, i, obj;
		if (result.returnValue) {
			for (i = 0; i < result.results.length; i += 1) {
				obj = result.results[i];
				if (obj.accountId === args.accountId) {
					future.result = {returnValue: true, account: obj};
					break;
				}
			}
		} else {
			log("Could not get DB object: " + JSON.stringify(result));
			log(JSON.stringify(future.error));
			future.result = {returnValue: false, success: false};
		}
	});
	
	return future;
};