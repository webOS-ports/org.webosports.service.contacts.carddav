#!/bin/bash

RESULT=org.webosports.cdav_0.3.20_all

rm *.ipk

mv service/javascript/kinds.js service/javascript/kinds_no_upsync.js
mv service/javascript/kinds_upsync.js service/javascript/kinds.js

palm-package package app service accounts accounts-google-mojo accounts-icloud accounts-yahoo

mv $RESULT".ipk" $RESULT"_upsync.ipk"

palm-package package app-enyo service accounts-enyo accounts-google accounts-icloud accounts-yahoo

mv $RESULT".ipk" $RESULT"_enyo_upsync.ipk"

mv service/javascript/kinds.js service/javascript/kinds_upsync.js
mv service/javascript/kinds_no_upsync.js service/javascript/kinds.js

palm-package package app service accounts accounts-google-mojo accounts-icloud accounts-yahoo

mv $RESULT".ipk" $RESULT"_no_upsync.ipk"

palm-package package app-enyo service accounts-enyo accounts-google accounts-icloud accounts-yahoo

mv $RESULT".ipk" $RESULT"_enyo_no_upsync.ipk"

palm-install $RESULT"_upsync.ipk"
