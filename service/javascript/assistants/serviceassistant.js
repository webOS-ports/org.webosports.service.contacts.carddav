/* ServiceAssistant
* Description: This method handles the high level transport setup.
* This assistant is called before anything within the service.  This is useful to intercept the various endpoints and
* handle various tasks like key storage or customizations
*
* To run manually:
* run-js-service -d /media/cryptofs/apps/usr/palm/services/org.webosports.cdav.service/
*/
/*jslint sloppy: true, node: true */
/*global log, debug, Class, searchAccountConfig, Transport, Sync, Future, KeyStore, Kinds, iCal, vCard, DB, CalDav, Base64 */

var ServiceAssistant = Transport.ServiceAssistantBuilder({
	clientId: "",

	client: Class.create(Sync.AuthSyncClient, {

		setup: function setup(service, accountid, launchConfig, launchArgs) {
			log("\n\n**************************START SERVICEASSISTANT*****************************");
			//for testing only - will expose credentials to log file if left open
			//debug("\n------------------->accountId:" + JSON.stringify(accountid));
			//debug("\n------------------->launchConfig" + JSON.stringify(launchConfig));
			//debug("\n------------------->launchArgs" + JSON.stringify(launchArgs));
			log("Starting " + launchConfig.name + " for account " + launchArgs.accountId + " from activity " + JSON.stringify(launchArgs.$activity));

			//this seems necessary for super class constructor during checkCredentials calls.
			this.accountId = launchArgs.accountId || "";

			//in onCreate call we will store config away in transport object. First store it in this, later on will be put into transport.
			if (launchArgs.config) {
				if (!this.config) {
					this.config = {};
				}

				this.config.name =      launchArgs.config.name || this.config.name;
				this.config.url  =      launchArgs.config.url  || this.config.url;
				this.config.username =  launchArgs.config.username || this.config.username;
				this.config.accountId = this.accountId || this.config.accountId;

				if (launchArgs.config.credentials) {
					this.config.usnerame =  launchArgs.config.credentials.user || this.config.username;
				}
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
				}
				future.nest(vCard.initialize());
			});

			future.then(this, function () {
				var result = future.result;
				if (!result.vCard) {
					debug("vCard init not ok.");
				}
				future.result = { returnValue: true };
			});

			future.then(this, function getCredentials() {
				//these two endpoints don't require stored auth data (passed in as default)
				//onEnabled also did not supply creds.. hm. Will this cause problems?
				if (launchConfig.name === "onDelete" || launchConfig.name === "checkCredentials") {
					this.userAuth = {"username": launchArgs.username, "password": launchArgs.password, url: launchArgs.url};
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
								//log("------------->Got Key: "+JSON.stringify(getKey.result));
								this.userAuth = {"user": getKey.result.credentials.user, "password": getKey.result.credentials.password, "authToken": getKey.result.credentials.authToken};
							});
						} else { //no key found - check for username / password and save
							debug("------------->No Key Found - Putting Key Data and storing globally");
							if (launchArgs.config && launchArgs.config.credentials) {
								var authToken = "Basic " + Base64.encode(launchArgs.config.credentials.user + ":" + launchArgs.config.credentials.password);
								this.userAuth = {"user": launchArgs.config.credentials.user, "password": launchArgs.config.credentials.password, "authToken": authToken};
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
				if (launchConfig.name.indexOf("Calendar") >= 0) {
					Kinds.syncOrder = Kinds.syncOrderCalendar;
					log("Set syncOrder: " + JSON.stringify(Kinds.syncOrder));
					this.$super(setup)(service, this.accountId, undefined, Transport.HandlerFactoryBuilder(Sync.SyncHandler(Kinds)));
				} else if (launchConfig.name.indexOf("Contacts") >= 0) {
					Kinds.syncOrder = Kinds.syncOrderContacts;
					log("Set syncOrder: " + JSON.stringify(Kinds.syncOrder));
					this.$super(setup)(service, this.accountId, undefined, Transport.HandlerFactoryBuilder(Sync.SyncHandler(Kinds)));
				} else {
					log("Set syncOrder: " + JSON.stringify(Kinds.syncOrder));
					this.$super(setup)(service, this.accountId, undefined, Transport.HandlerFactoryBuilder(Sync.SyncHandler(Kinds)));
				}
				return true;
			});

			return future;
		},

		getSyncInterval: function () {
			return new Future("20m");  //default sync interval
		},

		requiresInternet: function () {
			return true;  //yes, we need internet to connect to Plaxo
		}
	})
});

//these endpoints are delegated to the sync framework to handle - use the serviceassistant code above to intercept
//var OnCreate = Sync.CreateAccountCommand; //=> now in own assistant, creates account.config object.
//var OnDelete = Sync.DeleteAccountCommand; //=> now in own assistant, deletes account.config object.
var OnContactsEnabled = Sync.EnabledAccountCommand;
var OnCalendarEnabled = Sync.EnabledAccountCommand;
var OnCredentialsChanged = Sync.CredentialsChangedCommand;
