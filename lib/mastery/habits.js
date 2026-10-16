// Family-local calendar maths for daily goals, streaks and habit grids.
// Timestamps are stored in UTC; "days" are computed in the learner's IANA
// time zone so a worksheet at 11pm local time counts for that local day.

export const DEFAULT_TIME_ZONE = "UTC";

export function isValidTimeZone(tz) {
	if (!tz || typeof tz !== "string" || tz.length > 64) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch (e) {
		return false;
	}
}

// "YYYY-MM-DD" for an instant in the given zone.
export function localDate(instant, timeZone = DEFAULT_TIME_ZONE) {
	const d = instant instanceof Date ? instant : new Date(instant);
	const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(d);
	const get = (t) => parts.find((p) => p.type === t).value;
	return `${get("year")}-${get("month")}-${get("day")}`;
}

// Calendar arithmetic on "YYYY-MM-DD" strings (zone-free).
export function addDays(dateStr, n) {
	const [y, m, d] = dateStr.split("-").map(Number);
	const t = new Date(Date.UTC(y, m - 1, d + n));
	return t.toISOString().slice(0, 10);
}

export function dayRange(endDate, days) {
	const out = [];
	for (let i = days - 1; i >= 0; i--) out.push(addDays(endDate, -i));
	return out;
}

// activity: [{ date: "YYYY-MM-DD", worksheets, stars, seconds }]
// A day "counts" for the streak when the daily goal (worksheets) was met.
// Today not being met yet does not break the streak — it continues from yesterday.
export function computeStreak(activity, today, dailyGoal = 1) {
	const goal = Math.max(1, dailyGoal | 0);
	const met = new Set(activity.filter((a) => (a.worksheets || 0) >= goal).map((a) => a.date));
	let cursor = met.has(today) ? today : addDays(today, -1);
	let current = 0;
	while (met.has(cursor)) {
		current++;
		cursor = addDays(cursor, -1);
	}
	// Longest streak across the supplied history.
	const sorted = [...met].sort();
	let longest = 0;
	let run = 0;
	let prev = null;
	for (const d of sorted) {
		run = prev && addDays(prev, 1) === d ? run + 1 : 1;
		longest = Math.max(longest, run);
		prev = d;
	}
	return { current, longest, todayMet: met.has(today) };
}

export function habitGrid(activity, today, dailyGoal = 1, days = 21) {
	const byDate = new Map(activity.map((a) => [a.date, a]));
	const goal = Math.max(1, dailyGoal | 0);
	return dayRange(today, days).map((date) => {
		const a = byDate.get(date);
		const worksheets = a ? a.worksheets || 0 : 0;
		return { date, worksheets, stars: a ? a.stars || 0 : 0, met: worksheets >= goal, isToday: date === today };
	});
}

// Aggregate daily activity into day / week / month buckets for charts.
// period: "day" (last `count` days), "week" (ISO weeks starting Monday), "month".
export function bucketActivity(activity, today, period = "day", count = 14) {
	const byDate = new Map(activity.map((a) => [a.date, a]));
	const sum = (dates) =>
		dates.reduce(
			(acc, d) => {
				const a = byDate.get(d);
				if (a) {
					acc.worksheets += a.worksheets || 0;
					acc.stars += a.stars || 0;
					acc.seconds += a.seconds || 0;
				}
				return acc;
			},
			{ worksheets: 0, stars: 0, seconds: 0 }
		);
	if (period === "day") {
		return dayRange(today, count).map((d) => ({ label: d, start: d, ...sum([d]) }));
	}
	if (period === "week") {
		const [y, m, d] = today.split("-").map(Number);
		const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
		const thisMonday = addDays(today, -dow);
		const out = [];
		for (let i = count - 1; i >= 0; i--) {
			const start = addDays(thisMonday, -7 * i);
			out.push({ label: start, start, ...sum(dayRange(addDays(start, 6), 7)) });
		}
		return out;
	}
	if (period === "month") {
		const [y, m] = today.split("-").map(Number);
		const out = [];
		for (let i = count - 1; i >= 0; i--) {
			const dt = new Date(Date.UTC(y, m - 1 - i, 1));
			const key = dt.toISOString().slice(0, 7);
			const dates = [...byDate.keys()].filter((k) => k.startsWith(key));
			out.push({ label: key, start: `${key}-01`, ...sum(dates) });
		}
		return out;
	}
	throw new RangeError(`Unknown period ${period}`);
}
