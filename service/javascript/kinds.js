/*jslint node: true */
/************************************************************
Contains global kinds references - NOT USED BY CONFIGURATOR
*************************************************************/
var Kinds = {
	objects: {
		calendar: {
			name: "calendar",
			identifier: "org.webosports.cdav.calendar",
			id: "org.webosports.cdav.calendar:1",
			connected_kind: "calendarevent",
			allowUpsync: false
		},
		calendarevent: {
			name: "calendarevent",
			identifier: "org.webosports.cdav.calendarevent",
			id: "org.webosports.cdav.calendarevent:1",
			connected_kind: "calendar",
			allowUpsync: false
		},
		contactset: {
			name: "contactset",
			identifier: "org.webosports.cdav.contactset",
			id: "org.webosports.cdav.contactset:1",
			connected_kind: "contact",
			allowUpsync: false
		},
		contact: {
			name: "contact",
			identifier: "org.webosports.cdav.contact",
			id: "org.webosports.cdav.contact:1",
			connected_kind: "contactset",
			allowUpsync: false
		},
		task: {
			name: "task",
			identifier: "org.webosports.cdav.task",
			id: "org.webosports.cdav.task:1",
			allowUpsync: false
		}
	},
	account: {
		id: "com.palm.account:1",
		metadata_id: "org.webosports.cdav.account.contacts:1" //prevent some errors for check credentials and stuff, but this should not really be used...
	},
	accountConfig: {
		id: "org.webosports.cdav.account.config:1"
	}
};

exports.KindsContacts = {
	objects: {
		contactset: {
			name: "contactset",
			identifier: "org.webosports.cdav.contactset",
			id: "org.webosports.cdav.contactset:1",
			connected_kind: "contact",
			allowUpsync: false
		},
		contact: {
			name: "contact",
			identifier: "org.webosports.cdav.contact",
			id: "org.webosports.cdav.contact:1",
			connected_kind: "contactset",
			allowUpsync: false
		}
	},
	account: {
		id: "com.palm.account:1",
		metadata_id: "org.webosports.cdav.account.contacts:1"
	},
	syncOrder: [
		Kinds.objects.contactset.name,
		Kinds.objects.contact.name
	]
};

exports.KindsCalendar = {
	objects: {
		calendar: {
			name: "calendar",
			identifier: "org.webosports.cdav.calendar",
			id: "org.webosports.cdav.calendar:1",
			connected_kind: "calendarevent",
			allowUpsync: false
		},
		calendarevent: {
			name: "calendarevent",
			identifier: "org.webosports.cdav.calendarevent",
			id: "org.webosports.cdav.calendarevent:1",
			connected_kind: "calendar",
			allowUpsync: false
		}
	},
	account: {
		id: "com.palm.account:1",
		metadata_id: "org.webosports.cdav.account.calendar:1"
	},
	syncOrder: [
		Kinds.objects.calendar.name,
		Kinds.objects.calendarevent.name
	]
};

//general syncOrder should not be used.
Kinds.syncOrder = [
	Kinds.objects.calendar.name,
	Kinds.objects.calendarevent.name,
	Kinds.objects.contactset.name,
	Kinds.objects.contact.name
];

exports.Kinds = Kinds;
