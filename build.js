/*jslint node: true, regexp: true */

var fs = require("fs");
var exec = require("child_process").execSync;


//delete old ipks:
var files = fs.readdirSync(".");
var ipkRegex = /.*\.ipk$/i;

files.forEach(function (file) {
	"use strict";
	if (ipkRegex.test(file)) {
		fs.unlinkSync(file);
	}
});

var result;
var packageVersion = JSON.parse(fs.readFileSync("package/packageinfo.json")).version;
var ipkBaseName = "org.webosports.cdav_" + packageVersion + "_all";

//set right version in log:
fs.writeFileSync("service/javascript/version.js", "var PackageVersion = \""  + packageVersion + "\";");

//copy url schemes  to app dir:
var contents = fs.readFileSync("service/javascript/urlschemes.js");
fs.writeFileSync("app/app/models/urlschemes.js", contents);
fs.writeFileSync("app-enyo/CrossAppTarget/urlschemes.js", contents);

fs.renameSync("service/javascript/kinds.js", "service/javascript/kinds_no_upsync.js");
fs.renameSync("service/javascript/kinds_upsync.js", "service/javascript/kinds.js");

try {
	//mojo upsync
	result = exec("palm-package app service accounts accounts-google-mojo accounts-icloud accounts-yahoo package");
	console.log(result.toString("utf8"));
	fs.renameSync(ipkBaseName + ".ipk", ipkBaseName + "_upsync.ipk");

	//eyno upsync
	result = exec("palm-package app-enyo service accounts-enyo accounts-google accounts-icloud accounts-yahoo package");
	console.log(result.toString("utf8"));
	fs.renameSync(ipkBaseName + ".ipk", ipkBaseName + "_enyo_upsync.ipk");

} catch (e) {
	console.log("Building of upsync versions failed: ", e);
}

fs.renameSync("service/javascript/kinds.js", "service/javascript/kinds_upsync.js");
fs.renameSync("service/javascript/kinds_no_upsync.js", "service/javascript/kinds.js");

//mojo no upsync
result = exec("palm-package app service accounts accounts-google-mojo accounts-icloud accounts-yahoo package");
console.log(result.toString("utf8"));
fs.renameSync(ipkBaseName + ".ipk", ipkBaseName + "_no_upsync.ipk");

//eyno no upsync
result = exec("palm-package app-enyo service accounts-enyo accounts-google accounts-icloud accounts-yahoo package");
console.log(result.toString("utf8"));
fs.renameSync(ipkBaseName + ".ipk", ipkBaseName + "_enyo_no_upsync.ipk");

//remove urlschemes from app dir:
fs.unlinkSync("app/app/models/urlschemes.js");
fs.unlinkSync("app-enyo/CrossAppTarget/urlschemes.js");

if (process.argv.length > 2) {
	console.log("Installing...");
	var param = 2, ipk = ipkBaseName + "_upsync.ipk";
	if (process.argv[param] === "enyo") {
		ipk = ipkBaseName + "_enyo_upsync.ipk";
		param += 1;
	}
	result = exec("palm-install " + ipk);
	console.log(result.toString("utf8"));
}
