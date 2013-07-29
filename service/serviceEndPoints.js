/* Simple debug function to print out to console error */
var debug = function(param) {
    console.error("DEBUG: " + param);
}

/* Validate contact username/password */
var checkCredentialsAssistant = function(future) {};

checkCredentialsAssistant.prototype.run = function(future) {
     var args = this.controller.args;
     debug("Account args =" + JSON.stringify(args));

     var resources = args.username.split("@");

     if (resources.length < 2) {
         future.result = {"errorCode": "400_BAD_REQUEST", "returnValue": false};
     }

     var username = resources[0];
     var syncURL = resources[1];

     //...Base64 encode our entered username and password
     var base64Auth = "Basic " + Base64.encode(username + ":" + args.password);

     //...If request fails, the user is not valid
     AjaxCall.get(syncURL, {headers: {"Authorization":base64Auth, "Connection": "keep-alive"}}).then ( function(f2)
     {
        if (f2.result.status == 200 ) // 200 = Success
        {
            //...Pass back credentials and config (username/password); config is passed to onCreate where
            //...we will save username/password in encrypted storage
            debug("Password accepted");
            future.result = {returnValue: true, "credentials": {"common":{"password" : args.password, "username":username}},
                                                "config": { "password" : args.password, "username":username} };
        }
        else   {
           debug("Password rejected");
           /* FIXME Returning false should stop the account creation but it does get created. */
           future.result = {"errorCode": "401_UNAUTHORIZED", "returnValue": false};
        }
     });
};

/* Capabilites changed notification */
var onCapabilitiesChangedAssistant = function(future){};

// Called when an account's capability providers changes. The new state of enabled
// capability providers is passed in. This is useful for Synergy services that handle all syncing where
// it is easier to do all re-syncing in one step rather than using multiple 'onEnabled' handlers.

onCapabilitiesChangedAssistant.prototype.run = function(future) {
    var args = this.controller.args;
    console.log("Test Service: onCapabilitiesChanged args =" + JSON.stringify(args));
    future.result = {returnValue: true};
};

/* Credentials changed notification */
var onCredentialsChangedAssistant = function(future){};
// Called when the user has entered new, valid credentials to replace existing invalid credentials.
// This is the time to start syncing if you have been holding off due to bad credentials.
onCredentialsChangedAssistant.prototype.run = function(future) {
    var args = this.controller.args;
    console.log("Test Service: onCredentialsChanged args =" + JSON.stringify(args));
    future.result = {returnValue: true};
};

/* Account created notification */
var onCreateAssistant = function(future){};

// The account has been created. Time to save the credentials contained in the "config" object
// that was emitted from the "checkCredentials" function.
onCreateAssistant.prototype.run = function(future) {

    var args = this.controller.args;

    //...Username/password passed in "config" object
    var B64username = Base64.encode(args.config.username);
    var B64password = Base64.encode(args.config.password);

    /* FIXME Add server URL into config */
    var keystore1 = { "keyname":"AcctUsername", "keydata": B64username, "type": "AES", "nohide":true};
    var keystore2 = { "keyname":"AcctPassword", "keydata": B64password, "type": "AES", "nohide":true};

    //...Save encrypted username/password for syncing.
    PalmCall.call("palm://com.palm.keymanager/", "store", keystore1).then( function(f)
    {
        if (f.result.returnValue === true)
        {
            PalmCall.call("palm://com.palm.keymanager/", "store", keystore2).then( function(f2)
           {
              future.result = f2.result;
           });
        }
        else   {
           future.result = f.result;
        }
    });
};

// Account deleted notification
var onDeleteAssistant = function(future){};

// Account deleted - Synergy service should delete account and config information here.
onDeleteAssistant.prototype.run = function(future) {


    //..Create query to delete contacts from our extended kind associated with this account
    var args = this.controller.args;
    var q ={ "query":{ "from":"org.webosports.carddavsync.account:1", "where":[{"prop":"accountId","op":"=","val":args.accountId}] }};

    //...Delete contacts from our extended kind
    PalmCall.call("palm://com.palm.db/", "del", q).then( function(f)
    {
        if (f.result.returnValue === true)
        {
           //..Delete our housekeeping/sync data
           var q2 = {"query":{"from":"org.webosports.carddavsync.transport:1"}};
           PalmCall.call("palm://com.palm.db/", "del", q2).then( function(f1)
           {
              if (f1.result.returnValue === true)
              {
                 //...Delete our account username/password from key store
                 PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname" : "AcctUsername"}).then( function(f2)
                 {
                    if (f2.result.returnValue === true)
                    {
                       PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname" : "AcctPassword"}).then( function(f3)
                       {
                          future.result = f3.result;
                       });
                    }
                    else   {
                       future.result = f2.result;
                    }
                 });
              }
              else   {
                 future.result = f1.result;
              }
           });
        }
        else   {
           future.result = f.result;
        }
    });
};

// Capability enabled notification - called when capability enabled or disabled
var onEnabledAssistant = function(future){};

// Synergy service got 'onEnabled' message. When enabled, a sync should be started and future syncs scheduled.
// Otherwise, syncing should be disabled and associated data deleted.
// Account-wide configuration should remain and only be deleted when onDelete is called.

onEnabledAssistant.prototype.run = function(future) {

    var args = this.controller.args;

    if (args.enabled === true)
    {
        //...Save initial sync-tracking info. Set "lastSync" to a value that returns all records the first-time
        var acctId = args.accountId;
        var ids = [];
        var syncRec = { "objects":[{ _kind: "org.webosports.carddavsync.transport:1", "lastSync":"2005-01-01T00:00:00Z", "accountId":acctId, "remLocIds":ids}]};
        PalmCall.call("palm://com.palm.db/", "put", syncRec).then( function(f)
        {
            if (f.result.returnValue === true)
            {
               PalmCall.call("palm://org.webosports.carddavsync.service/", "sync", {}).then( function(f2)
               {
                  // Here you could schedule additional syncing via the Activity Manager.
                  future.result = f2.result;
               });
            }
            else {
               future.result = f.result;
            }
        });
    }
    else {
       // Disable scheduled syncing and delete associated data.
    }

    future.result = {returnValue: true};
};

// Sync function
var syncAssistant = function(future){};

syncAssistant.prototype.run = function(future) {
/*
        var args = this.controller.args;

        var username = "";
        var password = "";

        //..Retrieve our saved username/password
        PalmCall.call("palm://com.palm.keymanager/", "fetchKey", {"keyname" : "AcctUsername"}).then( function(f)
        {
           if (f.result.returnValue === true)
           {
              username = Base64.decode(f.result.keydata);
              PalmCall.call("palm://com.palm.keymanager/", "fetchKey", {"keyname" : "AcctPassword"}).then( function(f1)
              {
                  if (f1.result.returnValue === true)
                  {
                     password = Base64.decode(f1.result.keydata);

                     //..Format Plaxo authentication
                     var base64Auth = "Basic " + Base64.encode(username + ":" + password);
                     var syncURL = "http://www.plaxo.com/pdata/contacts?updatedSince=";

                     //..Get our sync-tracking information saved previously in a db8 object
                     var q = {"query":{"from":"com.palmdts.contact.transport:1"}};
                     PalmCall.call("palm://com.palm.db/", "find", q).then( function(f2)
                     {
                        if (f2.result.returnValue === true)
                        {
                           var id        = f2.result.results[0]._id;
                           var accountId = f2.result.results[0].accountId;
                           var remLocIds = f2.result.results[0].remLocIds;  // local id/remote id pairs
                           var lastSync  = f2.result.results[0].lastSync;   // date/time since last sync


                           syncURL = syncURL + lastSync + "&fields=%40all&sortBy=id&sortOrder=ascending";

                           console.log("Test Service: syncURL="+syncURL +"\n");

                           //...Get our updated or new contacts from Plaxo
                           AjaxCall.get(syncURL, {headers: {"Authorization":base64Auth, "Connection": "keep-alive"}}).then ( function(f3)
                           {
                               if (f3.result.status === 200 ) // 200 = Success
                               {
                                   //... Turn JSON text into JSON object, Yes, eval is evil.
                                  var results =  eval('(' + f3.result.responseText + ')');

                                  if (results.totalResults <= 0)  { // Return if no new or updated records.
                                     future.result = f3.result;
                                  }

                                  console.log("Test Service: results=" + JSON.stringify(results.entry));

                                  //...Add necessary fields for our extended contacts.
                                  //...Collect all remote ids into array to check if they already exist in db8
                                  var remIds =[];
                                  for (i=0; i < results.totalResults; i++)
                                  {
                                     results.entry[i].accountId = accountId;
                                     results.entry[i]._kind = "com.palmdts.contact.testacct:1";
                                     remIds.push(results.entry[i].id);
                                  }

                                  //...Find all returned contacts that are already in db8
                                  var delIds = [];
                                  for (i=0; i < remIds.length; i++)
                                  {
                                     var found = false;
                                     for (j=0; j < remLocIds.length && !found; j++)
                                     {
                                        //...Does remote id match one we are storing
                                        if (remIds[i] == remLocIds[j].remId)
                                        {
                                           delIds.push(remLocIds[j].locId); // Save for deletion
                                           remLocIds.splice(j, 1);  // Remove from our local record-keeping
                                           found = true;
                                        }
                                      }
                                   }

                                  //...Delete all contacts that have been updated. Note that empty array still returns true
                                  delObjs = {"ids":delIds};
                                  PalmCall.call("palm://com.palm.db/",  "del", delObjs).then( function(f4)
                                  {
                                     if (f4.result.returnValue === true)
                                     {
                                        //...Save our updated or new contacts
                                        var newContactObjects = {"objects":results.entry};

                                        //..Write new or updated contacts
                                        PalmCall.call("palm://com.palm.db/",  "put", newContactObjects).then( function(f5)
                                        {
                                           if (f5.result.returnValue === true)
                                           {
                                               var idObj = {};

                                               //...Create objects containing assoc. remote ids and local ids for local record-keeping
                                               for (i=0; i < f5.result.results.length; i++)
                                               {
                                                  idObj = {"locId": f5.result.results[i].id, "remId":remIds[i]};
                                                  remLocIds.push(idObj);
                                               }

                                               var lastSyncDateTime = calcSyncDateTime(); // Get date/time of this sync
                                               var syncRec = { "objects": [{ "_id":id, "lastSync":lastSyncDateTime, "remLocIds": remLocIds}]};

                                               //...Update our sync-tracking info
                                               PalmCall.call("palm://com.palm.db/",  "merge", syncRec).then( function(f6)
                                               {
                                                  future.result = f6.result;
                                               });
                                          }
                                          else   {
                                             future.result = f5.result;  // "put" of new contacts failure
                                          }
                                        });
                                     }
                                     else   {
                                        future.result = f4.result; // "del" of updated contacts failure
                                     }
                                  });   // del objs
                              }
                              else   {
                                  future.result = f3.result;  // Ajax Call failure
                              }
                         });
                     }
                     else   {
                        future.result = f2.result;  // Failure to "get" local sync-tracking info
                     }
                 });
               }
               else {
                     future.result = f1.result;  // Failure to get account pwd from Key Manager
               }
           });
        }
        else   {
              future.result = f.result;  // Failure to get account username from Key Manager
        }
     }); */
};
