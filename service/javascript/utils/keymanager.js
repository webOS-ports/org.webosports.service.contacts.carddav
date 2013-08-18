/**************************************************
KeyStore - used to handle storage of authentication data
within key manager.
**************************************************/
/*global Future, PalmCall, log */
//this is taken from MojoSyncFramework example in PalmSDK. What License is this under??
var KeyStore = function() {
        var keyStoreFuture = new Future(null);
        var KEYMGR_URI = "palm://com.palm.keymanager/";
        
        var _putCredentials = function(accountId, value) {
                var keydata;
                
                //console.log("------>made API call _putCredentials using accountId:" + accountId);
                var future = PalmCall.call(KEYMGR_URI, "fetchKey", {
                        keyname: accountId
                });
                
                future.then(function() {
                        try {   // Fire the exception if there is one
                                future.getResult();
                        } catch (e) {
                                keydata = {};
                                future.result = {};
                                return;
                        }

                        keydata = JSON.parse(future.result.keydata);

                        // Remove the key with this accountId, so it can be replaced
                        //console.log("------>made API _putCredentials call remove");
                        future.nest(PalmCall.call(KEYMGR_URI, "remove", {
                                "keyname": accountId
                        }));
                });
                future.then(function() {
                        future.getResult();
                        keydata = value;

                        //console.log("------>made API _putCredentials call store - Data:" + JSON.stringify(keydata));
                        future.nest(PalmCall.call(KEYMGR_URI, "store", {
                                keyname: accountId,
                                keydata: JSON.stringify(keydata),
                                type:    "ASCIIBLOB",
                                nohide:  true
                        }));
                });         
                return future;
        };                   
                            
        var _getCredentials = function(accountId) {
               //console.log("------>made API call get");
                var future = PalmCall.call(KEYMGR_URI, "fetchKey", {
                        keyname: accountId
                });         
                future.then(function() {
                        var success;
                            
                        try {
                                var credentials = JSON.parse(future.result.keydata);
                            
                                if (credentials) {
                                        future.result = {
                                                credentials: credentials
                                        };
                                        success = true;
                                }
                        } catch (e) {
                        }   
                            
                        if (!success) {
                                future.setException({
                                        message: "Credentials for key '" + accountId + "' not found ",
                                        errorCode: "CREDENTIALS_NOT_FOUND"
                                });
                        }   
                            
                });         
                return future;
        };                   
                            
        var _deleteCredentials = function(accountId) {
                //console.log("------>made API call delete");
                return PalmCall.call(KEYMGR_URI, "remove", {
                        keyname: accountId
                });         
        };                   
            
        var _hasCredentials = function(accountId) {
                log("------>made API call has credentials");
                var future = PalmCall.call(KEYMGR_URI, "keyInfo", {
                        keyname: accountId
                });         
                future.then(function() {
                        var r;
                        var success;
                            
                        try {
                                r = future.result;
                                success = true;
                        } catch (e) {
                                success = false;
                        }   
                        future.result = {
                                "value": success
                        };  
                });         
                return future;
        }; 
        return {            
               checkKey: function(key) {
                  return _hasCredentials(Base64.encode(key));
               },
               putKey: function(key, dataValue) {
                  return _putCredentials(Base64.encode(key), dataValue);
               },
               getKey: function(key) {
                  return _getCredentials(Base64.encode(key));
               },
               deleteKey: function(key) {
                  return _deleteCredentials(Base64.encode(key));
               }
        };                  
}();


