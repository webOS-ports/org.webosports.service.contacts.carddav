/*global enyo, window, navigator */
/*
 * OAuthWindow — hosts an OAuth2 sign-in page on builds that have no NPAPI browser plugin.
 *
 * Legacy webOS renders the sign-in page inline in an Atlas-routed enyo.BasicWebView. LuneOS
 * (WAM/Chromium) has no NPAPI at all, so that control can never paint there — and an <iframe>
 * is not a substitute either: Google answers the authorize URL with X-Frame-Options: DENY, and
 * Microsoft's login page frame-busts, navigating the host app's own window away. What LuneOS
 * does have is window.open(), which builds a real top-level WAM window that neither restriction
 * applies to.
 *
 * Capturing the redirect needs these mechanisms, because providers split into two kinds:
 *
 *   http/https redirect_uri (every cloud connector, Tidal)
 *       WAM watches the window for it: window.open() passes the prefix as
 *       attributes={"redirectPrefix": ...}, and WAM reports to this page with a
 *       'webOSOAuthWindow' event, detail {state, url}: "watching" right after the window
 *       opens, then "redirect" (WAM has stopped and closed the window; url is the redirect, code
 *       included) or "closed" (it went without one). WAM matches where navigations start,
 *       commit and fail to load, so a redirect_uri nothing serves (http://localhost/...) is
 *       caught, and it tells this page itself, so the provider's Cross-Origin-Opener-Policy
 *       (Koofr, Tidal), which cuts the window off from this page, does not matter.
 *
 *       A WAM without that watch sends no "watching". Then the window's location is polled.
 *       The renderers do not run with --disable-web-security, so that only works while the
 *       window is same-origin with this page: WAM's own load-error page, which a redirect to an
 *       unserved localhost URL turns into (unwrapLoadError), and nothing else.
 *
 *   native scheme (Teams: msauth.<client>://auth)
 *       The engine cannot load that scheme, so it aborts the navigation and location never
 *       changes — polling alone would wait forever. WAM watches these the same way, catching
 *       the redirect where the load is aborted, and reports it with the same events.
 *
 *       A WAM that watches only http(s) sends no "watching" for these. It still reports the
 *       aborted URL as a 'webOSExternalProtocol' event (NotifyExternalProtocolNavigation), but
 *       only to the window and, from there, to this page — which fails whenever the provider's
 *       login page runs in a renderer of its own, as Microsoft's does: this page is then out of
 *       its reach (SecurityError).
 *
 * Both are armed at once and whichever fires first wins, so a caller does not have to know
 * which kind of redirect its provider uses.
 */
(function () {
	var OAuthWindow = {

		// enyo.BasicWebView renders an NPAPI <object>, so it only works where the plugin exists.
		// Test the capability rather than the OS: LuneOS reports no mime types at all, and the
		// deviceInfo that older code checked carries no OS name (modelName is the machine, e.g.
		// "qemux86-64", so a `modelName === "LuneOS Device"` test matches nothing).
		hasPluginWebView: function () {
			try {
				return !!(navigator.mimeTypes && navigator.mimeTypes["application/x-palm-browser"]);
			} catch (e) {
				return false;
			}
		},

		// WAM watches an http(s) prefix with a host, or one of an app's own scheme with
		// something after the "://" (web_page_blink.cc IsWatchableRedirectPrefix); for anything
		// else the window is polled.
		watchable: function (prefix) {
			prefix = prefix || "";
			if (/^https?:/i.test(prefix)) { return /^https?:\/\/[^\/]/i.test(prefix); }
			var m = /^([a-z][a-z0-9+.\-]*):\/\/[^\/]/i.exec(prefix);
			return !!m && !/^(file|about|data|blob|javascript|ws|wss|chrome|filesystem|view-source)$/i.test(m[1]);
		},

		// A redirect pattern (a PCRE pattern the url must match from its start, for where no
		// prefix tells the redirect from the pages before it) can only go into the features
		// without what splits them: commas, white space and "=".
		patternFits: function (pattern) {
			return !!pattern && !/[,=\s]/.test(pattern);
		},

		// The window.open() features: the caller's, plus WAM's redirect watch where it applies.
		// Chromium lowercases the whole string before WAM sees it; WAM accepts the keys and
		// matches the prefix and the pattern either way, and reports the redirect with its case
		// intact. A WAM without redirectPattern ignores it and watches nothing for it.
		features: function (opts) {
			var f = opts.features || "", watch = {}, any = false;
			if (f.toLowerCase().indexOf("attributes=") >= 0) { return f; }
			if (this.watchable(opts.redirectPrefix)) { watch.redirectPrefix = opts.redirectPrefix; any = true; }
			if (this.patternFits(opts.redirectPattern)) { watch.redirectPattern = opts.redirectPattern; any = true; }
			if (!any) { return f; }
			var attrs = "attributes=" + JSON.stringify(watch);
			return f ? f + "," + attrs : attrs;
		},

		// A redirect_uri that nothing on the device serves (Box's http://localhost/...) fails to
		// load, and WAM swaps in its error page, which carries the URL it could not load:
		//   file:///usr/share/localization/wam/loaderror.html?errorCode=-102&failedUrl=<url>
		// The window's location is then that page, so take the redirect from failedUrl.
		unwrapLoadError: function (url) {
			if (!url || url.indexOf("/wam/loaderror.html?") < 0) { return url; }
			var m = /[?&]failedUrl=([^&#]*)/.exec(url);
			if (!m) { return url; }
			try { return decodeURIComponent(m[1]); } catch (e) { return url; }
		},

		// A redirect matches when it starts with the expected redirect_uri. With no prefix to go
		// on, fall back to "carries an OAuth result", which is what the native-scheme providers
		// give us — the engine reports those URLs verbatim.
		matches: function (url, prefix, pattern) {
			if (!url) { return false; }
			if (pattern) {
				var re;
				try { re = new RegExp("^(?:" + pattern + ")", "i"); } catch (e) { return false; }
				if (!re.test(url)) { return false; }
				if (!prefix) { return true; }
			}
			if (prefix) { return url.indexOf(prefix) === 0; }
			return url.indexOf("code=") >= 0 || url.indexOf("error=") >= 0;
		},

		/*
		 * Open the sign-in page and watch for the redirect.
		 *
		 *   url             authorize URL to load
		 *   redirectPrefix  expected redirect_uri; omit to match any URL carrying code=/error=
 *   redirectPattern a PCRE (and JavaScript) pattern the redirect matches from its start, with
 *                   no commas, spaces or "=" (see patternFits); with a prefix, both must hold
		 *   onRedirect(url) called once, with the captured redirect URL
		 *   onError(msg)    called once, on failure/timeout/user-closed
		 *   timeoutMs       overall deadline (default 240s, matching the inline WebView flow)
		 *
		 * Returns a handle with close(), safe to call more than once.
		 */
		open: function (opts) {
			opts = opts || {};
			var self = this,
				done = false,
				win = null,
				poll = null,
				deadline = null,
				watched = false; // WAM confirmed it watches this window

			function cleanup() {
				if (poll) { window.clearInterval(poll); poll = null; }
				if (deadline) { window.clearTimeout(deadline); deadline = null; }
				try { window.removeEventListener("webOSExternalProtocol", onExternal, false); } catch (e) {}
				try { window.removeEventListener("webOSOAuthWindow", onWatch, false); } catch (e1) {}
				if (win) {
					try { win.close(); } catch (e2) {}
					win = null;
				}
			}

			function hit(url) {
				if (done) { return; }
				done = true;
				cleanup();
				if (opts.onRedirect) { opts.onRedirect(url); }
			}

			function fail(msg) {
				if (done) { return; }
				done = true;
				cleanup();
				if (opts.onError) { opts.onError(msg); }
			}

			function onExternal(ev) {
				var url = ev && ev.detail && ev.detail.url;
				if (self.matches(url, opts.redirectPrefix, opts.redirectPattern)) { hit(url); }
			}

			function onWatch(ev) {
				var d = (ev && ev.detail) || {};
				if (d.state === "watching") { watched = true; }
				else if (d.state === "redirect" && d.url) { hit(d.url); }
				else if (d.state === "closed") { fail("Sign-in was cancelled."); }
			}

			// Arm both paths before opening: a redirect can land immediately (a cached Microsoft
			// session signs in without showing a page), and WAM sends "watching" as the window
			// opens. A redirect URL left from an earlier sign-in must not count for this one.
			window.addEventListener("webOSExternalProtocol", onExternal, false);
			window.addEventListener("webOSOAuthWindow", onWatch, false);
			try { window.webOSOAuthRedirectUrl = undefined; } catch (e0) {}

			// No size by default: WAM makes a window.open() window a card like the app's own, and
			// "height=600" made it a 600 px surface in the 679 px card slot on a 480x800 phone,
			// which the keyboard then left a band of wallpaper above (MindPhone, Box sign-in).
			try {
				win = window.open(opts.url, opts.name || "oauth", self.features(opts));
			} catch (e) {
				win = null;
			}
			if (!win) {
				fail("Could not open the sign-in window.");
				return { close: function () { cleanup(); } };
			}

			poll = window.setInterval(function () {
				if (done) { return; }

				if (watched) {
					// WAM reports on its own; this only catches a "redirect" event that was missed.
					// The window cannot be polled: Cross-Origin-Opener-Policy makes win.closed true
					// while it is still open.
					var reported = null;
					try { reported = window.webOSOAuthRedirectUrl; } catch (e4) {}
					if (reported) { hit(String(reported)); }
					return;
				}

				var here = null;
				// A cross-origin location throws (the renderers keep web security); only WAM's
				// load-error page, same-origin with this one, reads.
				try { here = self.unwrapLoadError(String(win.location.href)); } catch (e) {}
				if (self.matches(here, opts.redirectPrefix, opts.redirectPattern)) { hit(here); return; }

				// WAM also stamps the aborted native-scheme URL onto the window, which covers a
				// redirect that fired before the listener was attached.
				var stamped = null;
				try { stamped = win.webOSExternalProtocolUrl || window.webOSExternalProtocolUrl; } catch (e2) {}
				if (self.matches(stamped, opts.redirectPrefix, opts.redirectPattern)) { hit(stamped); return; }

				var closed = false;
				try { closed = win.closed; } catch (e3) {}
				if (closed) { fail("Sign-in was cancelled."); }
			}, 400);

			deadline = window.setTimeout(function () {
				fail("Sign-in timed out — please try again.");
			}, opts.timeoutMs || 240000);

			return { close: function () { cleanup(); } };
		}
	};

	window.OAuthWindow = OAuthWindow;
}());
