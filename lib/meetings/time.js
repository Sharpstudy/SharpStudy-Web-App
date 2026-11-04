// Time-zone helpers built on Intl (no extra dependency).

export function isValidTimeZone(tz) {
	if (typeof tz !== "string" || tz.length < 1 || tz.length > 64) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch (e) {
		return false;
	}
}

// Offset (ms) of `tz` from UTC at the instant `utcMs`: wall-clock-in-tz minus UTC.
function offsetMs(utcMs, tz) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(utcMs));
	const v = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
	const asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
	return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// "2026-10-20" + "14:30" + "America/Toronto" -> the UTC instant (Date), or null if the
// date/time is not a real calendar value. A wall-clock time that does not exist
// (spring-forward gap) resolves to the instant just after the gap.
export function zonedToUtc(dateStr, timeStr, tz) {
	const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
	const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr || "");
	if (!d || !t || !isValidTimeZone(tz)) return null;
	const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
	const probe = new Date(Date.UTC(y, mo - 1, da));
	if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return null; // e.g. 2026-02-30
	const wall = Date.UTC(y, mo - 1, da, Number(t[1]), Number(t[2]));
	let guess = wall - offsetMs(wall, tz);
	guess = wall - offsetMs(guess, tz); // second pass fixes instants near a DST change
	return new Date(guess);
}

// Human-readable moment in a zone, e.g. "Tue, Oct 20, 2026, 2:30 PM (America/Toronto)".
export function formatInZone(date, tz) {
	const zone = isValidTimeZone(tz) ? tz : "UTC";
	const s = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(date));
	return `${s} (${zone})`;
}
