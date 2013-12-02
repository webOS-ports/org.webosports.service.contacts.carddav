/* ServiceAssistant
* Description: This method handles the high level transport setup.
* This assistant is called before anything within the service.  This is useful to intercept the various endpoints and
* handle various tasks like key storage or customizations
*
* To run manually:
* run-js-service -d /media/cryptofs/apps/usr/palm/services/org.webosports.service.contacts.carddav.service/
*/
/*jslint sloppy: true, node: true */
/*global log, debug, Class, Transport, Sync, Future, KeyStore, Kinds, iCal, vCard, DB, CalDav, Base64 */

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
				this.config = {
					name: launchArgs.config.name,
					url:  launchArgs.config.url,
					username: launchArgs.config.username
				};
			}

			//TODO: Add new kind account.config => sync: true!
			//if no config object in transport object =>
			// search for config in account.config kind, first by accountID, then by username
			// if found something, augment transport object with config.
			// in the other way round: on creation, store config in account.config db with account_id and username.
			// also store/update config in discovery assistant.

			var future = new Future();

			//initialize iCal stuff.
			future.nest(iCal.initialize());

			future.then(function () {
				var result = future.result;
				debug("iCal init came back.");
				if (result.iCal) {
					debug("iCal init ok.");
				}
				future.nest(vCard.initialize());
			});

			future.then(function () {
				var result = future.result;
				debug("vCard init came back.");
				if (result.vCard) {
					debug("vCard init ok.");
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
				debug("Calling super function from future.then");
				this.$super(setup)(service, this.accountId, undefined, Transport.HandlerFactoryBuilder(Sync.SyncHandler(Kinds)));
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
//var OnCreate = Sync.CreateAccountCommand; //=> now in own assistant. Does discovery.
var OnDelete = Sync.DeleteAccountCommand;
var OnEnabled = Sync.EnabledAccountCommand;
var OnCredentialsChanged = Sync.CredentialsChangedCommand;
