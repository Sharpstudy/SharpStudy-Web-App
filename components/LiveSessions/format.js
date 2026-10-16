// Small helpers shared by the live-session screens.
export const errMessage = (e) => {
	if (!e.response) return "You appear to be offline. Check your connection and try again.";
	return (e.response.data && e.response.data.message) || "Something went wrong.";
};

// Shown in the viewer's own time zone; the session's zone is added when it differs.
export const fmtWhen = (s) => {
	const start = new Date(s.startAt);
	const end = new Date(s.endAt);
	const day = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(start);
	const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
	const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const zone = s.timeZone && s.timeZone !== mine ? ` (set in ${s.timeZone})` : "";
	return `${day}, ${time.format(start)} – ${time.format(end)}${zone}`;
};

export const fmtDuration = (seconds) => {
	const m = Math.round((seconds || 0) / 60);
	return m < 1 ? "<1 min" : `${m} min`;
};

export const TYPE_LABEL = { group: "Group class", one_to_one: "One-to-one" };

// One label per state the UI has to show, derived from the server's view.
export function stateOf(s) {
	if (s.status === "cancelled") return { label: "Cancelled", tone: "danger" };
	if (s.status === "completed") return { label: s.held ? "Completed" : "Not held", tone: "" };
	if (s.status === "live") return { label: "Live now", tone: "success" };
	if (s.role === "student" && !s.booked && s.full) return { label: s.sessionType === "one_to_one" ? "Booked" : "Full", tone: "warning" };
	return { label: "Upcoming", tone: "primary" };
}

export const Status = ({ session }) => {
	const st = stateOf(session);
	return <span className={`ss-badge ${st.tone ? `ss-badge--${st.tone}` : ""}`}>{st.label}</span>;
};

export const BUCKETS = [
	{ key: "upcoming", label: "Upcoming", test: (s) => s.status === "scheduled" },
	{ key: "live", label: "Live", test: (s) => s.status === "live" },
	{ key: "completed", label: "Completed", test: (s) => s.status === "completed" },
	{ key: "cancelled", label: "Cancelled", test: (s) => s.status === "cancelled" },
];
