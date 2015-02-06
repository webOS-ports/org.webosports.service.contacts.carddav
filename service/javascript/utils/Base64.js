//Simple base64 encoder/decoder using node buffers
var Base64 = {
	/**
	 * Encodes utf8 data to base64
	 * @param utf8-string to be encoded
	 * @return base64 representation of string.
	 */
	encode : function (utf8Data) {
		"use strict";
		var localBase64 = new Buffer(utf8Data, "utf8");
		return localBase64.toString("base64");
	},

	/**
	 * Dencodes utf8 data from base64
	 * @param base64 representation of string.
	 * @return decoded utf8-string
	 */
	decode : function (base64Data) {
		"use strict";
		var localUTF8 = new Buffer(base64Data, "base64");
		return localUTF8.toString("utf8");
	}
};

module.exports = Base64;
