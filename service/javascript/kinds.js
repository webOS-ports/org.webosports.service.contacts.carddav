/************************************************************
Contains global kinds references - NOT USED BY CONFIGURATOR
*************************************************************/
var Kinds = {
    objects: {
		calendar: {
			name: "calendar",
			identifier: "org.webosports.service.contacts.carddav.calendar",
			id: "org.webosports.service.contacts.carddav.calendar:1"
		},
        calendarevent: {
            name: "calendarevent",
            identifier: "org.webosports.service.contacts.carddav.calendarevent",
            id: "org.webosports.service.contacts.carddav.calendarevent:1",
            //metadata_id: "org.webosports.service.contacts.carddav.calendarevent.transport:1" //not used right now. uri & etag are stored in objects directly
        },
        contact: {
            name: "contact",
            identifier: "org.webosports.service.contacts.carddav.contact",
            id: "org.webosports.service.contacts.carddav.contact:1",
            //metadata_id: "org.webosports.service.contacts.carddav.contact.transport:1" //see above.
        }
    },
    account: {
        id: "com.palm.account:1",
        metadata_id: "org.webosports.service.contacts.carddav.account:1"
    }
};

Kinds.syncOrder = [
    Kinds.objects.contact.name,
    //Kinds.objects.calendarevent.name
];
