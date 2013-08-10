Summary
=======

Node.js service to provide synergy connector for carddav.

In its current status it is non-functional.

Roadmap would look roughly like this:
* Choose a webdav client lib for node to get a file listing in the
  addressbook folder.
* Parse the vards with one of the available vcard parsers out there
  and put it into DB8.
* Do regular sync with the Activity Manager
* Implement two way sync
* Implement addressbook detection with .well-known and DAV magic.
* Add calDAV support for calendar events
* Add tasks support via calDAV VTODO items

No timeline is given for this. Pull requests are always welcome.
