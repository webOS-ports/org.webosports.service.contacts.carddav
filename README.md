Summary
=======

Node.js service to provide synergy connector for CardDav and CalDav.

In its current status it is quite functional.

Currently working:
* Two way sync of contacts and calendar entries
* Periodic sync
* Sync on local changes
* OAuth authorization (currently only Google)
* MDigest authorization
* Retries for downloads and uploads after failed syncs
* Auto discovery of c+dav URLs or setting URL using a list of known servers
* An app to show some statistics and sync status

Roadmap would look roughly like this:
* Add tasks support via calDAV VTODO items
* Improve VCard and VEVENT compability

Known issues:
* On webOS 2.1.* receiving the username for Google accounts does not work for unknown reasons. For the time beeing it will be filled with a random generated number. You can rename the account to something descrptive before creating. The wrong username won't hurt authorization which is done using OAuth 2, i.e. does not require the username and password on device.

No timeline is given for this. Pull requests are always welcome.

Icon source:
http://www.intridea.com/blog/2010/6/1/authbuttons-free-and-open-source-web-logo-icons
https://github.com/intridea/authbuttons

iCloud Icon Source:
http://commons.wikimedia.org/wiki/File:Icloud_logo.PNG (public domain, because it only consists of simple geometric shapes and/or text. It does not meet the threshold of originality needed for copyright protection)
