/*jslint sloppy: true, nomen: true */
/*global debug, Future, DB, log*/

//prevents the creation of multiple transport objects on webOS 2.2.4
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

//search transport object managed by mojo sync framework.
//be careful with manipulations on that obj:
//This object get's deleted on some occasions!
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
					future.result = {returnValue: true, transportObj: obj};
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

//recursive method to search in config db. Will return a future that get's the config object as result.
var searchAccountConfigInConfigDB = function (config, param, next, nextNext) {
	var future, outerFuture;
	if (!param) { //exit condition.
		log("Could not find any information about account " + config.accountId + " in config db.");
		outerFuture.result = {returnValue: false }; //continue execution.
		return;
	}

	if (config[param]) {
		future.nest(DB.find({
			from: "org.webosports.service.contacts.carddav.account.config:1",
			where: [ { prop: param, op: "=", val: config[param] } ]
		}));

		future.then(function searchCB() {
			try {
				var result = future.result();
				if (result.returnValue === true) {
					if (result.results.length > 0 && result.results[0].config) {
						outerFuture.result = {
							config: result.results[0].config,
							returnValue: true
						};
						log("Found config with " + param + ": " + JSON.stringify(config));

						if (result.results.length > 1) {
							log("WARNING: Found multiple results for account!!");
						}
					} else {
						searchAccountConfigInConfigDB(next, nextNext); //try next one.
					}
				} else {
					result = future.exception;
					log("Could not find with param " + param + ". Reason: " + result.message);
					searchAccountConfigInConfigDB(next, nextNext); //try next one.
				}
			} catch (e) {
				log("Got exception while find with param " + param + ". Message: " + e.message);
				searchAccountConfigInConfigDB(next, nextNext); //try next one.
			}
		});
	} else {
		debug("No value for " + param + " in service config.");
		searchAccountConfigInConfigDB(next, nextNext); //try next one.
	}
	return outerFuture;
};

//searches account info from all possible places.
//will also transfer old config storage into new one.
var searchAccountConfig = function (args) {
	var outerFuture = new Future(), future = new Future();

	future.nest(searchAccountConfigInConfigDB(args, "accountId", "name", "username"));

	future.then(function configCB() {
		var result = future.result || future.exception;
		if (result.returnValue === true) {
			outerFuture.result = { returnValue: true, config: result.config };
			future.result = { returnValue: false }; //stop search.
		} else {
			future.nest(getTransportObjByAccountId(args));
		}
	});

	future.then(function transportCB() {
		var result = future.result || future.exception, config;
		if (result.returnValue === true) {
			if (result.transportObj && result.transportObj.config) {
				outerFuture.result = { returnValue: true, config: result.transportObj.config };

				log("Transfering old config store into new one.");
				config = result.transportObj.config;
				config.username = args.username || config.username;
				config.accountId = args.username || config.accountId;
				config.name = args.name || config.name;
				config._kind = "org.webosports.service.contacts.carddav.account.config:1";
				delete config._id;
				DB.merge([config]).then(function mergeCB(f) {
					var result = f.result || f.exception;
					log("Config store came back: " + JSON.stringify(result));
				});
			} else {
				//no config in transport object => fail.
				outerFuture.result = { returnValue: false };
			}
		} else {
			outerFuture.result = { returnValue: false };
		}
	});

	return outerFuture;
};
