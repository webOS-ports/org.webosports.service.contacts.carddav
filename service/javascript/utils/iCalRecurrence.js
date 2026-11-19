/*jslint node: true, nomen: true */
/*global Log */

/*
 * Repeats the webOS calendar cannot evaluate itself: repeating by the hour, several times a
 * day, BYSETPOS, a week start other than Monday, RDATE and RANGE=THISANDFUTURE.
 * These are worked out here following RFC 5545 section 3.3.10 and stored the way exceptions are:
 * the event plus one child per further occurrence, for a limited time around now.
 *
 * All times here are "walls": a clock reading in the event's zone, held in UTC fields.
 */
var Recurrence = (function () {
	"use strict";
	var SECOND = 1000, MINUTE = 60000, HOUR = 3600000, DAY = 86400000,
		DAYS = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6},
		WINDOW_BEFORE = 366 * DAY,
		WINDOW_AFTER = 731 * DAY,
		MAX_CHILDREN = 250,
		MAX_PERIODS = 60000,
		UNITS = {HOURLY: HOUR, MINUTELY: MINUTE, SECONDLY: SECOND};

	function numbers(text) {
		return text.split(",").map(function (part) {
			return parseInt(part, 10);
		}).filter(function (value) {
			return !isNaN(value);
		});
	}

	function parseRule(text) {
		var rule = {interval: 1, wkst: DAYS.MO};
		String(text).toUpperCase().split(";").forEach(function (part) {
			var pair = part.split("="), key = pair[0], value = pair[1] || "";
			switch (key) {
			case "FREQ":
				rule.freq = value;
				break;
			case "INTERVAL":
				rule.interval = Math.max(parseInt(value, 10) || 1, 1);
				break;
			case "COUNT":
				rule.count = parseInt(value, 10);
				break;
			case "UNTIL":
				rule.until = value;
				break;
			case "WKST":
				rule.wkst = DAYS[value] === undefined ? DAYS.MO : DAYS[value];
				break;
			case "BYDAY":
				rule.byDay = value.split(",").map(function (entry) {
					return {day: DAYS[entry.slice(-2)], ord: parseInt(entry, 10) || 0};
				}).filter(function (entry) {
					return entry.day !== undefined;
				});
				break;
			case "BYMONTH":
			case "BYMONTHDAY":
			case "BYYEARDAY":
			case "BYWEEKNO":
			case "BYHOUR":
			case "BYMINUTE":
			case "BYSECOND":
			case "BYSETPOS":
				rule[key] = numbers(value);
				break;
			}
		});
		return rule;
	}

	function daysInMonth(year, month) {
		return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	}

	function daysInYear(year) {
		return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY;
	}

	function weekStart(day, wkst) {
		return day - ((new Date(day).getUTCDay() - wkst + 7) % 7) * DAY;
	}

	//Week 1 is the first with at least four days in the year.
	function firstWeek(year, wkst) {
		return weekStart(Date.UTC(year, 0, 4), wkst);
	}

	function matchesWeekNumber(day, year, wanted, wkst) {
		var first = firstWeek(year, wkst), weeks = Math.round((firstWeek(year + 1, wkst) - first) / (7 * DAY)),
			week = Math.floor((day - first) / (7 * DAY)) + 1;
		if (week < 1) {
			year -= 1;
			first = firstWeek(year, wkst);
			weeks = Math.round((firstWeek(year + 1, wkst) - first) / (7 * DAY));
			week = Math.floor((day - first) / (7 * DAY)) + 1;
		} else if (week > weeks) {
			week -= weeks;
			weeks = Math.round((firstWeek(year + 2, wkst) - firstWeek(year + 1, wkst)) / (7 * DAY));
		}
		return wanted.some(function (number) {
			return number === week || number + weeks + 1 === week;
		});
	}

	function matchesOrdinal(date, ord, inMonth) {
		var day, length;
		if (inMonth) {
			day = date.getUTCDate();
			length = daysInMonth(date.getUTCFullYear(), date.getUTCMonth());
		} else {
			day = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
				Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY + 1;
			length = daysInYear(date.getUTCFullYear());
		}
		if (ord > 0) {
			return Math.floor((day - 1) / 7) + 1 === ord;
		}
		return Math.floor((length - day) / 7) + 1 === -ord;
	}

	function withDefaults(rule, startWall) {
		var start = new Date(startWall), result = {}, key;
		for (key in rule) {
			if (rule.hasOwnProperty(key)) {
				result[key] = rule[key];
			}
		}
		if (rule.freq === "YEARLY" && !rule.BYWEEKNO && !rule.BYYEARDAY && !rule.BYMONTHDAY && !rule.byDay) {
			result.BYMONTH = rule.BYMONTH || [start.getUTCMonth() + 1];
			result.BYMONTHDAY = [start.getUTCDate()];
		} else if (rule.freq === "MONTHLY" && !rule.BYMONTHDAY && !rule.byDay) {
			result.BYMONTHDAY = [start.getUTCDate()];
		} else if (rule.freq === "WEEKLY" && !rule.byDay) {
			result.byDay = [{day: start.getUTCDay(), ord: 0}];
		}
		if (!rule.BYHOUR && !UNITS[rule.freq]) {
			result.BYHOUR = [start.getUTCHours()];
		}
		if (!rule.BYMINUTE && rule.freq !== "MINUTELY" && rule.freq !== "SECONDLY") {
			result.BYMINUTE = [start.getUTCMinutes()];
		}
		if (!rule.BYSECOND && rule.freq !== "SECONDLY") {
			result.BYSECOND = [start.getUTCSeconds()];
		}
		return result;
	}

	function matchesDay(day, rule) {
		var date = new Date(day), month = date.getUTCMonth(), year = date.getUTCFullYear(),
			monthDay = date.getUTCDate(), monthLength = daysInMonth(year, month),
			yearDay = (day - Date.UTC(year, 0, 1)) / DAY + 1, yearLength = daysInYear(year),
			inMonth = rule.freq === "MONTHLY" || !!(rule.freq === "YEARLY" && rule.BYMONTH);

		if (rule.BYMONTH && rule.BYMONTH.indexOf(month + 1) < 0) {
			return false;
		}
		if (rule.BYWEEKNO && !matchesWeekNumber(day, year, rule.BYWEEKNO, rule.wkst)) {
			return false;
		}
		if (rule.BYYEARDAY && !rule.BYYEARDAY.some(function (value) {
				return value === yearDay || value + yearLength + 1 === yearDay;
			})) {
			return false;
		}
		if (rule.BYMONTHDAY && !rule.BYMONTHDAY.some(function (value) {
				return value === monthDay || value + monthLength + 1 === monthDay;
			})) {
			return false;
		}
		if (rule.byDay && !rule.byDay.some(function (entry) {
				return entry.day === date.getUTCDay() && (!entry.ord || matchesOrdinal(date, entry.ord, inMonth));
			})) {
			return false;
		}
		return true;
	}

	function sorted(list) {
		return list.slice().sort(function (a, b) {
			return a - b;
		});
	}

	function timesOfDay(rule) {
		var times = [];
		sorted(rule.BYHOUR).forEach(function (hour) {
			sorted(rule.BYMINUTE).forEach(function (minute) {
				sorted(rule.BYSECOND).forEach(function (second) {
					times.push(hour * HOUR + minute * MINUTE + second * SECOND);
				});
			});
		});
		return times;
	}

	function bySetPos(candidates, positions) {
		var picked = [];
		if (!positions) {
			return candidates;
		}
		positions.forEach(function (position) {
			var value = candidates[position > 0 ? position - 1 : candidates.length + position];
			if (value !== undefined && picked.indexOf(value) < 0) {
				picked.push(value);
			}
		});
		return sorted(picked);
	}

	function daysOfPeriod(rule, startDay, index) {
		var start = new Date(startDay), days = [], from, count, i, year, month;
		switch (rule.freq) {
		case "YEARLY":
			year = start.getUTCFullYear() + index * rule.interval;
			from = Date.UTC(year, 0, 1);
			count = daysInYear(year);
			break;
		case "MONTHLY":
			from = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index * rule.interval, 1);
			month = new Date(from);
			count = daysInMonth(month.getUTCFullYear(), month.getUTCMonth());
			break;
		case "WEEKLY":
			from = weekStart(startDay, rule.wkst) + index * rule.interval * 7 * DAY;
			count = 7;
			break;
		default: //DAILY
			from = startDay + index * rule.interval * DAY;
			count = 1;
			break;
		}
		for (i = 0; i < count; i += 1) {
			days.push(from + i * DAY);
		}
		return days;
	}

	function candidatesOfPeriod(rule, startWall, startDay, index, times) {
		var result = [], unit = UNITS[rule.freq], period, day, clock, minutes = [], seconds = [];
		if (unit) {
			period = startWall - startWall % unit + index * rule.interval * unit;
			day = period - period % DAY;
			if (!matchesDay(day, rule)) {
				return {first: period, list: []};
			}
			clock = new Date(period);
			if (rule.BYHOUR && rule.BYHOUR.indexOf(clock.getUTCHours()) < 0) {
				return {first: period, list: []};
			}
			if (rule.freq === "HOURLY") {
				minutes = sorted(rule.BYMINUTE);
			} else if (!rule.BYMINUTE || rule.BYMINUTE.indexOf(clock.getUTCMinutes()) >= 0) {
				minutes = [clock.getUTCMinutes()];
			}
			if (rule.freq !== "SECONDLY") {
				seconds = sorted(rule.BYSECOND);
			} else if (!rule.BYSECOND || rule.BYSECOND.indexOf(clock.getUTCSeconds()) >= 0) {
				seconds = [clock.getUTCSeconds()];
			}
			minutes.forEach(function (minute) {
				seconds.forEach(function (second) {
					result.push(day + clock.getUTCHours() * HOUR + minute * MINUTE + second * SECOND);
				});
			});
			return {first: period, list: result};
		}
		daysOfPeriod(rule, startDay, index).forEach(function (candidate) {
			if (matchesDay(candidate, rule)) {
				times.forEach(function (time) {
					result.push(candidate + time);
				});
			}
		});
		return {first: daysOfPeriod(rule, startDay, index)[0], list: result};
	}

	/**
	 * All occurrences of a rule, the first one being the start.
	 * @param ruleIn result of parseRule
	 * @param startWall the event's start
	 * @param options until: last allowed wall, from: leave out earlier ones (the start stays),
	 *                to: stop after this wall
	 */
	function expandRule(ruleIn, startWall, options) {
		var rule = withDefaults(ruleIn, startWall), startDay = startWall - startWall % DAY,
			times = UNITS[rule.freq] ? [] : timesOfDay(rule), result = [startWall], emitted = 1,
			index = 0, periods = 0, part, i, value, unit = UNITS[rule.freq];

		options = options || {};
		if (unit && rule.count === undefined && options.from > startWall) {
			index = Math.max(Math.floor((options.from - startWall) / (unit * rule.interval)) - 1, 0);
		}
		while (periods < MAX_PERIODS) {
			part = candidatesOfPeriod(rule, startWall, startDay, index, times);
			if ((options.to !== undefined && part.first > options.to) ||
					(options.until !== undefined && part.first > options.until + DAY)) {
				break;
			}
			part = bySetPos(part.list, rule.BYSETPOS);
			for (i = 0; i < part.length; i += 1) {
				value = part[i];
				if (value > startWall) {
					if ((options.until !== undefined && value > options.until) ||
							(rule.count !== undefined && emitted >= rule.count) ||
							(options.to !== undefined && value > options.to)) {
						return result;
					}
					emitted += 1;
					if (options.from === undefined || value >= options.from) {
						result.push(value);
					}
				}
			}
			index += 1;
			periods += 1;
		}
		return result;
	}

	function needsExpansion(ruleText, unsupported) {
		var rule;
		if (!ruleText) {
			return false;
		}
		rule = parseRule(ruleText);
		return !!(unsupported || UNITS[rule.freq] || rule.BYHOUR || rule.BYMINUTE || rule.BYSECOND ||
			(rule.freq === "WEEKLY" && rule.interval > 1 && rule.wkst !== DAYS.MO) ||
			(rule.count !== undefined && rule.byDay && rule.BYMONTHDAY));
	}

	function textOfWall(wall) {
		return new Date(wall).toISOString().replace(/[\-:]|\.\d+/g, "").replace("Z", "");
	}

	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function cleanup(event) {
		["rruleText", "rdateValues", "exdateValues", "recurrenceIdRaw", "recurrenceRange", "needsExpansion"].forEach(function (key) {
			delete event[key];
		});
		if (event.rrule) {
			delete event.rrule.unsupported;
		}
	}

	/**
	 * Applies what the calendar cannot do itself to a parsed event.
	 * @param event the event, already in local time
	 * @param exceptions its changed occurrences; further occurrences are added here
	 * @param Time iCalTimeHandling
	 * @param now current time, for the window of stored occurrences
	 */
	function apply(event, exceptions, Time, now) {
		var allDay = !!event.allDay, tzId = event.tzId, startInstant = event.dtstart, length = event.dtend - event.dtstart,
			startWall, timeOfDay, future, full, excludedWalls = {}, excludedDays = {}, extras = {}, walls, first, window, children = [];

		function toWall(instant) {
			return allDay ? Time.wallOfHeldTime(instant) : Time.wallAt(instant, tzId);
		}

		function fromWall(wall) {
			var instant;
			if (allDay) {
				return Time.heldTimeOfWall(wall);
			}
			instant = Time.wallToInstant(wall, tzId);
			return instant === undefined ? startInstant + (wall - startWall) : instant;
		}

		function textToWall(value, zone) {
			var wall, instant;
			if ((/^\d{8}$/).test(value)) {
				return Date.UTC(parseInt(value.substr(0, 4), 10), parseInt(value.substr(4, 2), 10) - 1,
					parseInt(value.substr(6, 2), 10)) + timeOfDay;
			}
			if ((/z$/i).test(value)) {
				return allDay ? Date.UTC(parseInt(value.substr(0, 4), 10), parseInt(value.substr(4, 2), 10) - 1,
					parseInt(value.substr(6, 2), 10)) + timeOfDay : toWall(Time.iCalTimeToWebOsTime(value.toUpperCase()));
			}
			wall = Time.wallOfText(value);
			if (wall === undefined || wall === null) {
				return undefined;
			}
			if (allDay) {
				return wall - wall % DAY + timeOfDay;
			}
			if (zone && zone !== tzId) {
				instant = Time.wallToInstant(wall, zone);
				if (instant !== undefined) {
					return toWall(instant);
				}
			}
			return wall;
		}

		function untilWall(rule) {
			var value = rule.until;
			if (!value) {
				return undefined;
			}
			if ((/^\d{8}$/).test(value)) {
				return textToWall(value) - timeOfDay + DAY - 1;
			}
			return textToWall(value);
		}

		startWall = toWall(event.dtstart);
		timeOfDay = startWall % DAY;

		future = exceptions.filter(function (child) {
			return child.recurrenceRange === "THISANDFUTURE" && child.recurrenceIdRaw;
		}).map(function (child) {
			var id = textToWall(child.recurrenceIdRaw.value, child.recurrenceIdRaw.tzid), start = toWall(child.dtstart);
			return {id: id, shift: start - id, length: child.dtend - child.dtstart, child: child};
		}).filter(function (entry) {
			return entry.id !== undefined;
		}).sort(function (a, b) {
			return a.id - b.id;
		});

		full = !!event.rrule && (needsExpansion(event.rruleText, event.rrule.unsupported) || future.length > 0);

		(event.exdateValues || []).forEach(function (entry) {
			if ((/^\d{8}$/).test(entry.value)) {
				excludedDays[entry.value] = true;
			} else {
				excludedWalls[textToWall(entry.value, entry.tzid)] = true;
			}
		});
		exceptions.forEach(function (child) {
			if (child.recurrenceIdRaw) {
				excludedWalls[textToWall(child.recurrenceIdRaw.value, child.recurrenceIdRaw.tzid)] = true;
			}
		});

		(event.rdateValues || []).forEach(function (entry) {
			var wall = textToWall(entry.value, entry.tzid);
			if (wall !== undefined && wall !== startWall) {
				extras[wall] = entry.duration;
			}
		});

		if (!full && !Object.keys(extras).length) {
			cleanup(event);
			exceptions.forEach(cleanup);
			return;
		}

		window = {from: Math.max(startWall, toWall(now) - WINDOW_BEFORE), to: toWall(now) + WINDOW_AFTER};
		walls = [startWall];
		if (full) {
			walls = expandRule(parseRule(event.rruleText), startWall,
				{from: window.from, to: window.to, until: untilWall(parseRule(event.rruleText))});
		}
		Object.keys(extras).forEach(function (wall) {
			wall = parseInt(wall, 10);
			if (walls.indexOf(wall) < 0 && wall <= window.to && wall >= window.from) {
				walls.push(wall);
			}
		});
		walls = sorted(walls).filter(function (wall) {
			return !excludedWalls[wall] && !excludedDays[textOfWall(wall).substr(0, 8)];
		});

		if (full) {
			first = walls[0] === undefined ? startWall : walls[0];
			if (first !== startWall) {
				event.dtstart = fromWall(first);
				event.dtend = event.dtstart + length;
			}
			event.expandedRule = event.rruleText;
			event.rrule = null;
			delete event.exdates;
			walls = walls.slice(1);
		} else {
			walls = walls.filter(function (wall) {
				return wall !== startWall;
			});
		}

		walls.slice(0, MAX_CHILDREN).forEach(function (wall) {
			var child = clone(event), change, start = wall, childLength = extras[wall] !== undefined ? extras[wall] : length;
			future.forEach(function (entry) {
				if (wall >= entry.id) {
					change = entry;
				}
			});
			if (change) {
				start += change.shift;
				childLength = change.length || childLength;
				["subject", "location", "note"].forEach(function (field) {
					child[field] = change.child[field];
				});
			}
			delete child._id;
			delete child.expandedRule;
			delete child.rdates;
			child.rrule = null;
			child.dtstart = fromWall(start);
			child.dtend = child.dtstart + childLength;
			child.recurrenceId = textOfWall(wall);
			child.parentDtstart = startInstant;
			child.relatedTo = event.uid || event.uId;
			child.generatedOccurrence = true;
			children.push(child);
		});
		if (walls.length > MAX_CHILDREN) {
			Log.log("Keeping ", MAX_CHILDREN, " of ", walls.length, " occurrences.");
		}

		cleanup(event);
		exceptions.forEach(cleanup);
		children.forEach(function (child) {
			cleanup(child);
			exceptions.push(child);
		});
	}

	return {
		parseRule: parseRule,
		expandRule: expandRule,
		needsExpansion: needsExpansion,
		apply: apply
	};
}());

module.exports = Recurrence;
