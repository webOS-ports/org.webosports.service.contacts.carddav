/************************************************************
Contains global kinds references - NOT USED BY CONFIGURATOR
*************************************************************/
var Kinds = {
	objects: {
		//all those could also have a metadata_id field. We don't use that.
		//if one wants to store more transport data, one can create another DB kind
		//and put that into the metadata_id field.
		calendar: {
			name: "calendar",
			identifier: "org.webosports.service.contacts.carddav.calendar",
			id: "org.webosports.service.contacts.carddav.calendar:1",
			connected_kind: "calendarevent",
			allowUpsync: false
		},
		calendarevent: {
			name: "calendarevent",
			identifier: "org.webosports.service.contacts.carddav.calendarevent",
			id: "org.webosports.service.contacts.carddav.calendarevent:1",
			connected_kind: "calendar",
			allowUpsync: false
		},
		contactset: {
			name: "contactset",
			identifier: "org.webosports.service.contacts.carddav.contactset",
			id: "org.webosports.service.contacts.carddav.contactset:1",
			connected_kind: "contact",
			allowUpsync: false
		},
		contact: {
			name: "contact",
			identifier: "org.webosports.service.contacts.carddav.contact",
			id: "org.webosports.service.contacts.carddav.contact:1",
			connected_kind: "contactset",
			allowUpsync: false
		},
		task: {
			name: "task",
			identifier: "org.webosports.service.contacts.carddav.task",
			id: "org.webosports.service.contacts.carddav.task:1",
			allowUpsync: false
		}
	},
	account: {
		id: "com.palm.account:1",
		metadata_id: "org.webosports.service.contacts.carddav.account:1"
	}
};

Kinds.syncOrder = [
	Kinds.objects.contactset.name,
	Kinds.objects.contact.name,
	Kinds.objects.calendar.name,
	Kinds.objects.calendarevent.name
];
