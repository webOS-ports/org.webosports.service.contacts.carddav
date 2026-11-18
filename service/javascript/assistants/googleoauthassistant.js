/*jslint node: true */
/*global libPath, checkResult */
/*exported GoogleOAuthStart, GoogleOAuthExchange*/

var GoogleOAuth = require(libPath + "GoogleOAuth.js");

var GoogleOAuthStart = function () { "use strict"; };

GoogleOAuthStart.prototype.run = function (outerfuture) {
	"use strict";
	outerfuture.result = GoogleOAuth.start(this.controller.args);
	return outerfuture;
};

var GoogleOAuthExchange = function () { "use strict"; };

GoogleOAuthExchange.prototype.run = function (outerfuture) {
	"use strict";
	var future = GoogleOAuth.exchange(this.controller.args);

	future.then(function () {
		outerfuture.result = checkResult(future);
	});
	return outerfuture;
};
