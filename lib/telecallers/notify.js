// In-app notifications for telecaller applications, through the EXISTING notifications table (the one live sessions,
// worksheet assignments and removal requests use) via repo.insertNotification. Same guarantees as lib/removals/notify.js:
//  - never throws: the application / decision is already saved, so a notification problem must not undo or fail it;
//  - idempotent: a unique dedupe_key means a retry notifies a person once;
//  - private admin notes are never part of any notification.
import { v4 as uuidv4 } from "uuid";

const line = (s, n) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").slice(0, n);
export const ADMIN_LINK = "/admin/telecallers/applications/";
export const APPLICANT_LINK = "/become-a-telecaller/";

async function send(repo, row, now) {
	try {
		const made = await repo.insertNotification({ id: uuidv4(), email_status: "none", created_at: now, ...row, title: line(row.title, 200), dedupe_key: String(row.dedupe_key).slice(0, 190) });
		return made ? "created" : "duplicate";
	} catch (e) {
		return "error";
	}
}

// New / resubmitted application -> every active administrator.
export async function notifySubmitted(repo, app, { name = "", resubmitted = false, now = new Date() } = {}) {
	const result = { created: 0, duplicates: 0, errors: 0 };
	try {
		for (const adminId of await repo.listAdminIds()) {
			const r = await send(repo, {
				user_id: adminId,
				type: "telecaller_application_submitted",
				title: `${resubmitted ? "Telecaller application resubmitted" : "New telecaller application"}: ${line(name, 80) || "applicant"}`,
				body: `${line(name, 80) || "An applicant"} ${resubmitted ? "resubmitted" : "submitted"} a telecaller application (attempt ${app.attempt}).`,
				link: `${ADMIN_LINK}?open=${app.id}`,
				ref_id: app.id,
				dedupe_key: `tcapp:submitted:${app.id}:${app.version}:${adminId}`,
			}, now);
			result[r === "created" ? "created" : r === "duplicate" ? "duplicates" : "errors"] += 1;
		}
	} catch (e) {
		result.errors += 1;
	}
	return result;
}

const COPY = {
	more_info: { type: "telecaller_application_more_info", title: "More information needed for your telecaller application", body: (m) => `We need a little more information before we can decide.${m ? `\n${line(m, 500)}` : ""}` },
	approved: { type: "telecaller_application_approved", title: "Your telecaller application was approved", body: (m) => `Congratulations! Your application was approved.${m ? `\n${line(m, 500)}` : ""}` },
	rejected: { type: "telecaller_application_rejected", title: "Update on your telecaller application", body: (m) => `We are unable to approve your application at this time.${m ? `\n${line(m, 500)}` : ""}` },
	deactivated: { type: "telecaller_access_deactivated", title: "Your telecaller access was deactivated", body: (m) => `Your telecaller access has been deactivated.${m ? `\n${line(m, 500)}` : ""}` },
	reactivated: { type: "telecaller_access_reactivated", title: "Your telecaller access was reactivated", body: (m) => `Your telecaller access has been reactivated.${m ? `\n${line(m, 500)}` : ""}` },
};

// A decision (or access change) -> the applicant. `version` keeps one notification per decision.
export async function notifyApplicant(repo, kind, { userId, applicationId, version, message = "", now = new Date() }) {
	const c = COPY[kind];
	if (!c) return "error";
	return send(repo, { user_id: userId, type: c.type, title: c.title, body: c.body(message), link: APPLICANT_LINK, ref_id: applicationId, dedupe_key: `tcapp:${kind}:${applicationId}:${version}:${userId}` }, now);
}
