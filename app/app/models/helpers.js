// Simple logging to app screen - requires target HTML element with id of
// "targOutput"
var logData = function(controller, logInfo) {
    this.targOutput = controller.get("targOutput");
    this.targOutput.innerHTML =  logInfo + "" + this.targOutput.innerHTML;
};
