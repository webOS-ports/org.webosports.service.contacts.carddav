/*global Log */
/*exported UrlSchemes*/

var UrlSchemes = {
	//adjust these if reordering urlSchemes array.
	iCloudScheme: 0,
	googleScheme: 1,
	yahooScheme: 2,

	//known url schemes.
	//idea: search user supplied URL for "key"
	//replace URL for checkCredentials, caldav and carddav with known URLs.
	//issue: some require user specific parts in URL, replace them on useage...
	//       if a replacement is required more than once, change function!
	urlSchemes: [
		//indices for iCloud, Google and Yahoo have to be fixed.
		{
			//contact & calendar hostname vary for each user, it seems.
			keys:              ["icloud.com"],
			checkCredentials:  "https://p02-contacts.icloud.com:443"
		},
		{
			oauth:             true,
			keys:              [".googleapis.", ".google."],
			calendar:          "https://www.googleapis.com:443/caldav/v2/%USERNAME%/",
			contact:           "https://www.googleapis.com:443/carddav/v1/principals/%USERNAME%/lists/",
			checkCredentials:  "https://www.googleapis.com:443/.well-known/carddav"
		},
		{
			keys:              ["yahoo."],
			calendar:          "https://caldav.calendar.yahoo.com/dav/%USERNAME%/Calendar/",
			contact:           "https://carddav.address.yahoo.com/dav/%USERNAME%/",
			checkCredentials:  "https://caldav.calendar.yahoo.com/dav/"
		},
		{
			name:              "ownCloud",
			keys:              ["/owncloud/", "cloudu.de"],
			needPrefix:        true,
			//issue: calendar/contact contain display name, which we don't know and can be different from username??
			calendar:          "%URL_PREFIX%remote.php/caldav/calendars/%USERNAME%/",
			contact:           "%URL_PREFIX%remote.php/carddav/addressbooks/%USERNAME%/",
			checkCredentials:  "%URL_PREFIX%remote.php/caldav"
		},
		{
			name:              "eGroupware",
			keys:              ["/egroupware/"],
			needPrefix:        true,
			calendar:          "%URL_PREFIX%groupdav.php/%USERNAME%/",
			contact:           "%URL_PREFIX%groupdav.php/%USERNAME%/",
			checkCredentials:  "%URL_PREFIX%groupdav.php",
			additionalConfig: {
				preventDuplicateCalendarEntries: true
			}
		},
		{
			name:              "SOGo",
			keys:              ["/SOGo/"],
			needPrefix:        true,
			calendar:          "%URL_PREFIX%dav/%USERNAME%/Calendar/",
			contact:           "%URL_PREFIX%dav/%USERNAME%/Contacts/",
			checkCredentials:  "%URL_PREFIX%dav/%USERNAME%/"
		},
		{
			name:              "sabre/dav",
			keys:              ["/sabredav/"],
			needPrefix:        true,
			calendar:          "%URL_PREFIX%calendarserver.php/calendars/%USERNAME%/default/",
			contact:           "%URL_PREFIX%addressbookserver.php/addressbooks/%USERNAME%/",
			checkCredentials:  "%URL_PREFIX%calendarserver.php/calendars/%USERNAME%/default/"
		},
		{
			name:              "fruux.com",
			keys:              [".fruux.com"],
			checkCredentials:  "https://dav.fruux.com/"
		},
		{ //GoDaddy
			name:              "GoDaddy",
			keys:              [".secureserver.net/"],
			calendar:          "https://caldav.secureserver.net/principals/users/",
			checkCredentials:  "https://caldav.secureserver.net/principals/users/"
		},
		{ //Meeting Maker Server
			name:              "Meeting Maker",
			keys:              ["/mmcaldav/"],
			needPrefix:        true,
			calendar:          "%URL_PREFIX%dav/%USERNAME%/",
			checkCredentials:  "%URL_PREFIX%dav/%USERNAME%/"
		},
		{
			keys:              [".folio.fabasoft.com"],
			calendar:          "https://at.folio.fabasoft.com/folio/caldav/",
			checkCredentials:  "https://at.folio.fabasoft.com/folio/caldav/"
		},
		{
			name:              "Terminland.de",
			keys:              ["terminland.de"],
			calendar:          "https://www.terminland.de/%USERNAME%/dav/",
			checkCredentials:  "https://www.terminland.de/%USERNAME%/dav/"
		},
		{
			name:              "mykolab.com",
			keys:              ["mykolab.com"],
			calendar:          "https://caldav.mykolab.com/calendars/%USERNAME%%40mykolab.com/",
			contact:           "https://carddav.mykolab.com/addressbooks/%USERNAME%%40mykolab.com/",
			checkCredentials:  "https://caldav.mykolab.com/calendars/%USERNAME%%40mykolab.com/"
		},
		{
			name:              "Mail.de",
			keys:              [".mail.de"],
			calendar:          "https://kalender.mail.de/calendars/%USERNAME%/",
			contact:           "https://adressbuch.mail.de/addressbooks/%USERNAME%/",
			checkCredentials:  "https://kalender.mail.de/calendars/%USERNAME%/"
		},
		{
			name:              "Posteo.de",
			keys:              ["posteo.de"],
			calendar:          "https://posteo.de:8443/calendars/%USERNAME%/",
			contact:           "https://posteo.de:8843/addressbooks/%USERNAME%/",
			checkCredentials:  "https://posteo.de:8443/calendars/"
		},
		{
			name:              "Horde",
			keys:              ["/horde/"],
			needPrefix:        true,
			calendar:          "%URL_PREFIX%rpc.php/calendars/%USERNAME%/",
			contact:           "%URL_PREFIX%rpc.php/principals/%USERNAME%/",
			checkCredentials:  "%URL_PREFIX%rpc.php/calendars/%USERNAME%/"
		},
		{
			name:              "Telnet.be",
			keys:              [".telnet.be"],
			calendar:          "https://mail.telenet.be/dav/%USERNAME%/",
			checkCredentials:  "https://mail.telenet.be/dav/"
		},
		{
			name:              "Web.de",
			keys:              [".web.de"],
			calendar:          "https://caldav.web.de/%USERNAME%/",
			checkCredentials:  "https://caldav.web.de/"
		},
		{
			name:              "Yandex.ru",
			keys:              [".yandex.ru"],
			calendar:          "https://caldav.yandex.ru/",
			contact:           "https://carddav.yandex.ru/",
			checkCredentials:  "https://caldav.yandex.ru/"
		},
		{
			name:              "Aol.com",
			keys:              [".aol.com"],
			calendar:          "https://caldav.aol.com/",
			contact:           "https://carddav.aol.com/",
			checkCredentials:  "https://caldav.aol.com/"
		},
		{
			name:              "Lms.at",
			keys:              [".lms.at/", "//lms.at/"],
			checkCredentials:  "https://lms.at/xocal-dav/"
		},
		{
			name:              "Mailbox.org",
			keys:              [".mailbox.org"],
			checkCredentials:  "https://dav.mailbox.org/"
		}
	],

	processScheme: function (scheme, type, username, prefix) {
		"use strict";
		var newURL = false;
		if (scheme[type]) {
			if (typeof scheme[type] === "string") {
				newURL = scheme[type];
				if (scheme.needPrefix) {
					Log.debug("Prefix: ", prefix);
					newURL = newURL.replace("%URL_PREFIX%", prefix);
				}
				newURL = newURL.replace("%USERNAME%", username); //This will only replace once.
				Log.debug("Returning new URL: ", newURL);
				return newURL;
			}
			//else
			return scheme[type];
		}
	},

	/**
	 * Resolve url to known c+dav url parts.
	 * @param url the given url.
	 * @param username given username, will be inserted into URL if necessary.
	 * @param type what type of URL to extract one of ["calendar", "contact", "checkCredentials"]
	 */
	resolveURL: function (url, username, type, forceScheme) {
		"use strict";
		var i, j, scheme, index, prefix, newURL, searchUrl, tmpUrl;
		if (!url) {
			url = "";
		}
		searchUrl = url.toLowerCase();
		Log.debug("Resolving ", url);

		if (forceScheme && this.urlSchemes[forceScheme]) {
			scheme = this.urlSchemes[forceScheme];
			Log.debug("Forcing scheme to ", scheme);
			if (scheme.needPrefix) {
				tmpUrl = url;
				if (url.charAt(url.length - 1) !== "/") {
					tmpUrl += "/";
				}
				Log.debug("Setting url prefix: ", tmpUrl);
			}
			return this.processScheme(scheme, type, username, tmpUrl || url);
		}

		for (i = 0; i < this.urlSchemes.length; i += 1) {
			scheme = this.urlSchemes[i];
			for (j = 0; j < scheme.keys.length; j += 1) {
				index = searchUrl.indexOf(scheme.keys[j].toLowerCase());
				if (index >= 0) {
					Log.debug("Found URL for scheme ", scheme);
					if (scheme.needPrefix) {
						tmpUrl = url.substring(0, index + scheme.keys[j].length); //create prefix from original URL to keep case.
					}
					newURL = this.processScheme(scheme, type, username, tmpUrl || url);
					if (newURL) {
						return newURL;
					}
				}
			}
		}

		return false;
	}
};
