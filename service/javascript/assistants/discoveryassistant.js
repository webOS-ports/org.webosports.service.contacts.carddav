/*jslint sloppy: true, node: true, nomen: true */
/*global Future, log, Kinds, debug, DB, CalDav, UrlSchemes */

var DiscoveryAssistant = function () {};

//call with accountId (required), username, name, url.
//accountId, name and username will be used to search for config object.
//url will be updated in DB. If no object in DB, yet, URL is required.
DiscoveryAssistant.prototype.run = function (outerFuture) {
	var future = new Future(), args = this.controller.args;

	if (this.client && this.client.config) {
		future.nest(this.processAccount(args, this.client.config));
	} else {
		log("No config object was found by serviceAssistant! Trying to create new one with command line arguments.");
		future.nest(this.processAccount(args, {
			_kind: Kinds.accountConfig.id,
			accountId: args.accountId
		}));
	}

	future.then(this, function discoveryFinished() {
		var result = future.result || {returnValue: false};
		log("Discovery finished.");
		outerFuture.result = result;
	});
	return outerFuture;
};

DiscoveryAssistant.prototype.resolveHome = function (params, username, type) {
    var future = new Future(), home;

    home = UrlSchemes.resolveURL(params.originalUrl, username, type);
    if (home !== params.originalUrl) {
        log("Could resolve " + type + " home from known URL schemes, get folders from there");
        params.path = home;
        future.nest(CalDav.getFolders(params, type));

        future.then(this, function foldersCB() {
            var result = future.result;
            if (result.returnValue === true) {
                if (result.folders && result.folders.length > 0) {
                    log("Got " + type + " folders from known home.");
                    future.result = { returnValue: true, home: home };
                } else {
                    log("No " + type + " folders from known home, trying usual discovery.");
                    future.result = { returnValue: false };
                }
            }
        });
    } else {
        log("Could not resolve " + type + " home from known URL schemes.");
        future.result = { returnValue: false };
    }

    return future;
};

DiscoveryAssistant.prototype.processAccount = function (args, config) {
	var future = new Future(), outerFuture = new Future(), params, calendarHome, contactHome, key, additionalConfig;

	if (config) {
		debug("Got config object: " + JSON.stringify(config));

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

		if (!config.url) {
			log("No url for " + JSON.stringify(config) + " found in db or agruments. Can't process this account.");
			outerFuture.result = {returnValue: false, success: false, msg: "No url for account in config."};
			return outerFuture;
		}

		additionalConfig = UrlSchemes.resolveURL(config.url, config.username, "additionalConfig");
		debug("AdditionalConfig: ", additionalConfig);
		if (additionalConfig) {
			for (key in additionalConfig) {
				if (additionalConfig.hasOwnProperty(key)) {
					debug("Copying " + key + " from UrlSchemes into config object.");
					config[key] = additionalConfig[key];
				}
			}
		}

		params = {
			path: config.url,
			authToken: this.client.userAuth.authToken,
			originalUrl: config.url
		};

        future.nest(this.resolveHome(params, config.username, "calendar"));

        future.then(this, function calendarResolveCB() {
            var result = future.result;
            if (result.returnValue === true) {
                calendarHome = result.home;
            } else {
                calendarHome = false;
            }

            future.nest(this.resolveHome(params, config.username, "contact"));
        });

        future.then(this, function contactResolveCB() {
            var result = future.result;
            if (result.returnValue === true) {
                contactHome = result.home;
            } else {
                contactHome = false;
            }

            if (!calendarHome || !contactHome) {
                log("Missing some homes, start discovery. CalendarHome: " + calendarHome + ", ConctactHome: " + contactHome);
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
			var result = future.result, i, f;

			if (result.returnValue === true) {
				config[Kinds.objects.calendarevent.name] = {
					homeFolder: result.calendarHome
				};
				config[Kinds.objects.contact.name] = {
					homeFolder: result.contactHome
				};
			} else {
				log("Could not discover addressbook and calendar folders: " + JSON.stringify(result));

				log("Setting home folders to original URL and hoping for the best.");
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
			var result = future.result || future.exception;
			debug("Store config came back: " + JSON.stringify(result));
			outerFuture.result = {returnValue: result.returnValue, success: result.returnValue, config: config};
		});
	}

	return outerFuture;
};
