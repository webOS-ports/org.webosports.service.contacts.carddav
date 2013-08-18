function AppAssistant(appController) {
}

AppAssistant.prototype.setup = function() {
};

AppAssistant.prototype.handleLaunch = function(launchParams) {
	Mojo.Log.error("--> AppAssistant.prototype.handleLaunch");
	Mojo.Log.error("--> LaunchParams: " + JSON.stringify(launchParams));
	
	//the following check is necessary to prevent the app from spawning a new stage when custom validator is called from accounts app
	var cardStageController = this.controller.getStageController("stage");
	if (!cardStageController) {
		this.controller.createStageWithCallback("stage", function(r) { log("Stage created."); r.pushScene({name: "accountSetup"}); } );
	}
	Mojo.Log.error("<-- AppAssistant.prototype.handleLaunch");
};
