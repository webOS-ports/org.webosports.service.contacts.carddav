function AppAssistant(appController) {
  Mojo.Log.info("--> AppAssistant Constructor");
  Mojo.Log.info("<-- AppAssistant Constructor");
}

AppAssistant.prototype.setup = function() {
  Mojo.Log.info("Enter AppAssistant.prototype.setup");
  Mojo.Log.info("Exit AppAssistant.prototype.setup");
};

AppAssistant.prototype.handleLaunch = function(launchParams) {
  Mojo.Log.info("--> AppAssistant.prototype.handleLaunch");
	
	//the following check is necessary to prevent the app from spawning a new stage when custom validator is called from accounts app
  var cardStageController = this.controller.getStageController("stage");
	console.error("CardStageController:  " + cardStageController);
  if (!cardStageController) {
    this.controller.createStageWithCallback("stage", function(r) { log("Stage created."); r.pushScene({name: "welcome"}); } );
  }
  Mojo.Log.info("<-- AppAssistant.prototype.handleLaunch");
};
