// Student removal requests.
//
// An instructor can only ASK for their own instructor link to a learner profile to be removed; an administrator
// approves or rejects. Approval deletes exactly one row: ml_learner_guardians(learner, instructor, relation='instructor').
// Nothing else is touched: not the student account, the learner profile, assignments, attempts, progress, certificates,
// attendance, course enrolments, or any other instructor's or parent's link.
//
// The repo is injected (lib/removals/repo.js), so every rule here runs in tests without a database. Decisions run inside
// repo.transaction(): the status change, the link removal and the audit entry commit together or not at all.
import { v4 as uuidv4 } from "uuid";
import { ServiceError } from "../mastery/service.js";
import { REASON_CODES, reasonLabel, COMMENT_MAX, NOTE_MAX, MIN_TEXT, STATUSES } from "./reasons.js";
import { notifyRequested, notifyDecision } from "./notify.js";

const fail = (status, code, message) => {
	throw new ServiceError(status, code, message);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, n);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const fullName = (u) => (u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email || "" : "");

export function requireInstructor(actor) {
	if (!actor || actor.kind !== "account") fail(401, "unauthorized", "Sign in first");
	if (actor.role !== "instructor") fail(403, "forbidden", "Only instructors can request a student removal");
}
export function requireAdmin(actor) {
	if (!actor || actor.kind !== "account") fail(401, "unauthorized", "Sign in first");
	if (actor.role !== "admin") fail(403, "forbidden", "Only administrators can review removal requests");
}

// What an instructor sees about their own request.
export const instructorView = (r) => ({
	id: r.id,
	learnerId: r.learner_id || null,
	learnerName: r.learner_name,
	status: r.status,
	reasonCode: r.reason_code,
	reason: reasonLabel(r.reason_code),
	comments: r.comments || "",
	createdAt: iso(r.created_at),
	decidedAt: iso(r.decided_at),
	decisionNote: r.decision_note || "", // the administrator's explanation
});

// ------------------------------------------------------------------ instructor

export { removalEligibility } from "./eligibility.js";

export async function createRequest(repo, actor, input, ctx = {}) {
	requireInstructor(actor);
	const b = input && typeof input === "object" ? input : {};
	const learnerId = String(b.learnerId || "");
	if (!UUID.test(learnerId)) fail(400, "bad_request", "learnerId is required");
	const reasonCode = String(b.reasonCode || "");
	if (!REASON_CODES.includes(reasonCode)) fail(422, "invalid_reason", "Choose a reason for the removal.");
	const comments = clean(b.comments, COMMENT_MAX);
	if (reasonCode === "other" && comments.length < MIN_TEXT) fail(422, "invalid_comments", "Tell us the reason when you choose Other.");

	// The relationship is validated on the server from the database, never from anything the client claims.
	const learner = await repo.getLearner(learnerId);
	if (!learner) fail(404, "not_found", "Learner not found");
	if (learner.owner_user_id === actor.userId) fail(422, "not_removable", "You own this profile, so it can't be removed from your account.");
	const link = await repo.getGuardian(learner.id, actor.userId);
	if (!link || link.relation !== "instructor") fail(404, "not_found", "Learner not found"); // another instructor's learner looks the same as a missing one
	if (await repo.findPending(actor.userId, learner.id)) fail(409, "duplicate_pending", "A removal request for this student is already waiting for approval.");

	const now = ctx.now || new Date();
	const row = {
		id: uuidv4(),
		instructor_id: actor.userId,
		learner_id: learner.id,
		learner_name: String(learner.display_name || "Learner").slice(0, 40),
		student_user_id: learner.student_user_id || null,
		relation: "instructor_link",
		reason_code: reasonCode,
		comments: comments || null,
		status: "pending",
		pending_key: `${actor.userId}:${learner.id}`,
		created_at: now,
		updated_at: now,
	};
	await repo.transaction(async (tx) => {
		await tx.insertRequest(row); // the unique pending_key turns a race between two tabs into a 409
		await tx.audit({ actor_user_id: actor.userId, learner_id: learner.id, action: "student_removal.request", details: { requestId: row.id, reason: reasonCode }, ip: ctx.ip || null });
	});
	await notifyRequested(repo, row, { instructorName: actor.name || "", now });
	return { request: instructorView(row) };
}

export async function listMine(repo, actor) {
	requireInstructor(actor);
	return { requests: (await repo.listByInstructor(actor.userId)).map(instructorView) }; // only the caller's own requests
}

// ------------------------------------------------------------------ administrator

async function hydrate(repo, rows) {
	const ids = [...new Set(rows.flatMap((r) => [r.instructor_id, r.student_user_id, r.decided_by]).filter(Boolean))];
	const users = new Map((await repo.getUsersByIds(ids)).map((u) => [u.id, u]));
	const person = (id) => {
		const u = id && users.get(id);
		return u ? { id: u.id, name: fullName(u), email: u.email } : null;
	};
	return rows.map((r) => ({
		id: r.id,
		status: r.status,
		learnerId: r.learner_id || null,
		learnerName: r.learner_name,
		profileExists: !!r.learner_id,
		instructor: person(r.instructor_id),
		student: person(r.student_user_id), // the linked account, if the profile has one
		reasonCode: r.reason_code,
		reason: reasonLabel(r.reason_code),
		comments: r.comments || "",
		createdAt: iso(r.created_at),
		decidedAt: iso(r.decided_at),
		decidedBy: person(r.decided_by),
		decisionNote: r.decision_note || "",
	}));
}

export async function listAll(repo, actor, filters = {}) {
	requireAdmin(actor);
	const status = String(filters.status || "");
	if (status && !STATUSES.includes(status)) fail(422, "invalid", "Unknown status");
	return { requests: await hydrate(repo, await repo.listAll(status || null)) };
}

export async function getOne(repo, actor, id) {
	requireAdmin(actor);
	if (!UUID.test(String(id || ""))) fail(422, "invalid", "Invalid request id");
	const r = await repo.getRequest(id);
	if (!r) fail(404, "not_found", "Request not found");
	const [view] = await hydrate(repo, [r]);
	// Is the link still there to remove? (A parent may already have removed it.)
	const link = r.learner_id ? await repo.getGuardian(r.learner_id, r.instructor_id) : null;
	return { request: { ...view, linkActive: !!link && link.relation === "instructor" } };
}

export async function decide(repo, actor, id, input, ctx = {}) {
	requireAdmin(actor);
	if (!UUID.test(String(id || ""))) fail(422, "invalid", "Invalid request id");
	const b = input && typeof input === "object" ? input : {};
	const action = String(b.action || "");
	if (action !== "approve" && action !== "reject") fail(422, "invalid", "Action must be approve or reject");
	const note = clean(b.note, NOTE_MAX);
	if (action === "reject" && note.length < MIN_TEXT) fail(422, "note_required", "Explain why this request is rejected.");
	const now = ctx.now || new Date();
	const status = action === "approve" ? "approved" : "rejected";

	const out = await repo.transaction(async (tx) => {
		const req = await tx.lockRequest(id); // SELECT ... FOR UPDATE: a second admin waits, then sees it decided
		if (!req) fail(404, "not_found", "Request not found");
		if (req.status !== "pending") fail(409, "already_decided", `This request was already ${req.status}. A decision can't be changed.`);

		let removed = 0;
		let recipients = [];
		let learner = null;
		if (action === "approve") {
			learner = req.learner_id ? await tx.getLearner(req.learner_id) : null;
			if (!learner) fail(409, "profile_gone", "This learner profile no longer exists. Reject the request instead.");
			recipients = await tx.recipientsFor(learner); // owner, linked student account and parents, read BEFORE the change
			// The one and only data change: this instructor's own link to this learner.
			removed = await tx.deleteInstructorLink(learner.id, req.instructor_id);
		}
		const changed = await tx.decide(id, { status, decided_by: actor.userId, decided_at: now, decision_note: note || null, pending_key: null });
		if (!changed) fail(409, "already_decided", "This request was just decided by someone else."); // rolls the link removal back too
		await tx.audit({
			actor_user_id: actor.userId,
			learner_id: req.learner_id || null,
			action: `student_removal.${action}`,
			details: { requestId: req.id, instructorId: req.instructor_id, relation: req.relation, linksRemoved: removed, note: note || null },
			ip: ctx.ip || null,
		});
		return { req, removed, recipients, learner };
	});

	await notifyDecision(repo, action, out.req, { note, removed: out.removed, recipients: out.recipients, learner: out.learner, adminId: actor.userId, now });
	const [view] = await hydrate(repo, [await repo.getRequest(id)]);
	return { request: view, linksRemoved: out.removed };
}
