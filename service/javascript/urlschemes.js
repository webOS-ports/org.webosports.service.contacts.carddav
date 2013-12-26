/*global debug */

var UrlSchemes = {
	//known url schemes.
	//idea: search user supplied URL for "key"
	//replace URL for checkCredentials, caldav and carddav with known URLs.
	//issue: some require user specific parts in URL, replace them on useage...
	//	   if a replacement is required more than once, change function!
	urlSchemes: [
		{
			keys:			  "DISABLEDicloud.com",
			calendar:	      "https://p02-caldav.icloud.com:443",
			contact:		  "https://p02-contacts.icloud.com:443",
			checkCredentials: "https://p02-contacts.icloud.com:443"
		},
		{
			key:			  "google.",
			calendar:	      "https://www.google.com:443/calendar/dav/%USERNAME%/user/",
			contact:		  "https://www.google.com:443/carddav/v1/principals/%USERNAME/lists/",
			checkCredentials: "https://www.google.com:443/calendar/dav/%USERNAME%/user"
		},
		{
			key:	          "DISABLEDyahoo.",
			calendar:	      "https://caldav.calendar.yahoo.com",
			contact:		  "https://carddav.address.yahoo.com",
			checkCredentials: "https://carddav.address.yahoo.com"
		},
		{
			key:			  "/owncloud",
            //issue: calendar/contact contain display name, which we don't know and can be different from username??
			calendar:	      "%URL_PREFIX%/owncloud/remote.php/caldav/calendars/%USERNAME%/",
			contact:		  "%URL_PREFIX%/owncloud/remote.php/carddav/addressbooks/%USERNAME%/",
			checkCredentials: "%URL_PREFIX%/owncloud/remote.php/caldav"
		},
		{
			key:			  "/egroupware",
			calendar:	      "%URL_PREFIX%/egroupware/groupdav.php/%USERNAME%/",
			contact:		  "%URL_PREFIX%/egroupware/groupdav.php/%USERNAME%/",
			checkCredentials: "%URL_PREFIX%/egroupware/groupdav.php"
		}
	],

	cache: {

	},

	resolveURL: function (url, username, type) {
		"use strict";
		var i, scheme, index, prefix, newURL;
		if (this.cache[url] &&  this.cache[url][type]) {
			debug("Returning cached url ", this.cache[url][type]);
			return this.cache[url][type];
		}

		if (!this.cache[url]) {
			this.cache[url] = {};
		}

		for (i = 0; i < this.urlSchemes.length; i += 1) {
			scheme = this.urlSchemes[i];
			index = url.indexOf(scheme.key);
			if (index >= 0) {
				debug("Found URL for scheme ", scheme);
				prefix = url.substring(0, index);
				debug("Prefix: ", prefix);
				newURL = scheme[type].replace("%URL_PREFIX%", prefix);
				newURL = newURL.replace("%USERNAME%", username); //This will only replace once.
				debug("Returning new URL: ", newURL);
				this.cache[url][type] = newURL;
				return newURL;
			}
		}

		this.cache[url][type] = url; //prevent looking up same URL all the time.
		return url;
	}
};