/*jslint node: true */
/*global Future, httpClient, checkResult */

/*
 * Google sign-in: authorization code with PKCE, for a "Desktop app" OAuth client.
 *
 * The account app shows the authorize URL in a window whose redirect WAM catches
 * (oauthWindow.js), so nothing has to listen on http://localhost. The service can
 * exit while the user signs in, so the verifier and state go back to the app with
 * the URL, and the verifier comes back with the code. Web security keeps the app
 * page from calling the token endpoint itself, so that happens here.
 */
var GoogleOAuth = (function () {
	"use strict";
	var crypto = require("crypto"),
		AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth",
		TOKEN_URL = "https://oauth2.googleapis.com/token",
		USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo",
		REDIRECT_URI = "http://localhost/cdav/oauth2callback",
		SCOPE = [
			"https://www.googleapis.com/auth/calendar",
			"https://www.googleapis.com/auth/carddav",
			"https://www.googleapis.com/auth/contacts",
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile"
		].join(" ");

	function base64url(buffer) {
		return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	function form(fields) {
		return Object.keys(fields).map(function (key) {
			return encodeURIComponent(key) + "=" + encodeURIComponent(fields[key]);
		}).join("&");
	}

	function parseJson(text) {
		try {
			return JSON.parse(String(text));
		} catch (e) {
			return null;
		}
	}

	function request(method, url, headers, data) {
		var options = {method: method, headers: headers};
		httpClient.parseURLIntoOptions(url, options);
		return httpClient.sendRequest(options, data);
	}

	return {
		redirectUri: REDIRECT_URI,

		/**
		 * @param args clientId, optional loginHint
		 * @return url to show, and the state and codeVerifier to keep until the redirect.
		 */
		start: function (args) {
			var state, verifier, challenge, url;

			if (!args || !args.clientId) {
				return {returnValue: false, error: "missing_client"};
			}
			state = base64url(crypto.randomBytes(16));
			verifier = base64url(crypto.randomBytes(32));
			challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
			url = AUTHORIZE_URL + "?" + form({
				client_id: args.clientId,
				response_type: "code",
				redirect_uri: REDIRECT_URI,
				scope: SCOPE,
				state: state,
				code_challenge: challenge,
				code_challenge_method: "S256",
				access_type: "offline", //a refresh token, so sync keeps working
				prompt: "consent"       //Google sends that token only on consent
			});
			if (args.loginHint) {
				url += "&login_hint=" + encodeURIComponent(args.loginHint);
			}
			return {returnValue: true, url: url, state: state, codeVerifier: verifier, redirectUri: REDIRECT_URI};
		},

		/**
		 * @param args code, codeVerifier, clientId, clientSecret
		 * @return future with the tokens and the account's email, or error: the OAuth error code.
		 */
		exchange: function (args) {
			var future = new Future(), tokens;

			if (!args || !args.code || !args.codeVerifier || !args.clientId || !args.clientSecret) {
				future.result = {returnValue: false, error: "missing_parameter"};
				return future;
			}

			future.nest(request("POST", TOKEN_URL, {"Content-Type": "application/x-www-form-urlencoded"}, form({
				grant_type: "authorization_code",
				code: args.code,
				code_verifier: args.codeVerifier,
				client_id: args.clientId,
				client_secret: args.clientSecret,
				redirect_uri: REDIRECT_URI
			})));

			future.then(function () {
				var result = checkResult(future), body = parseJson(result.body);
				if (result.returnCode !== 200 || !body || !body.access_token) {
					future.result = {
						returnValue: false,
						error: (body && typeof body.error === "string") ? body.error : "token_request_failed"
					};
					return;
				}
				tokens = body;
				future.nest(request("GET", USERINFO_URL, {Authorization: "Bearer " + tokens.access_token}, ""));
			});

			future.then(function () {
				var result = checkResult(future), body;
				if (!tokens) {
					future.result = result;
					return;
				}
				body = parseJson(result.body);
				if (result.returnCode !== 200 || !body || !body.email) {
					future.result = {returnValue: false, error: "userinfo_failed"};
					return;
				}
				future.result = {
					returnValue: true,
					access_token: tokens.access_token,
					refresh_token: tokens.refresh_token,
					token_type: tokens.token_type,
					expires_in: tokens.expires_in,
					refresh_url: TOKEN_URL,
					email: body.email
				};
			});

			return future;
		}
	};
}());

module.exports = GoogleOAuth;
