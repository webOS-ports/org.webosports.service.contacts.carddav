/*jslint sloppy: true, node: true, nomen: true */
/*global Class, Sync, Future, Log, Kinds, lockCreateAssistant, DB, unlockCreateAssistant */

var OnContactsCreate = Class.create(Sync.CreateAccountCommand, {
    run: function run(outerFuture) {
        var future = new Future(), checkRunning;

        this.$super(run)(future); //let parent create transport object.

        //but we need only one config object:
        if (lockCreateAssistant(this.client.clientId)) {
            future.then(this, function createAccountCB() {
                var result = future.result, config = this.client.config;
                Log.log("Account created: ", result);

                config.accountId = this.client.clientId; //be sure to store right accountId.
                config._kind = Kinds.accountConfig.id;

                Log.log("Storing config in onCreateAssistant");
                future.nest(DB.put([config]));
            });

            future.then(this, function dbCB() {
                var result = future.result;
                Log.debug("Stored config object:", result);
                if (result.returnValue === true) {
                    this.client.config._id = result.results[0].id;
                    this.client.config._rev = result.results[0].rev;
                }
                unlockCreateAssistant(this.client.clientId);
                outerFuture.result = {returnValue: true};
            });
        } else { //other create assistant already running. Prevent multiple account objects.
            Log.log("Another create assistant is already running. Waiting...");

            checkRunning = function () {
                if (!lockCreateAssistant(this.client.clientId)) {
                    Log.log("Still waiting for creation of account " + this.client.clientId);
                    setTimeout(checkRunning.bind(this), 100);
                } else {
                    Log.log("Other create assistant did finish, finish this, too.");
                    unlockCreateAssistant(this.client.clientId); //unlock again.
                    outerFuture.result = {returnValue: true};
                }
            };

            setTimeout(checkRunning.bind(this), 100);
            //outerFuture.result = {returnValue: true};
        }
        return outerFuture;
    }
});

var OnCreate = Sync.CreateAccountCommand; //use dummy for all capabilities other than contacts, so that we only store one account.config object per account. They are all called by the account manager anyway...