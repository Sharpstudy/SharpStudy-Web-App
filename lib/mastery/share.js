// Plain-language progress summary used for email sharing (and as the
// mailto: fallback body). Built only from the dashboard data the sharer can see.

const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const mins = (s) => `${Math.round((s || 0) / 60)} min`;

export function progressSummary(dash) {
	const name = dash.learner.displayName;
	const lines = [
		`${name}'s SharpStudy progress (as of ${dash.today})`,
		"",
		`Daily goal: ${dash.todayCount}/${dash.dailyGoal} worksheets today`,
		`Current streak: ${dash.streak.current} day(s) (best ${dash.streak.longest})`,
		`Stars earned: ${dash.totalStars}`,
		`Worksheets completed: ${dash.stats.worksheets}, average first-try accuracy ${pct(dash.stats.avgAccuracy)}, total time ${mins(dash.stats.totalSeconds)}`,
		"",
		"Subjects:",
		...dash.subjects
			.filter((s) => s.active && s.position)
			.map((s) => `- ${s.name}: level ${s.position.levelId} (${s.position.levelTitle}), ${s.position.setTitle}, worksheet ${s.position.worksheetNo}`),
	];
	const last7 = dash.charts.day.slice(-7);
	lines.push("", `Last 7 days: ${last7.map((d) => d.worksheets).join(" · ")} worksheets/day`);
	return { subject: `${name}'s SharpStudy progress`, text: lines.join("\n") };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function progressSummaryHtml(summary) {
	return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f1729">${summary.text
		.split("\n")
		.map((l) => (l ? `<p style="margin:0 0 6px">${escHtml(l)}</p>` : "<br>"))
		.join("")}</div>`;
}
