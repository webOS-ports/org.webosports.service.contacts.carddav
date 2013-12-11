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
	var query = {"from": Kinds.account.metadata_id}, future = new Future();

	if (args.id) {
		future.nest(DB.get([args.id]));
	} else {
		future.nest(DB.find(query, false, false));
	}

	future.then(this, function gotDBObject() {
		var result = future.result || future.exception, i, obj, found = false;
		if (result.returnValue) {
			for (i = 0; i < result.results.length; i += 1) {
				obj = result.results[i];
				if (obj.accountId === args.accountId) {
					future.result = {returnValue: true, transportObj: obj};
					found = true;
					break;
				}
			}

			if (!found) {
				log("No transport object for account " + args.accountId);
				future.result = {returnValue: false, success: false};
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
	var future = new Future(), outerFuture = new Future();
	if (!param) { //exit condition.
		log("Could not find any information about account " + config.accountId + " in config db.");
		outerFuture.result = {returnValue: false }; //continue execution.
		return outerFuture;
	}

	if (config[param]) {
		future.nest(DB.find({
			from: Kinds.accountConfig.id,
			where: [ { prop: param, op: "=", val: config[param] } ]
		}));

		future.then(function searchCB() {
			try {
				var result = future.result || future.exception;
				if (result.returnValue) {
					if (result.results.length > 0) {
						//delete result.results[0]._rev; => nope, not allowed. Did try that to prevent "wrong rev errors". But seems that we have to live with them.
						outerFuture.result = {
							config: result.results[0],
							returnValue: true
						};
						//log("Found config with " + param + ": " + JSON.stringify(config));

						if (result.results.length > 1) {
							log("WARNING: Found multiple results for account!!");
						}
					} else {
						//log("No config object for " + param + " = " + config[param]);
						outerFuture.nest(searchAccountConfigInConfigDB(config, next, nextNext)); //try next one.
					}
				} else {
					log("Could not find with param " + param + ". Reason: " + result.message);
					outerFuture.nest(searchAccountConfigInConfigDB(config, next, nextNext)); //try next one.
				}
			} catch (e) {
				log("Got exception while find with param " + param + ". Message: " + e.message);
				outerFuture.nest(searchAccountConfigInConfigDB(config, next, nextNext)); //try next one.
			}
		});
	} else {
		//debug("No value for " + param + " in service config.");
		outerFuture.nest(searchAccountConfigInConfigDB(config, next, nextNext)); //try next one.
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
			//log("Found config in config db: " + JSON.stringify(result.config));
			outerFuture.result = { returnValue: true, config: result.config };
		} else {
			log("Did not find object in config db, try transport object.");
			future.nest(getTransportObjByAccountId(args));
		}
	});

	future.then(function transportCB() {
		var result = future.result || future.exception, config;

		if (result.returnValue === true) {
			if (result.transportObj && result.transportObj.config) {
				log("Transfering old config store into new one.");
				config = result.transportObj.config;
				config.username = args.username || config.username;
				config.accountId = args.accountId || config.accountId;
				config.name = args.name || config.name;
				config._kind = Kinds.accountConfig.id;
				delete config._id;
				DB.merge([config]).then(function mergeCB(f) {
					var result = f.result || f.exception;
					log("Config store came back: " + JSON.stringify(result));
					if (result.returnValue === true) {
						config._id = result.results[0].id;
					}
					outerFuture.result = { returnValue: true, config: config };
				});
			} else {
				//no config in transport object => fail.
				//log("No transport object for account.");
				outerFuture.result = { returnValue: false };
			}
		} else {
			log("Failed to get transport object for account.");
			outerFuture.result = { returnValue: false };
		}
	});

	return outerFuture;
};
