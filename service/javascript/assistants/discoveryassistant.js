/*jslint nomen: true */
/*global Future, Log, Kinds, DB, CalDav, UrlSchemes, checkResult */
/*exported DiscoveryAssistant */

var DiscoveryAssistant = function () { "use strict"; };

//call with accountId (required), username, name, url.
//accountId, name and username will be used to search for config object.
//url will be updated in DB. If no object in DB, yet, URL is required.
DiscoveryAssistant.prototype.run = function (outerFuture) {
	"use strict";
	var future = new Future(), args = this.controller.args;

	if (this.client && this.client.config) {
		if (!this.client.config.username) {
			this.client.config.username = this.client.userAuth.user;
		}
		future.nest(this.processAccount(args, this.client.config));
	} else {
		Log.log("No config object was found by serviceAssistant! Trying to create new one with command line arguments.");
		future.nest(this.processAccount(args, {
			_kind: Kinds.accountConfig.id,
			accountId: args.accountId
		}));
	}

	future.then(this, function discoveryFinished() {
		var result = checkResult(future);
		Log.log("Discovery finished.");
		outerFuture.result = result;
	});
	return outerFuture;
};

DiscoveryAssistant.prototype.resolveHome = function (params, username, type, urlSchemeKey) {
	"use strict";
	var future = new Future(), home;

	home = UrlSchemes.resolveURL(params.originalUrl, username, type, urlSchemeKey);
	if (home) {
		Log.log("Could resolve ", type, " home from known URL schemes, get folders from there");
		params.path = home;
		future.nest(CalDav.getFolders(params, type));

		future.then(this, function foldersCB() {
			var result = checkResult(future);
			if (result.returnValue === true) {
				if (result.folders && result.folders.length > 0) {
					Log.log("Got ", type, " folders from known home.");
					future.result = { returnValue: true, home: home };
				} else {
					Log.log("No ", type, " folders from known home, trying usual discovery.");
					future.result = { returnValue: false };
				}
			} else {
				future.result = { returnValue: false };
			}
		});
	} else {
		Log.log("Could not resolve ", type, " home from known URL schemes.");
		future.result = { returnValue: false };
	}

	return future;
};

DiscoveryAssistant.prototype.processAccount = function (args, config) {
	"use strict";
	var future = new Future(), outerFuture = new Future(), params, calendarHome, contactHome, key, additionalConfig;

	if (config) {
		Log.debug("Got config object: ", config);

		if (args.accountId) {
			config.accountId = args.accountId;
		}
		if (args.username) {
			config.username = args.username;
		}
		if (args.name) {
			config.name = args.name;
		}
		if (args.url) {
			config.url = args.url;
		}
		if (args.urlScheme) {
			config.urlScheme = args.urlScheme;
		}

		//if have urlScheme that does not need url, no usefull url is stored in db. So use checkCredentials url as home here.
		if (config.urlScheme && UrlSchemes.urlSchemes[config.urlScheme] && !UrlSchemes.urlSchemes[config.urlScheme].needPrefix && !args.url) {
			config.url = UrlSchemes.resolveURL(config.url, config.username, "checkCredentials", config.urlScheme);
		}

		if (!config.url || config.url === "http://" || config.url === "https://") {
			Log.log("No url for ", config, " found in db or agruments. Can't process this account.");
			outerFuture.result = {returnValue: false, success: false, msg: "No url for account in config."};
			return outerFuture;
		}

		additionalConfig = UrlSchemes.resolveURL(config.url, config.username, "additionalConfig");
		if (additionalConfig) {
			for (key in additionalConfig) {
				if (additionalConfig.hasOwnProperty(key)) {
					config[key] = additionalConfig[key];
				}
			}
		}

		params = {
			path: config.url,
			userAuth: this.client.userAuth,
			originalUrl: config.url,
			ignoreSSLCertificateErrors: this.client.config.ignoreSSLCertificateErrors,
			authCallback: this.client.config.authCallback
		};

		params.cardDav = false;
		future.nest(this.resolveHome(params, config.username, "calendar", config.urlScheme));

		future.then(this, function calendarResolveCB() {
			var result = checkResult(future);
			if (result.returnValue === true) {
				calendarHome = result.home;
			} else {
				calendarHome = false;
			}

			params.cardDav = true;
			future.nest(this.resolveHome(params, config.username, "contact", config.urlScheme));
		});

		future.then(this, function contactResolveCB() {
			var result = checkResult(future);
			if (result.returnValue === true) {
				contactHome = result.home;
			} else {
				contactHome = false;
			}

			if (!calendarHome || !contactHome) {
				Log.log("Missing some homes, start discovery. CalendarHome: ", calendarHome, ", ConctactHome: ", contactHome);
				if (calendarHome) {
					params.path = calendarHome;
				} else if (contactHome) {
					params.path = contactHome;
				} else {
					params.path = config.url;
				}
				future.nest(CalDav.discovery(params));
			} else {
				future.result = { returnValue: true, calendarHome: calendarHome, contactHome: contactHome};
			}
		});

		future.then(this, function discoverCB() {
			var result = checkResult(future);

			if (result.returnValue === true) {
				config[Kinds.objects.calendarevent.name] = {
					homeFolder: result.calendarHome
				};
				config[Kinds.objects.contact.name] = {
					homeFolder: result.contactHome
				};
			} else {
				Log.log("Could not discover addressbook and calendar folders: ", result);

				Log.log("Setting home folders to original URL and hoping for the best.");
				config[Kinds.objects.calendarevent.name] = {
					homeFolder: config.url
				};
				config[Kinds.objects.contact.name] = {
					homeFolder: config.url
				};
			}

			future.nest(DB.merge([config]));
		});

		future.then(this, function storeConfigCB() {
			var result = checkResult(future);
			Log.debug("Store config came back: ", result);
			outerFuture.result = {returnValue: result.returnValue, success: result.returnValue, config: config};
		});
	}

	return outerFuture;
};
