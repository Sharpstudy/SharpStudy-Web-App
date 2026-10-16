// Daily practice reminder as an iCalendar (RFC 5545) event that repeats
// every day at the learner's reminder time in their own time zone.

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Lines longer than 75 octets must be folded.
const fold = (line) => {
	const out = [];
	let s = line;
	while (s.length > 73) {
		out.push(s.slice(0, 73));
		s = " " + s.slice(73);
	}
	out.push(s);
	return out.join("\r\n");
};

export function reminderIcs({ learnerId, learnerName, timeZone, reminderTime, startDate, dailyGoal, url, now = new Date() }) {
	const [hh, mm] = (reminderTime || "16:00").split(":");
	const day = (startDate || now.toISOString().slice(0, 10)).replace(/-/g, "");
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//SharpStudy//Mastery Ladder//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"BEGIN:VEVENT",
		`UID:ml-reminder-${learnerId}@sharpstudy.io`,
		`DTSTAMP:${stamp(now)}`,
		`DTSTART;TZID=${timeZone || "UTC"}:${day}T${hh}${mm}00`,
		"DURATION:PT20M",
		"RRULE:FREQ=DAILY",
		`SUMMARY:${esc(`${learnerName}: SharpStudy practice`)}`,
		`DESCRIPTION:${esc(`Daily goal: ${dailyGoal} worksheet${dailyGoal === 1 ? "" : "s"}. ${url || ""}`.trim())}`,
		...(url ? [`URL:${esc(url)}`] : []),
		"BEGIN:VALARM",
		"ACTION:DISPLAY",
		`DESCRIPTION:${esc(`Time for ${learnerName}'s SharpStudy practice`)}`,
		"TRIGGER:PT0M",
		"END:VALARM",
		"END:VEVENT",
		"END:VCALENDAR",
	];
	return lines.map(fold).join("\r\n") + "\r\n";
}
