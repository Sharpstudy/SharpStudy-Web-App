// Display helpers for the instructor details page. Pure; a missing value is always "N/A", never blank or 0.
export const NA = "N/A";

const validZone = (tz) => {
	try {
		new Intl.DateTimeFormat("en", { timeZone: tz });
		return tz;
	} catch (e) {
		return "UTC";
	}
};
const valid = (iso) => iso && !Number.isNaN(new Date(iso).getTime());

// Dates and times are shown in the session's own time zone, so "10:00" means what the instructor scheduled.
export const formatDate = (iso, tz = "UTC") => (valid(iso) ? new Intl.DateTimeFormat("en-GB", { timeZone: validZone(tz), day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : NA);
export const formatTime = (iso, tz = "UTC") => (valid(iso) ? new Intl.DateTimeFormat("en-GB", { timeZone: validZone(tz), hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : NA);
export const formatTimeRange = (startIso, endIso, tz = "UTC") => (valid(startIso) && valid(endIso) ? `${formatTime(startIso, tz)} – ${formatTime(endIso, tz)}` : NA);
export const formatDateOnly = (iso) => formatDate(iso, "UTC");

export const formatMinutes = (m) => {
	if (m == null || !Number.isFinite(m)) return NA;
	const h = Math.floor(m / 60);
	const r = m % 60;
	return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
};
export const formatHours = (h) => (h == null || !Number.isFinite(h) ? NA : `${h % 1 === 0 ? h : h.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} h`);
export const formatPercent = (r) => (r == null || !Number.isFinite(r) ? NA : `${Math.round(r * 100)}%`);
export const orNA = (v) => {
	const s = String(v == null ? "" : v).trim();
	return s || NA;
};

export const STATUS_LABEL = { completed: "Completed", upcoming: "Upcoming", live: "Live now", cancelled: "Cancelled", not_held: "Not held" };
export const STATUS_TONE = { completed: "success", upcoming: "soft", live: "warning", cancelled: "danger", not_held: "neutral" };
