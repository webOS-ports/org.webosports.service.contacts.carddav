/* ServiceAssistant
* Description: This method handles the high level transport setup.
* This assistant is called before anything within the service.  This is useful to intercept the various endpoints and
* handle various tasks like key storage or customizations
*
* To run manually:
* run-js-service -d /media/cryptofs/apps/usr/palm/services/org.webosports.cdav.service/
*/
/*jslint sloppy: true, node: true */
/*global log, debug, Class, searchAccountConfig, Transport, Sync, Future, KeyStore, Kinds, iCal, vCard, DB, Base64, KindsCalendar, KindsContacts */

var ServiceAssistant = Transport.ServiceAssistantBuilder({
	clientId: "",

	client: Class.create(Sync.AuthSyncClient, {

		kinds: {},

		setup: function setup(service, accountid, launchConfig, launchArgs) {
			log("\n\n**************************START SERVICEASSISTANT*****************************");
			//for testing only - will expose credentials to log file if left open
			//debug("\n------------------->accountId:", accountid);
			//debug("\n------------------->launchConfig", launchConfig);
			//debug("\n------------------->launchArgs", launchArgs);
			log("Starting " + launchConfig.name + " for account " + launchArgs.accountId + " from activity " + JSON.stringify(launchArgs.$activity));

			//this seems necessary for super class constructor during checkCredentials calls.
			this.accountId = launchArgs.accountId || "";

			if (!this.config) {
				this.config = {};
			}

			this.config.url = launchArgs.url || this.config.url;

			//in onCreate call we will store config away in transport object. First store it in this, later on will be put into transport.
			if (launchArgs.config) {
				this.config.name =	  launchArgs.config.name || this.config.name;
				this.config.url  =	  launchArgs.config.url  || this.config.url;
				this.config.username =  launchArgs.config.username || launchArgs.username || this.config.username;
				this.config.accountId = this.accountId || this.config.accountId;

				if (launchArgs.config.credentials) {
					this.config.username =  launchArgs.config.credentials.user || this.config.username;
				}
			}

			if (launchConfig.name.indexOf("Calendar") >= 0) {
				log("Setting Kinds to Calendar.");
				this.kinds = KindsCalendar;
			} else if (launchConfig.name.indexOf("Contacts") >= 0) {
				log("Setting Kinds to Contacts");
				this.kinds = KindsContacts;
			} else {
				log("Setting general kinds...");
				this.kinds = Kinds;
			}

			var future = new Future();

			//get config object from db:
			if (this.accountId) {
				if (!this.config) {
					this.config = {};
				}
				this.config.accountId = this.accountId;

				//search recursively, first by accountId, then account name then username.
				future.nest(searchAccountConfig(this.config));
			} else {
				log("No accountId, continue execution without config lookup.");
				future.result = { returnValue: false };
			}

			//initialize iCal stuff.
			future.then(this, function () {
				var result = future.result;
				if (result.returnValue === true) {
					this.config = result.config;
				}
				future.nest(iCal.initialize());
			});

			future.then(this, function () {
				var result = future.result;
				if (!result.iCal) {
					debug("iCal init not ok.");
				} else {
                    debug("iCal initialized");
                }
				future.nest(vCard.initialize());
			});

			future.then(this, function () {
				var result = future.result;
				if (!result.vCard) {
					debug("vCard init not ok.");
				} else {
                    debug("vCard initialized");
                }
				future.result = { returnValue: true };
			});

			future.then(this, function getCredentials() {
                debug("Getting credentials.");
				//these two endpoints don't require stored auth data (passed in as default)
				//onEnabled also did not supply creds.. hm. Will this cause problems?
				if (launchConfig.name === "onDelete" || launchConfig.name === "checkCredentials") {
					this.userAuth = {"username": launchArgs.username, "password": launchArgs.password, url: this.config.url};
					future.result = {}; //do continue future execution
				} else {
					if (!this.accountId) {
						throw "Need accountId for operation " + launchConfig.name;
					}

					future.nest(KeyStore.checkKey(this.accountId));
					future.then(this, function () {
						debug("------------->Checked Key" + JSON.stringify(future.result));

						if (future.result.value) {  //found key
							debug("------------->Existing Key Found");
							KeyStore.getKey(this.accountId).then(this, function (getKey) {
								log("------------->Got Key"); //+JSON.stringify(getKey.result));
								this.userAuth = {"user": getKey.result.credentials.user, "password": getKey.result.credentials.password, "authToken": getKey.result.credentials.authToken};
							});
						} else { //no key found - check for username / password and save
							debug("------------->No Key Found - Putting Key Data and storing globally");

							//somehow this is VERY inconsistent!
							var username = launchArgs.username || launchArgs.user,
								password = launchArgs.password,
								authToken;
							if (launchArgs.config) {
								username = launchArgs.config.user || username;
								username = launchArgs.config.username || username;
								password = launchArgs.config.password || password;
							}

							if (launchArgs.config && launchArgs.config.credentials) {
								username = launchArgs.config.credentials.user || username;
								username = launchArgs.config.credentials.username || username;
								password = launchArgs.config.credentials.password || password;
							}

							if (username && password) {
								authToken = "Basic " + Base64.encode(username + ":" + password);
								this.userAuth = {"user": username, "password": password, "authToken": authToken};
								KeyStore.putKey(this.accountId, this.userAuth).then(function (putKey) {
									debug("------------->Saved Key" + JSON.stringify(putKey.result));
								});
							} else {
								debug("---->No config, can't do anything.");
							}
						}
						future.result = { returnValue: true }; //continue with future execution.
						return true;
					});
				}
			});

			//preconfiguration of the service is complete...launch the sync engine
			future.then(this, function () {
				this.$super(setup)(service, this.accountId, undefined, Transport.HandlerFactoryBuilder(Sync.SyncHandler(this.kinds)));
				return true;
			});

			return future;
		},

		getSyncInterval: function () {
			log("*********************************** getSyncInterval ********************************");
			return new Future("20m");  //default sync interval
		},

		requiresInternet: function () {
			return true;  //yes, we need internet to connect to Plaxo
		}
	})
});

//these endpoints are delegated to the sync framework to handle - use the serviceassistant code above to intercept
var OnContactsEnabled = Sync.EnabledAccountCommand;
var OnCalendarEnabled = Sync.EnabledAccountCommand;
var OnCredentialsChanged = Sync.CredentialsChangedCommand;
