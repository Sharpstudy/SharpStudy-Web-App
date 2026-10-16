// Notifications for live sessions: an in-app record for every affected student and,
// when possible, an e-mail through the project's existing mailer.
//
// Guarantees
//  - Never throws: the session is already saved when this runs, and a notification or
//    e-mail problem must not undo or fail it.
//  - Idempotent: each notification has a dedupe_key, so a retried create/reschedule/cancel
//    (or two tabs) notifies a student once. E-mail is only attempted for a newly created
//    in-app record, so a retry never e-mails twice.
//  - E-mail goes only to users with a confirmed address, and its outcome is stored
//    (sent / skipped / failed) on the notification.
//  - The link points at the authorised session page; opening it requires signing in as the
//    assigned student, so the link alone gives access to nothing.
import { v4 as uuidv4 } from "uuid";
import { formatInZone } from "../meetings/time.js";
import { participantKey, WINDOW } from "./service.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const oneLine = (s, n) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").slice(0, n);

const COPY = {
	assigned: { title: (v) => `You have a live session: ${v.title}`, lead: "You have been added to a live session." },
	rescheduled: { title: (v) => `Session rescheduled: ${v.title}`, lead: "The time of your live session has changed." },
	cancelled: { title: (v) => `Session cancelled: ${v.title}`, lead: "This live session has been cancelled." },
	reminder: { title: (v) => `Starting soon: ${v.title}`, lead: "Your live session starts soon." },
};

export const sessionLink = (id) => `/learning/live/${id}/`;

const bodyText = (kind, v, instructorName) =>
	[
		COPY[kind].lead,
		v.courseTitle ? `Course: ${v.courseTitle}` : null,
		instructorName ? `Instructor: ${instructorName}` : null,
		kind === "cancelled" ? `Was scheduled: ${formatInZone(v.startAt, v.timeZone)}` : `When: ${formatInZone(v.startAt, v.timeZone)}`,
	]
		.filter(Boolean)
		.join("\n");

export function sessionEmail(kind, v, { to, instructorName, baseUrl }) {
	const rows = [["Session", v.title], v.courseTitle && ["Course", v.courseTitle], instructorName && ["Instructor", instructorName], [kind === "cancelled" ? "Was scheduled" : "When", formatInZone(v.startAt, v.timeZone)]]
		.filter(Boolean)
		.map(([k, val]) => `<tr><td style="padding:4px 12px 4px 0;color:#667085;vertical-align:top">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(val)}</strong></td></tr>`)
		.join("");
	const link = `${String(baseUrl || "").replace(/\/$/, "")}${sessionLink(v.id)}`;
	const button = kind === "cancelled" ? "" : `<p style="margin:20px 0"><a href="${esc(link)}" style="background:#2f55d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Open session</a></p><p style="color:#667085;font-size:13px">You need to be signed in to SharpStudy to open it.</p>`;
	return {
		to,
		subject: oneLine(COPY[kind].title(v), 150),
		html: `<!DOCTYPE html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937"><div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#2f55d4;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:bold">SharpStudy</div><div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;line-height:1.55"><h2 style="margin:0 0 12px;font-size:20px">${esc(COPY[kind].title(v))}</h2><p>${esc(COPY[kind].lead)}</p><table>${rows}</table>${button}</div></div></body></html>`,
	};
}

// kind: assigned | rescheduled | cancelled. `view` is the instructor view of the saved session.
// recipients: [{ userId }]. Returns counts; never throws.
export async function notifySession(repo, kind, view, recipients, { instructorName = "", baseUrl = "", mailer = null, now = new Date() } = {}) {
	const result = { created: 0, duplicates: 0, email: { sent: 0, skipped: 0, failed: 0 }, errors: 0 };
	try {
		const ids = [...new Set(recipients.map((r) => r.userId).filter(Boolean))];
		const users = new Map((await repo.getUsers(ids)).map((u) => [u.id, u]));
		for (const userId of ids) {
			try {
				// The same operation repeated yields the same key; a changed time or a new operation yields a new one.
				const stamp = kind === "cancelled" ? "" : `:${new Date(view.startAt).toISOString()}`;
				const row = await repo.insertNotification({
					id: uuidv4(),
					user_id: userId,
					type: `live_session_${kind}`,
					title: oneLine(COPY[kind].title(view), 200),
					body: bodyText(kind, view, instructorName),
					link: kind === "cancelled" ? sessionLink(view.id) : sessionLink(view.id),
					ref_id: view.id,
					dedupe_key: `live:${kind}:${view.id}:${userId}${stamp}`.slice(0, 190),
					created_at: now,
				});
				if (!row) {
					result.duplicates++;
					continue;
				}
				result.created++;
				const user = users.get(userId);
				let status = "skipped";
				if (mailer && user && user.email && user.emailConfirmed) {
					const r = await mailer(sessionEmail(kind, view, { to: user.email, instructorName, baseUrl }));
					status = r && r.ok ? "sent" : r && r.skipped ? "skipped" : "failed";
				}
				result.email[status]++;
				await repo.updateNotification(row.id, { email_status: status });
			} catch (e) {
				result.errors++;
			}
		}
	} catch (e) {
		result.errors++;
	}
	return result;
}

// "Approaching" notices: created lazily when a student opens their notifications (there is no
// scheduler in this deployment). In-app only; idempotent per session start time.
export const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
export async function ensureReminders(repo, userId, now = new Date()) {
	try {
		const mine = await repo.listSessionsForParticipant(participantKey(userId));
		for (const s of mine) {
			const start = new Date(s.start_at).getTime();
			if (s.status !== "scheduled" || start <= now.getTime() || start - now.getTime() > REMINDER_WINDOW_MS) continue;
			const course = s.course_id ? (await repo.getCourses([s.course_id]))[0] : null;
			const v = { id: s.id, title: s.title, courseTitle: course ? course.title : null, startAt: new Date(s.start_at).toISOString(), timeZone: s.time_zone };
			await repo.insertNotification({
				id: uuidv4(),
				user_id: userId,
				type: "live_session_reminder",
				title: oneLine(COPY.reminder.title(v), 200),
				body: bodyText("reminder", v, ""),
				link: sessionLink(s.id),
				ref_id: s.id,
				dedupe_key: `live:reminder:${s.id}:${userId}:${v.startAt}`.slice(0, 190),
				created_at: now,
			});
		}
	} catch (e) {
		/* reminders are best effort */
	}
}

// ---- current-state view of stored notifications ----
// A stored notification is a record of something that was true when it was written
// ("starting soon", "you have a live session"). What a student SEES is always checked
// against the session as it is NOW, on the server:
//   - the state (upcoming / live / completed / cancelled) comes from the session row,
//     including the end of its window, never from the stored text;
//   - the title and body are rebuilt from the current session (time, zone, course, instructor);
//   - reminders only exist for upcoming sessions, and only for the current start time;
//   - only the latest "rescheduled" notice is shown (older ones stay in the database as history).
// Nothing is deleted or rewritten in the database, and read/unread is untouched.
const stateOf = (s, now) => {
	if (s.status === "cancelled") return "cancelled";
	if (s.status === "completed") return "completed";
	// The same rule settleSession applies: past the end of the window nothing is upcoming or live.
	if (new Date(s.end_at).getTime() + WINDOW.graceMs <= now.getTime()) return "completed";
	return s.status === "live" ? "live" : "upcoming";
};

const STATE_TITLE = {
	completed: (t) => `Session completed: ${t}`,
	cancelled: (t) => `Session cancelled: ${t}`,
	live: (t) => `Live now: ${t}`,
};

function currentCopy(n, s, state, { course, instructorName }) {
	const when = formatInZone(s.start_at, s.time_zone);
	const kind = n.type.replace("live_session_", "");
	const head = state === "upcoming" ? COPY[kind === "reminder" || kind === "rescheduled" ? kind : "assigned"].title({ title: s.title }) : STATE_TITLE[state](s.title);
	const lead =
		state === "completed" ? "This live session has finished." : state === "cancelled" ? "This live session has been cancelled." : state === "live" ? "This live session is in progress." : COPY[kind === "cancelled" ? "assigned" : kind].lead;
	const label = state === "cancelled" ? "Was scheduled" : state === "completed" ? "Was scheduled" : "When";
	const body = [lead, course ? `Course: ${course}` : null, instructorName ? `Instructor: ${instructorName}` : null, `${label}: ${when}`].filter(Boolean).join("\n");
	return { title: oneLine(head, 200), body };
}

const view = (n, extra = {}) => ({ id: n.id, type: n.type, title: n.title, body: n.body || "", link: n.link, read: !!n.read_at, createdAt: new Date(n.created_at).toISOString(), state: null, ...extra });

// The signed-in user's own notifications only.
export async function listNotifications(repo, actor, now = new Date()) {
	if (!actor || !actor.userId) return { status: 401 };
	await ensureReminders(repo, actor.userId, now);
	const rows = await repo.listNotifications(actor.userId, 60);
	const ids = [...new Set(rows.map((r) => r.ref_id).filter(Boolean))];
	const sessions = new Map((await repo.getSessionsByIds(ids)).map((x) => [x.id, x]));
	const courses = new Map((await repo.getCourses([...new Set([...sessions.values()].map((x) => x.course_id).filter(Boolean))])).map((c) => [c.id, c.title]));
	const teachers = new Map((await repo.getUsers([...new Set([...sessions.values()].map((x) => x.instructor_id))])).map((u) => [u.id, u.name]));

	// The latest "rescheduled" notice per session is the one that matches the current start time.
	const out = [];
	for (const n of rows) {
		if (!n.type.startsWith("live_session_") || !n.ref_id) {
			out.push(view(n));
			continue;
		}
		const s = sessions.get(n.ref_id);
		if (!s) {
			if (n.type !== "live_session_reminder") out.push(view(n, { state: "missing" }));
			continue;
		}
		const state = stateOf(s, now);
		const currentStart = new Date(s.start_at).toISOString();
		const forCurrentTime = String(n.dedupe_key).endsWith(`:${currentStart}`);
		if (n.type === "live_session_reminder" && (state !== "upcoming" || !forCurrentTime)) continue; // never "starting soon" for the past, a cancelled session or an old time
		if (n.type === "live_session_rescheduled" && !forCurrentTime) continue; // superseded by a later change (kept in the database)
		const copy = currentCopy(n, s, state, { course: s.course_id ? courses.get(s.course_id) : null, instructorName: teachers.get(s.instructor_id) });
		out.push(view(n, n.type === "live_session_cancelled" ? { state } : { ...copy, state }));
	}
	const shown = out.slice(0, 30);
	return { status: 200, notifications: shown, unread: shown.filter((n) => !n.read).length };
}

export async function markNotificationsRead(repo, actor, ids, now = new Date()) {
	if (!actor || !actor.userId) return { status: 401 };
	const list = Array.isArray(ids) ? ids.map(String).slice(0, 100) : null;
	await repo.markRead(actor.userId, list, now);
	return { status: 200, unread: await repo.countUnread(actor.userId) };
}
