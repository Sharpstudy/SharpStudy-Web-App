// Notifications for worksheet assignments, using the EXISTING notifications table (the same
// one live sessions use), mailer and e-mail rules.
//
// A learner profile has no inbox: the people who can act on an assignment are the learner's
// owner and linked guardians (they see it in the Family dashboard), so they are the recipients.
// The instructor who made the change is never notified about their own action. The learner
// sees the assignment itself on their study page.
//
// Same guarantees as lib/live-sessions/notify.js: never throws (the assignment is already
// saved), one notification per (event, learner, recipient) thanks to a unique dedupe_key,
// e-mail only for a newly created notification and only to confirmed addresses, and the real
// e-mail outcome (sent / skipped / failed) is stored.
import { v4 as uuidv4 } from "uuid";
import { formatInZone } from "../meetings/time.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const line = (s, n) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").slice(0, n);

const KINDS = {
	assigned: { type: "worksheet_assigned", title: (a, l) => `New worksheet for ${l}: ${a.title}`, lead: "A new worksheet was assigned." },
	due: { type: "worksheet_due_changed", title: (a, l) => `Due date changed for ${l}: ${a.title}`, lead: "The due date of an assigned worksheet changed." },
	cancelled: { type: "worksheet_cancelled", title: (a, l) => `Assignment cancelled for ${l}: ${a.title}`, lead: "An assigned worksheet was cancelled." },
};

export const familyLink = (learnerId) => `/family/?learner=${learnerId}`;
// The account student a profile is linked to uses their own study page; everyone else the Family dashboard.
const linkFor = (learner, userId) => (learner.student_user_id && learner.student_user_id === userId ? "/study/" : familyLink(learner.id));

function body(kind, a, learner, instructorName) {
	const zone = learner.time_zone || "UTC";
	return [
		KINDS[kind].lead,
		`Learner: ${learner.display_name}`,
		instructorName ? `Assigned by: ${instructorName}` : null,
		kind === "cancelled" ? null : a.due_at ? `Due: ${formatInZone(a.due_at, zone)}` : "No due date",
		a.instructions && kind === "assigned" ? `Instructions: ${line(a.instructions, 200)}` : null,
	]
		.filter(Boolean)
		.join("\n");
}

export function assignmentEmail(kind, a, learner, { to, instructorName, baseUrl, path }) {
	const rows = [["Learner", learner.display_name], instructorName && ["Assigned by", instructorName], kind !== "cancelled" && ["Due", a.due_at ? formatInZone(a.due_at, learner.time_zone || "UTC") : "No due date"]]
		.filter(Boolean)
		.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#667085">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`)
		.join("");
	const link = `${String(baseUrl || "").replace(/\/$/, "")}${path || familyLink(learner.id)}`;
	return {
		to,
		subject: line(KINDS[kind].title(a, learner.display_name), 150),
		html: `<!DOCTYPE html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,sans-serif;color:#1f2937"><div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#2f55d4;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:bold">SharpStudy</div><div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;line-height:1.55"><h2 style="margin:0 0 12px;font-size:20px">${esc(a.title)}</h2><p>${esc(KINDS[kind].lead)}</p><table>${rows}</table>${kind === "cancelled" ? "" : `<p style="margin:20px 0"><a href="${esc(link)}" style="background:#2f55d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Open SharpStudy</a></p><p style="color:#667085;font-size:13px">You need to be signed in to SharpStudy.</p>`}</div></div></body></html>`,
	};
}

// deps: { mastery (learners, guardians), notif (notifications + users), mailer, baseUrl }
// info: { assignment, learnerIds, actor: { userId, name } }
export async function notifyAssignment(deps, kind, info, { now = new Date() } = {}) {
	const result = { created: 0, duplicates: 0, email: { sent: 0, skipped: 0, failed: 0 }, errors: 0 };
	try {
		const { assignment: a, learnerIds, actor } = info;
		const stamp = kind === "due" ? `:${a.due_at ? new Date(a.due_at).toISOString() : "none"}` : "";
		for (const learnerId of learnerIds) {
			const learner = await deps.mastery.getLearner(learnerId);
			if (!learner) continue;
			const guardians = await deps.mastery.listGuardians(learnerId);
			const recipients = [...new Set([learner.owner_user_id, learner.student_user_id, ...guardians.map((g) => g.userId)])].filter((id) => id && id !== actor.userId);
			const users = new Map((await deps.notif.getUsers(recipients)).map((u) => [u.id, u]));
			for (const userId of recipients) {
				try {
					const row = await deps.notif.insertNotification({
						id: uuidv4(),
						user_id: userId,
						type: KINDS[kind].type,
						title: line(KINDS[kind].title(a, learner.display_name), 200),
						body: body(kind, a, learner, actor.name),
						link: linkFor(learner, userId),
						ref_id: a.id,
						dedupe_key: `ws:${kind}:${a.id}:${learnerId}:${userId}${stamp}`.slice(0, 190),
						created_at: now,
					});
					if (!row) {
						result.duplicates++;
						continue;
					}
					result.created++;
					const u = users.get(userId);
					let status = "skipped";
					if (deps.mailer && u && u.email && u.emailConfirmed) {
						const r = await deps.mailer(assignmentEmail(kind, a, learner, { to: u.email, instructorName: actor.name, baseUrl: deps.baseUrl, path: linkFor(learner, userId) }));
						status = r && r.ok ? "sent" : r && r.skipped ? "skipped" : "failed";
					}
					result.email[status]++;
					await deps.notif.updateNotification(row.id, { email_status: status });
				} catch (e) {
					result.errors++;
				}
			}
		}
	} catch (e) {
		result.errors++;
	}
	return result;
}
