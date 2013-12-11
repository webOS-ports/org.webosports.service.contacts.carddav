/************************************************************
Contains global kinds references - NOT USED BY CONFIGURATOR
*************************************************************/
var Kinds = {
	objects: {
		calendar: {
			name: "calendar",
			identifier: "org.webosports.cdav.calendar", //needs to be identical to account-template id for this capability
			id: "org.webosports.cdav.calendar:1",
			connected_kind: "calendarevent",
			allowUpsync: false
		},
		calendarevent: {
			name: "calendarevent",
			identifier: "org.webosports.cdav.calendarevent",
			id: "org.webosports.cdav.calendarevent:1",
			connected_kind: "calendar",
			allowUpsync: true
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
			identifier: "org.webosports.cdav.contact", //needs to be identical to account-template id for this capability
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
		metadata_id: "org.webosports.cdav.account:1"
	},
	accountConfig: {
		id: "org.webosports.cdav.account.config:1"
	}
};

Kinds.syncOrder = [
	Kinds.objects.contactset.name,
	Kinds.objects.contact.name,
	Kinds.objects.calendar.name,
	Kinds.objects.calendarevent.name
];
