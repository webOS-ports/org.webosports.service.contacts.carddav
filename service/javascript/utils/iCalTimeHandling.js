/*jslint node: true */
/*global Calendar, Log, Future, checkResult */

//Only for time and timezone handling. Ahrg.

var Time = (function () {
	"use strict";
	var DATETIME = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(Z?)$/,
		DATE = /^(\d{4})(\d\d)(\d\d)$/,
		//DATE: yyyymmdd, time: hhmmss, if both are present they are divided by a T. A Z at the end is optional.
		//if only a Date is given (=> allDay), no letters are present and just 8 numbers should be given.
		//Usually the Z at the end of DATE-TIME should say that it's UTC. But I'm quite sure that most programs do this wrong... :(
		//there is a timezone property that could be set.
		//it could also be a comma seperated list of dates / date times. But we don't support that, yet.. ;)
		//used to try timeZone correction...
		TZManager = Calendar.TimezoneManager(),
		TZManagerInitialized = false,
		shiftAllDay = true;

	/**
	 * Converts iCal time string of format YYYYMMDDTHHMM(Z) into javascript timestamp (from local timezone or UTC of Z is present).
	 */
	function iCalTimeToWebOsTime(time) {
		var t = 0, result, date, utc = time.charAt(time.length - 1) === "Z",
			allDayCue = !DATETIME.test(time);

		if (allDayCue) {
			//only have DATE, add hours, minutes, and seconds
			result = DATE.exec(time);
			result.push(12); //use 12 here, so that time is in the middle of day and timezone changes, i.e. daylight saving times, won't spread all day events to multiple days.
			result.push(0);
			result.push(0);
		} else {
			//have date and time:
			result = DATETIME.exec(time);
		}
		//look at tzId. Shift whole thing that we have all day events on the right day, no matter the TZ.
		date = new Date(result[1], result[2] - 1, result[3], result[4], result[5], result[6]);
		if (!utc) {
			//for times in the local tz, this will be ok in any case.
			t = date.getTime();
		} else { //got UTC time, we can easily correct that:
			t = Date.UTC(result[1], result[2] - 1, result[3], result[4], result[5], result[6]); //get UTC timestamp from UTC date values :)
			if (allDayCue && shiftAllDay) { //move to 0:00 in local timeZone.
				t += date.getTimezoneOffset() * 60000;
			}
		}
		return t;
	}

	/**
	 * Converts javascript ts into iCal time string of format YYYYMMDDTHHMM in local TZ.
	 * If allday param is true, only YYYYMMDD will be returned.
	 * If utc param is true, string will be in UTC and a "Z" will be appended.
	 */
	function webOsTimeToICal(time, allDay, utc) {
		var t = "", date;

		date = new Date(time);
		if (utc) {
			if (allDay && shiftAllDay) {
				t = date.getFullYear() + (date.getMonth() + 1 < 10 ? "0" : "") + (date.getMonth() + 1) + (date.getDate() < 10 ? "0" : "") + date.getDate();
			} else {
				t = date.getUTCFullYear() + (date.getUTCMonth() + 1 < 10 ? "0" : "") + (date.getUTCMonth() + 1) + (date.getUTCDate() < 10 ? "0" : "") + date.getUTCDate();
				if (!allDay) {
					t += "T" + (date.getUTCHours() < 10 ? "0" : "") + date.getUTCHours();
					t += (date.getUTCMinutes() < 10 ? "0" : "") + date.getUTCMinutes();
					t += (date.getUTCSeconds() < 10 ? "0" : "") + date.getUTCSeconds();
					t += "Z"; //is a hint that time is in UTC.
				}
			}
		} else {
			t = date.getFullYear() + (date.getMonth() + 1 < 10 ? "0" : "") + (date.getMonth() + 1) + (date.getDate() < 10 ? "0" : "") + date.getDate();
			if (!allDay) {
				t += "T" + (date.getHours() < 10 ? "0" : "") + date.getHours();
				t += (date.getMinutes() < 10 ? "0" : "") + date.getMinutes();
				t += (date.getSeconds() < 10 ? "0" : "") + date.getSeconds();
			}
		}
		return t;
	}

	/**
	 * Convert duration string (for example +P0D) into microseconds to add to javascript timestamps.
	 */
	function convertDurationIntoMicroseconds(duration) {
		var signRegExp = /^([+\-])?PT?([0-9DHM]+)/gi, parts, sign, remaining,
			weekRegExp = /(\d)+W/gi,
			dayRegExp = /(\d)+D/gi,
			hourRegExp = /(\d)+H/gi,
			minuteRegExp = /(\d)+M/gi,
			secondRegExp = /(\d)+S/gi,
			offset = 0;

		parts = signRegExp.exec(duration);
		if (parts) {
			sign = parts[1] === "-" ? -1 : 1;
			remaining = parts[2];

			parts = weekRegExp.exec(remaining);
			if (parts) {
				offset += parseInt(parts[1], 10) * 86400000 * 7;
			}

			parts = dayRegExp.exec(remaining);
			if (parts) {
				offset += parseInt(parts[1], 10) * 86400000;
			}

			parts = hourRegExp.exec(remaining);
			if (parts) {
				offset += parseInt(parts[1], 10) * 3600000;
			}

			parts = minuteRegExp.exec(remaining);
			if (parts) {
				offset += parseInt(parts[1], 10) * 60000;
			}

			parts = secondRegExp.exec(remaining);
			if (parts) {
				offset += parseInt(parts[1], 10) * 1000;
			}

			offset *= sign;
			Log.log_icalDebug("Converted duration " + duration + " into offset " + offset);
			return offset;
		}
		//else
		Log.log("iCal.js======> DURATION DID NOT MATCH: ", duration);
		return 0;
	}

	/**
	 * fetchTimezone information for timezones in the event and years required by the event.
	 */
	function fetchTimezones(events) {
		var timezones = [],
			years = [],
			tsFields = ["dtstart", "dtstamp", "dtend", "created", "lastModified"],
			tsArrays = ["exdates", "rdates", "recurrenceId"];

		events.forEach(function (event) {
			var dtendYear,
				dtstartYear,
				dtend,
				dtstart,
				until;

			timezones.push(event.tzId || TZManager.timezone);

			tsFields.forEach(function (field) {
				if (event[field]) {
					if (typeof event[field] === "object") {
						if (event[field].tzId) {
							timezones.push(event[field].tzId);
						}
						if (event[field].year) {
							Log.log_icalDebug("Adding year ", event[field].year, " from ", field, " which was object: ", event[field]);
							years.push(event[field].year);
						}
						event[field] = iCalTimeToWebOsTime(event[field].value); //overwrite objects with ts here.
					} else {
						var date = new Date(event[field]);
						Log.log_icalDebug("Adding year ", date.getFullYear(), " from ", field, " which was ts? ", event[field]);
						years.push(date.getFullYear());
					}
				}
			});

			tsArrays.forEach(function (field) {
				var i, year;
				if (typeof event[field] === "string") {
					year = parseInt(event[field].substr(0, 4), 10);
					Log.log_icalDebug("Adding year ", year, " from ", field, " which was string");
					years.push(year);
				} else if (event[field] && event[field].length) {
					for (i = 0; i < event[field].length; i += 1) {
						if (typeof event[field][i] === "string") {
							year = parseInt(event[field][i].substr(0, 4), 10);
							Log.log_icalDebug("Adding year ", year, " from ", field, " which was array.");
							years.push(year);
						}
					}
				}
			});

			if (event.rrule && event.rrule.until) {
				Log.log_icalDebug("fetchTimezones(): rrule: ", event.rrule);
				until = new Date(event.rrule.until);
				Log.log_icalDebug("Adding year ", until.getUTCFullYear(), " from rrule.");
				years.push(until.getUTCFullYear());
			}
		});

		Log.log_icalDebug("fetchTimezones(): years: ", years, " for ", timezones);

		return TZManager.loadTimezones(timezones, years);
	}

	function normalizeICalTimeString(value, source, target) {
		if (value) {
			var lastChar = value[value.length - 1],
				oldDate,
				newDate;
			if (lastChar !== "Z" && lastChar !== "z") {
				Log.log_icalDebug("Need to process, because of lastChar: ", lastChar);
				oldDate = iCalTimeToWebOsTime(value); // new Date( event[field][i] );
				newDate = TZManager.convertTime(oldDate, source, target);
				value = webOsTimeToICal(newDate, false, false);
				Log.log_icalDebug("    ", oldDate, " (", new Date(oldDate).toDateString(), ") -> ", newDate, " (", new Date(newDate).toDateString(),  ") value = ", value);
			}
			return value;
		}
	}

	/*
	 * normalize an array of timestamps (i.e. exdates or rdates) for the local timezone
	 */
	function normalizeToLocalTimezoneArray(event, field, direction) {
		if (event[field]) {
			var i,
				oldDate,
				newDate,
				value,
				lastChar,
				source = event.tzId,
				target = TZManager.timezone;
			if (direction === "event") {
				source = TZManager.timezone;
				target = event.tzId;
			}

			Log.log_icalDebug("----CONVERTING ", field, " TZ from ", source, " to ", target, "; ", event[field]);

			for (i = 0; i < event[field].length; i += 1) {
				Log.log_icalDebug("    item ", i, ": ", event[field][i]);
				value = event[field][i];
				event[field][i] = normalizeICalTimeString(value, source, target);
			}
		}
	}

	/**
	 * Normalize events to local timezone or
	 * event in local timezone into the timezone specified by tzId.
	 */
	function normalizeToTimezone(events, direction) {
		var future = fetchTimezones(events),
			tsFields = ["dtstamp", "created", "lastModified"];

		future.then(function (future) {
			future.getResult();

			Log.log_icalDebug("Processing ", events.length, " events.", events);
			events.forEach(function (event) {
				Log.log_icalDebug("normalizeTo", direction, "Timezone(): ");
				var newDtend, oldVal, dt, source = event.tzId, target = TZManager.timezone;
				if (direction === "event") {
					target = event.tzId;
					source = TZManager.timezone;
				}

				if (event.dtstart) {
					Log.log_icalDebug("----CONVERTING TZ from ", source, " to ", target);
					oldVal = event.dtstart;
					event.dtstart = TZManager.convertTime(event.dtstart, source, target);
					Log.log_icalDebug("    ", oldVal, " -> ", event.dtstart);
				}

				if (event.dtend) {
					newDtend = TZManager.convertTime(event.dtend, source, target);
					Log.log_icalDebug("----DTEND EXISTED ", event.dtend, "->", newDtend);
					event.dtend = newDtend;
				} else if (event.duration) {
					event.dtend = event.dtstart + convertDurationIntoMicroseconds(event.duration);
					Log.log_icalDebug("----Created dtend ", event.dtend, " from ", event.duration, " and ", event.dtstart);
					delete event.duration;
				} else if (event.dtstart && !event.recurrenceId) {
					// dtend does not exist; if this is not an exception to another
					// event, synthesize one at the end of the day
					dt = new Date(event.dtstart);
					dt.setHours(23);
					dt.setMinutes(59);
					dt.setSeconds(59);
					newDtend = TZManager.convertTime(dt.getTime(), source, target);
					Log.log_icalDebug("----DTEND DID NOT EXIST ", dt.getTime(), " -> ", newDtend);
					event.dtend = newDtend;
				}

				if (event.recurrenceId) {
					oldVal = event.recurrenceId;
					event.recurrenceId = normalizeICalTimeString(event.recurrenceId, source, target);
					Log.log_icalDebug("----RECURRENCE-ID converted ", oldVal, " to ", event.recurrenceId);
				}

				tsFields.forEach(function (field) {
					var val = event[field];
					if (val) {
						event[field] = TZManager.convertTime(val, source, target);
						Log.log_icalDebug("----", field.toUpperCase(), " converted ", val, " to ", event[field]);
					}
				});

				if (event.rrule && event.rrule.until) {
					event.rrule.until = TZManager.convertTime(
						event.rrule.until,
						source,
						target
					);
				}

				normalizeToLocalTimezoneArray(event, "exdates", direction);
				normalizeToLocalTimezoneArray(event, "rdates", direction);
			});

			future.result = {returnValue: true, events: events};
		});

		return future;
	}

	function normalizeToLocalTimezone(events) {
		return normalizeToTimezone(events, "local");
	}

	function normalizeToEventTimezone(events) {
		return normalizeToTimezone(events, "event");
	}

	return {
		/**
		 * Normalize event to local timezone.
		 * Meant as post processing after ical parsing.
		 * Timestamp members need to be objects with this fields:
		 * { tzId: "", year: "", value: "YYYYMMDD(THHMM(Z))" (required) }
		 */
		normalizeToLocalTimezone: normalizeToLocalTimezone,

		/**
		 * Normalize local timestamps to event timezone
		 * Meant as pre processing before ical generation.
		 */
		normalizeToEventTimezone: normalizeToEventTimezone,

		convertDurationIntoMicroseconds: convertDurationIntoMicroseconds,
		iCalTimeToWebOsTime: iCalTimeToWebOsTime,
		webOsTimeToICal: webOsTimeToICal,

		initialize: function () {
			var future = new Future();
			if (!TZManagerInitialized) {
				Log.log_icalDebug("iCal: init TZManager");
				future.nest(TZManager.setup());
				future.then(this, function tzManagerReturn() {
					checkResult(future);
					Log.log_icalDebug("TZManager initialized");
					TZManagerInitialized = true;
					future.result = { returnValue: true };
				});
			} else { //TZManager already initialized.
				future.result = { returnValue: true };
			}

			return future;
		}

	};
}());

module.exports = Time;
