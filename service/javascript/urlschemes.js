/*global Log */
/*exported UrlSchemes*/

var UrlSchemes = {
    //known url schemes.
    //idea: search user supplied URL for "key"
    //replace URL for checkCredentials, caldav and carddav with known URLs.
    //issue: some require user specific parts in URL, replace them on useage...
    //       if a replacement is required more than once, change function!
    urlSchemes: [
        {
            //contact & calendar hostname vary for each user, it seems.
            keys:              ["icloud.com"],
            checkCredentials:  "https://p02-contacts.icloud.com:443"
        },
        {
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
            keys:              ["/owncloud/", "cloudu.de"],
            //issue: calendar/contact contain display name, which we don't know and can be different from username??
            calendar:          "%URL_PREFIX%remote.php/caldav/calendars/%USERNAME%/",
            contact:           "%URL_PREFIX%remote.php/carddav/addressbooks/%USERNAME%/",
            checkCredentials:  "%URL_PREFIX%remote.php/caldav"
        },
        {
            keys:              ["/egroupware/"],
            calendar:          "%URL_PREFIX%groupdav.php/%USERNAME%/",
            contact:           "%URL_PREFIX%groupdav.php/%USERNAME%/",
            checkCredentials:  "%URL_PREFIX%groupdav.php",
            additionalConfig: {
                preventDuplicateCalendarEntries: true
            }
        },
        {
            keys:              ["/SOGo/"],
            calendar:          "%URL_PREFIX%dav/%USERNAME%/Calendar/",
            contact:           "%URL_PREFIX%dav/%USERNAME%/Contacts/",
            checkCredentials:  "%URL_PREFIX%dav/%USERNAME%/"
        },
        {
            keys:              ["/sabredav/"],
            calendar:          "%URL_PREFIX%calendarserver.php/calendars/%USERNAME%/default/",
            contact:           "%URL_PREFIX%addressbookserver.php/addressbooks/%USERNAME%/",
            checkCredentials:  "%URL_PREFIX%calendarserver.php/calendars/%USERNAME%/default/"
        },
        { //GoDaddy
            keys:              [".secureserver.net/"],
            calendar:          "https://caldav.secureserver.net/principals/users/",
            checkCredentials:  "https://caldav.secureserver.net/principals/users/"
        },
        { //Meeting Maker Server
            keys:              ["/mmcaldav/"],
            calendar:          "%URL_PREFIX%dav/%USERNAME%/",
            checkCredentials:  "%URL_PREFIX%dav/%USERNAME%/"
        },
        {
            keys:              [".folio.fabasoft.com"],
            calendar:          "https://at.folio.fabasoft.com/folio/caldav/",
            checkCredentials:  "https://at.folio.fabasoft.com/folio/caldav/"
        },
        {
            keys:              ["terminland.de"],
            calendar:          "https://www.terminland.de/%USERNAME%/dav/",
            checkCredentials:  "https://www.terminland.de/%USERNAME%/dav/"
        },
        {
            keys:              ["mykolab.com"],
            calendar:          "https://caldav.mykolab.com/calendars/%USERNAME%%40mykolab.com/",
            contact:           "https://carddav.mykolab.com/addressbooks/%USERNAME%%40mykolab.com/",
            checkCredentials:  "https://caldav.mykolab.com/calendars/%USERNAME%%40mykolab.com/"
        },
        {
            keys:              [".mail.de"],
            calendar:          "https://kalender.mail.de/calendars/%USERNAME%/",
            contact:           "https://adressbuch.mail.de/addressbooks/%USERNAME%/",
            checkCredentials:  "https://kalender.mail.de/calendars/%USERNAME%/"
        },
        {
            keys:              ["posteo.de"],
            calendar:          "https://posteo.de:8443/calendars/%USERNAME%/",
            contact:           "https://posteo.de:8843/addressbooks/%USERNAME%/",
            checkCredentials:  "https://posteo.de:8443/calendars/"
        },
        {
            keys:              ["/horde/"],
            calendar:          "%URL_PREFIX%rpc.php/calendars/%USERNAME%/",
            contact:           "%URL_PREFIX%rpc.php/principals/%USERNAME%/",
            checkCredentials:  "%URL_PREFIX%rpc.php/calendars/%USERNAME%/"
        },
        {
            keys:              [".telnet.be"],
            calendar:          "https://mail.telenet.be/dav/%USERNAME%/",
            checkCredentials:  "https://mail.telenet.be/dav/"
        },
        {
            keys:              [".web.de"],
            calendar:          "https://caldav.web.de/%USERNAME%/",
            checkCredentials:  "https://caldav.web.de/"
        },
        {
            keys:              [".yandex.ru"],
            calendar:          "https://caldav.yandex.ru/",
            contact:           "https://carddav.yandex.ru/",
            checkCredentials:  "https://caldav.yandex.ru/"
        },
        {
            keys:              [".aol.com"],
            calendar:          "https://caldav.aol.com/",
            contact:           "https://carddav.aol.com/",
            checkCredentials:  "https://caldav.aol.com/"
        },
        {
            keys:              [".lms.at/", "//lms.at/"],
            checkCredentials:  "https://lms.at/xocal-dav/"
        },
        {
            keys:              [".lms.at/", "//lms.at/"],
            checkCredentials:  "https://lms.at/xocal-dav/"
        },
        {
            keys:              [".fruux.com"],
            checkCredentials:  "https://dav.fruux.com/"
        },
        {
            keys:              [".mailbox.org"],
            checkCredentials:  "https://dav.mailbox.org/"
        }
    ],

    /**
     * Resolve url to known c+dav url parts.
     * @param url the given url.
     * @param username given username, will be inserted into URL if necessary.
     * @param type what type of URL to extract one of ["calendar", "contact", "checkCredentials"]
     */
    resolveURL: function (url, username, type) {
        "use strict";
        var i, j, scheme, index, prefix, newURL, searchUrl;
        searchUrl = url.toLowerCase();
        Log.debug("Resolving ", url);

        for (i = 0; i < this.urlSchemes.length; i += 1) {
            scheme = this.urlSchemes[i];
            for (j = 0; j < scheme.keys.length; j += 1) {
                index = searchUrl.indexOf(scheme.keys[j].toLowerCase());
                if (index >= 0) {
                    Log.debug("Found URL for scheme ", scheme);
                    prefix = url.substring(0, index + scheme.keys[j].length); //create prefix from original URL to keep case.
                    Log.debug("Prefix: ", prefix);
                    if (scheme[type]) {
                        if (typeof scheme[type] === "string") {
                            newURL = scheme[type].replace("%URL_PREFIX%", prefix);
                            newURL = newURL.replace("%USERNAME%", username); //This will only replace once.
                            Log.debug("Returning new URL: ", newURL);
                            return newURL;
                        }
                        //else
                        return scheme[type];
                    }
                }
            }
        }

        return false;
    }
};
