// Notifications for removal requests, using the EXISTING notifications table (the one live sessions and worksheet
// assignments use) through repo.insertNotification. Same guarantees as lib/mastery/assignmentNotify.js:
//  - never throws: the request/decision is already saved, so a notification problem must not undo or fail it;
//  - idempotent: a unique dedupe_key means a retry notifies a person once;
//  - in-app only (no new service, no e-mail), so nothing leaves the system.
// The instructor's private reason and comments go to administrators only, never to the family or the student.
import { v4 as uuidv4 } from "uuid";
import { reasonLabel } from "./reasons.js";

const line = (s, n) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").slice(0, n);
export const ADMIN_LINK = "/admin/students/removal-requests/";
export const INSTRUCTOR_LINK = "/instructor/students/";
// A linked student account studies on its own page; everyone else uses the Family dashboard (as for assignments).
const familyLink = (learner, userId) => (learner.student_user_id && learner.student_user_id === userId ? "/study/" : `/family/?learner=${learner.id}`);

async function send(repo, row, now) {
	try {
		const made = await repo.insertNotification({ id: uuidv4(), email_status: "none", created_at: now, ...row, title: line(row.title, 200), dedupe_key: String(row.dedupe_key).slice(0, 190) });
		return made ? "created" : "duplicate";
	} catch (e) {
		return "error";
	}
}

const tally = (result, r) => {
	result[r === "created" ? "created" : r === "duplicate" ? "duplicates" : "errors"] += 1;
};

export async function notifyRequested(repo, req, { instructorName = "", now = new Date() } = {}) {
	const result = { created: 0, duplicates: 0, errors: 0 };
	try {
		for (const adminId of await repo.listAdminIds()) {
			tally(
				result,
				await send(repo, {
					user_id: adminId,
					type: "student_removal_requested",
					title: `Removal request: ${req.learner_name}`,
					body: [`${instructorName || "An instructor"} asked to remove their link to ${req.learner_name}.`, `Reason: ${reasonLabel(req.reason_code)}`, req.comments ? `Comments: ${line(req.comments, 300)}` : null].filter(Boolean).join("\n"),
					link: ADMIN_LINK,
					ref_id: req.id,
					dedupe_key: `removal:requested:${req.id}:${adminId}`,
				}, now)
			);
		}
	} catch (e) {
		result.errors += 1;
	}
	return result;
}

// action: "approve" | "reject". info: { note, removed, recipients, learner, adminId, now }
export async function notifyDecision(repo, action, req, info) {
	const { note = "", removed = 0, recipients = [], learner = null, adminId = null, now = new Date() } = info;
	const result = { created: 0, duplicates: 0, errors: 0 };
	try {
		// 1) the instructor who asked
		tally(
			result,
			await send(repo, {
				user_id: req.instructor_id,
				type: action === "approve" ? "student_removal_approved" : "student_removal_rejected",
				title: action === "approve" ? `Removal approved: ${req.learner_name}` : `Removal request rejected: ${req.learner_name}`,
				body: action === "approve" ? `Your link to ${req.learner_name} was removed. The student's account, profile and learning records were not changed.` : `Your request to remove ${req.learner_name} was rejected.${note ? `\nAdministrator: ${line(note, 500)}` : ""}`,
				link: INSTRUCTOR_LINK,
				ref_id: req.id,
				dedupe_key: `removal:decided:${req.id}:${req.instructor_id}`,
			}, now)
		);
		// 2) on approval, the people who look after the learner: owner, linked student account and parents
		if (action === "approve" && removed > 0 && learner) {
			const who = [...new Set(recipients)].filter((id) => id && id !== req.instructor_id && id !== adminId);
			for (const userId of who) {
				tally(
					result,
					await send(repo, {
						user_id: userId,
						type: "student_link_removed",
						title: `An instructor no longer has access to ${req.learner_name}`,
						body: `An administrator removed an instructor's link to ${req.learner_name}.\nThe profile, progress and worksheets were not changed.`,
						link: familyLink(learner, userId),
						ref_id: req.id,
						dedupe_key: `removal:link-removed:${req.id}:${userId}`,
					}, now)
				);
			}
		}
	} catch (e) {
		result.errors += 1;
	}
	return result;
}
