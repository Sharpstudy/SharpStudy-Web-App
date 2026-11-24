// Telecaller applications (Phase 2: apply, review, approve, manage approved telecallers).
// Pure with respect to storage, e-mail and the clock: the repository, mailer, audit hook and clock are passed in
// (`deps`), so every rule here is tested without a database or a mail server (see tests/telecallers).
//
// Rules in short
//  - An application NEVER grants access. Approval (an admin action, role re-read from the database by the API layer)
//    writes the application status, its history row and a telecaller_profiles row in ONE compare-and-set transaction.
//    users.role is never read for authority and never changed: only an ACTIVE telecaller_profiles row will (in a later
//    phase) open the telecaller dashboard, and an admin can deactivate / reactivate it.
//  - Nothing here trusts ids, roles or statuses from the browser: actors come from the verified token + database, and an
//    applicant only ever loads THEIR OWN row (by actor.userId). Unknown form keys (status, role, user_id ...) are dropped.
//  - One application per user (unique in the database). A rejected applicant may start a NEW attempt after the waiting
//    period; the attempt number goes up, nothing earlier is deleted: every status change is an append-only event tagged
//    with its attempt, and every resume is an immutable version tagged with its attempt.
//  - Eligible applicants: signed-in, e-mail-confirmed, active, non-admin accounts that are not a child's learner login.
//    They must confirm they are at least 18. Parent-only accounts may apply.
//  - Admin notes are never part of the applicant view or any e-mail. Resume bytes are never part of any view: the
//    admin-only download is the only place they are read.
//  - Every submit / resubmit event stores a SNAPSHOT of the complete submitted form (form_snapshot), tagged with its
//    attempt by the event itself. Snapshots are written once with their event and never updated, so the answers of earlier
//    attempts survive edits and new attempts. Only the admin view returns them; they hold the form fields and a reference
//    to the resume versions, never admin notes, feedback or file bytes. Events without one (older ones) work as before.
//  - E-mail failures never undo a recorded application or decision; the outcome is stored on the history row.

import isEmail from "validator/lib/isEmail.js";
import { v4 as uuidv4 } from "uuid";
import { accountIsActive } from "../auth/accountState.js";
import { applicantEmail, adminNewApplicationEmail } from "./emails.js";
import { notifySubmitted, notifyApplicant } from "./notify.js";
import { QUALIFICATIONS, EMPLOYMENT, RESUME, validPhone, validateForSubmit } from "./rules.js";
import { checkResume, ResumeError, mimeFor } from "./resume.js";

export { QUALIFICATIONS, EMPLOYMENT, RESUME, validateForSubmit };

export class TelecallerError extends Error {
	constructor(status, code, message, fields) {
		super(message);
		this.status = status;
		this.code = code;
		if (fields) this.fields = fields;
	}
}
const fail = (...a) => {
	throw new TelecallerError(...a);
};

export const STATUSES = ["draft", "pending", "more_info_requested", "approved", "rejected"];
export const REAPPLY_DAYS = 30;
export const PAGE_SIZE = 10;

// Allowed status changes (everything else is refused). `by` is who may make the change.
export const TRANSITIONS = {
	submit: { from: ["draft", "more_info_requested"], to: "pending", by: "applicant" },
	reapply: { from: ["rejected"], to: "draft", by: "applicant" },
	request_info: { from: ["pending"], to: "more_info_requested", by: "admin" },
	approve: { from: ["pending"], to: "approved", by: "admin" },
	reject: { from: ["pending"], to: "rejected", by: "admin" },
};
export const EDITABLE = ["draft", "more_info_requested"]; // the applicant may change the form / add resumes only here
export const OPEN = ["pending", "more_info_requested"];

// ---------------------------------------------------------------- cleaning

const ctl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const line = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const text = (s, max) => String(s == null ? "" : s).replace(ctl, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const bool = (v) => (v === true || v === "true" || v === 1 || v === "1" ? true : v === false || v === "false" || v === 0 || v === "0" ? false : null);
const int = (v) => {
	if (v === "" || v == null) return null;
	const n = Number(v);
	return Number.isInteger(n) ? n : NaN;
};
const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const iso = (d) => (d ? new Date(d).toISOString() : null);

export const FORM_FIELDS = ["full_name", "phone", "city", "state", "qualification", "has_telecalling_experience", "experience_years", "previous_company", "languages", "employment_preference", "additional_info", "confirmed_adult", "consented_privacy"];

// Normalises ONLY known form fields that are present in `input` (anything else, including status / role / user ids, is
// dropped). Returns { values, errors } where errors are format problems of the values that were given.
export function cleanForm(input) {
	const b = input && typeof input === "object" ? input : {};
	const values = {};
	const errors = {};
	const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
	const str = (k, max, multi) => has(k) && (values[k] = (multi ? text : line)(b[k], max));

	str("full_name", 120); str("phone", 40); str("city", 80); str("state", 80); str("previous_company", 160); str("languages", 300); str("additional_info", 3000, true);

	if (has("qualification")) values.qualification = QUALIFICATIONS.includes(b.qualification) ? b.qualification : null;
	if (has("employment_preference")) values.employment_preference = EMPLOYMENT.includes(b.employment_preference) ? b.employment_preference : null;
	if (has("has_telecalling_experience")) values.has_telecalling_experience = bool(b.has_telecalling_experience);
	if (has("confirmed_adult")) values.confirmed_adult = bool(b.confirmed_adult) === true;
	if (has("consented_privacy")) values.consented_privacy = bool(b.consented_privacy) === true;

	if (has("phone") && values.phone && !validPhone(values.phone)) errors.phone = "Enter a valid phone number (7 to 15 digits).";
	if (has("experience_years")) {
		const y = int(b.experience_years);
		if (y === null) values.experience_years = null;
		else if (Number.isNaN(y) || y < 0 || y > 60) errors.experience_years = "Enter whole years between 0 and 60.";
		else values.experience_years = y;
	}
	// No experience means no years, whatever the browser sent.
	if (values.has_telecalling_experience === false) values.experience_years = null;
	return { values, errors };
}

// ---------------------------------------------------------------- snapshots

export const SNAPSHOT_VERSION = 1;

// The complete form exactly as submitted, plus which resume versions were attached at that moment. Built from the merged
// (stored + submitted) form, so it is what the validation just accepted. Plain data: safe to store as JSON.
export function buildSnapshot(form, resumes) {
	const fields = {};
	for (const k of FORM_FIELDS) fields[k] = form[k] === undefined ? null : form[k];
	return {
		v: SNAPSHOT_VERSION,
		attempt: form.attempt,
		fields,
		resumes: (resumes || []).map((r) => ({ id: r.id, filename: r.original_filename, mime_type: r.mime_type, size_bytes: r.size_bytes, sha256: r.sha256 })),
	};
}

// What the admin view returns for an event's stored snapshot, or null (no snapshot, or one in a shape we do not know).
// Only the known form fields come back, whatever the stored JSON holds.
export function snapshotView(raw) {
	let s = raw;
	if (typeof s === "string") {
		try {
			s = JSON.parse(s);
		} catch (e) {
			return null;
		}
	}
	if (!s || typeof s !== "object" || !s.fields || typeof s.fields !== "object") return null;
	const fields = {};
	for (const k of FORM_FIELDS) fields[k] = s.fields[k] === undefined ? null : s.fields[k];
	return { v: s.v || 1, attempt: s.attempt == null ? null : s.attempt, fields, resumes: Array.isArray(s.resumes) ? s.resumes.map((r) => ({ id: r.id, filename: r.filename, mime_type: r.mime_type, size_bytes: r.size_bytes, sha256: r.sha256 })) : [] };
}

// ---------------------------------------------------------------- views

const resumeMeta = (r, currentAttempt) => ({ id: r.id, attempt: r.attempt, filename: r.original_filename, mime_type: r.mime_type, size_bytes: r.size_bytes, sha256: r.sha256, uploaded_at: iso(r.uploaded_at), current: r.attempt === currentAttempt });
const reapplyAt = (app, days) => (app.status === "rejected" && app.decided_at ? new Date(new Date(app.decided_at).getTime() + days * 86400000) : null);

// What the applicant may see: their form, status, resume list (no file bytes) and the feedback written for them.
// Never admin notes or internal notes.
export function applicantView(app, events, resumes, { now = new Date(), reapplyDays = REAPPLY_DAYS } = {}) {
	if (!app) return null;
	const out = { id: app.id, status: app.status, attempt: app.attempt, submitted_at: iso(app.submitted_at), decided_at: iso(app.decided_at), feedback: app.feedback || null };
	for (const k of FORM_FIELDS) out[k] = app[k] === undefined ? null : app[k];
	out.can_edit = EDITABLE.includes(app.status);
	const at = reapplyAt(app, reapplyDays);
	out.can_reapply = app.status === "rejected" && (!at || at <= now);
	out.reapply_after = app.status === "rejected" && at && at > now ? iso(at) : null;
	out.resumes = (resumes || []).map((r) => resumeMeta(r, app.attempt));
	out.history = (events || []).map((ev) => ({ attempt: ev.attempt, from: ev.from_status || null, to: ev.to_status, at: iso(ev.created_at), feedback: ev.feedback || null }));
	return out;
}

// The admin's full review record, grouped by attempt so earlier attempts (decisions, feedback, resumes) stay visible.
export function adminView(app, user, events, resumes, profile, names = new Map(), { reapplyDays = REAPPLY_DAYS } = {}) {
	const out = applicantView(app, [], resumes, { now: new Date(0), reapplyDays });
	const attempts = new Map();
	const slot = (n) => attempts.get(n) || attempts.set(n, { attempt: n, events: [], resumes: [] }).get(n);
	slot(app.attempt);
	for (const ev of events || []) slot(ev.attempt || 1).events.push({ id: ev.id, from: ev.from_status || null, to: ev.to_status, actor: ev.actor, actor_user_id: ev.actor_user_id || null, actor_name: names.get(ev.actor_user_id) || null, at: iso(ev.created_at), feedback: ev.feedback || null, internal_note: ev.internal_note || null, email_status: ev.email_status || "none", submission: ev.actor === "applicant" && ev.to_status === "pending", snapshot: snapshotView(ev.form_snapshot) });
	for (const r of resumes || []) slot(r.attempt).resumes.push(resumeMeta(r, app.attempt));
	return {
		...out,
		can_reapply: undefined,
		reapply_after: iso(reapplyAt(app, reapplyDays)),
		admin_notes: app.admin_notes || "",
		decided_by: app.decided_by || null,
		decided_by_name: names.get(app.decided_by) || null,
		consented_at: iso(app.consented_at),
		version: app.version,
		applicant: user ? { id: user.id, email: user.email, name: `${user.first_name || ""} ${user.last_name || ""}`.trim(), role: user.role, email_confirmed: !!user.email_confirmed, profile_photo: user.profile_photo || null } : null,
		attempts: [...attempts.values()].sort((a, b) => a.attempt - b.attempt),
		profile: profile ? profileView(profile, names) : null,
		allowed: Object.entries(TRANSITIONS).filter(([, t]) => t.by === "admin" && t.from.includes(app.status)).map(([k]) => k),
	};
}

const profileView = (p, names = new Map()) => ({
	user_id: p.user_id,
	application_id: p.application_id || null,
	status: p.status,
	approved_at: iso(p.approved_at),
	approved_by_name: names.get(p.approved_by) || null,
	status_changed_at: iso(p.status_changed_at),
	status_changed_by_name: names.get(p.status_changed_by) || null,
	status_reason: p.status_reason || null,
	version: p.version,
});

// ---------------------------------------------------------------- actors

const requireActor = (actor) => {
	if (!actor || !actor.userId) fail(401, "unauthenticated", "Sign in required");
	return actor;
};
const requireAdmin = (actor) => {
	requireActor(actor);
	if (actor.role !== "admin") fail(403, "forbidden", "You do not have permission to do this");
	return actor;
};

async function loadApplicant(deps, actor) {
	requireActor(actor);
	const user = await deps.repo.getUser(actor.userId);
	if (!accountIsActive(user)) fail(401, "unauthenticated", "Sign in required");
	return user;
}

// null when the account may apply, otherwise the reason (also used by the status page).
async function ineligibleReason(deps, user) {
	if (user.role === "admin") return "Administrator accounts cannot apply as telecallers.";
	if (await deps.repo.isLearnerAccount(user.id)) return "A child's learner login cannot apply as a telecaller.";
	return null;
}
async function requireEligible(deps, user) {
	const why = await ineligibleReason(deps, user);
	if (why) fail(403, "not_eligible", why);
}

const nameOf = (u) => `${(u && u.first_name) || ""} ${(u && u.last_name) || ""}`.trim();
const reapplyDaysOf = (deps) => deps.reapplyDays || REAPPLY_DAYS;
const viewOpts = (deps) => ({ now: deps.now(), reapplyDays: reapplyDaysOf(deps) });

async function namesFor(deps, events, app, profile) {
	const ids = new Set([...(events || []).map((e) => e.actor_user_id), app && app.decided_by, profile && profile.approved_by, profile && profile.status_changed_by].filter(Boolean));
	const users = ids.size ? await deps.repo.getUsersByIds([...ids]) : [];
	return new Map(users.map((u) => [u.id, nameOf(u)]));
}

// ---------------------------------------------------------------- applicant

// The applicant's own application (or null) plus what the form needs. Looked up by the verified user id only.
export async function getMine(deps, actor) {
	const user = await loadApplicant(deps, actor);
	const app = await deps.repo.findByUser(user.id);
	const [events, resumes, profile] = await Promise.all([app ? deps.repo.listEvents(app.id) : [], app ? deps.repo.listResumes(app.id) : [], deps.repo.getProfile(user.id)]);
	const why = await ineligibleReason(deps, user);
	return {
		application: applicantView(app, events, resumes, viewOpts(deps)),
		eligible: !why,
		ineligible_reason: why,
		email_confirmed: !!user.email_confirmed,
		// What the applicant is told about their access. Approval alone is not access: only an active profile will be.
		access: profile ? { status: profile.status } : null,
		prefill: { full_name: nameOf(user), email: user.email, phone: user.phone || "", profile_photo: user.profile_photo || "" },
		policy: { reapply_days: reapplyDaysOf(deps), resume_max_bytes: RESUME.maxBytes, resume_types: RESUME.extensions, resume_max_per_attempt: RESUME.maxPerAttempt },
	};
}

async function ensureDraft(deps, user, values = {}) {
	let app = await deps.repo.findByUser(user.id);
	if (app) return app;
	const created = await deps.repo.createApplication(
		{ user_id: user.id, status: "draft", attempt: 1, version: 0, full_name: nameOf(user), ...values },
		{ id: uuidv4(), attempt: 1, from_status: null, to_status: "draft", actor: "applicant", actor_user_id: user.id }
	);
	// Two tabs created it at once: the database allows one application per user, so use the one that won.
	app = created || (await deps.repo.findByUser(user.id));
	if (!app) fail(409, "conflict", "The application could not be created. Please try again.");
	return app;
}

// Create or update the applicant's DRAFT (or a "more information requested" application). Never changes status.
export async function saveDraft(deps, actor, input) {
	const user = await loadApplicant(deps, actor);
	await requireEligible(deps, user);
	const { values, errors } = cleanForm(input);
	if (Object.keys(errors).length) fail(422, "invalid", "Please fix the highlighted fields.", errors);
	let app = await deps.repo.findByUser(user.id);
	if (!app) {
		app = await ensureDraft(deps, user, values);
	} else {
		if (!EDITABLE.includes(app.status)) fail(409, "locked", "This application can no longer be edited.");
		const saved = await deps.repo.updateIf(app.id, { version: app.version, statuses: EDITABLE }, values, null);
		if (!saved) fail(409, "conflict", "The application changed. Reload and try again.");
		app = saved;
	}
	return { application: applicantView(app, await deps.repo.listEvents(app.id), await deps.repo.listResumes(app.id), viewOpts(deps)) };
}

// Add a resume VERSION for the current attempt. Older versions (this or earlier attempts) are never replaced or removed.
export async function uploadResume(deps, actor, input) {
	const user = await loadApplicant(deps, actor);
	await requireEligible(deps, user);
	let file;
	try {
		file = checkResume(input);
	} catch (e) {
		if (e instanceof ResumeError) fail(422, e.code, e.message, { resume: e.message });
		throw e;
	}
	const app = await ensureDraft(deps, user);
	if (!EDITABLE.includes(app.status)) fail(409, "locked", "This application can no longer be edited.");
	const existing = await deps.repo.findResumeByHash(app.id, app.attempt, file.sha256);
	if (!existing) {
		if ((await deps.repo.countResumes(app.id, app.attempt)) >= RESUME.maxPerAttempt) fail(409, "too_many", `You can upload up to ${RESUME.maxPerAttempt} resume versions per application attempt.`);
		await deps.repo.addResume({ id: uuidv4(), application_id: app.id, attempt: app.attempt, original_filename: file.filename, mime_type: file.mime, size_bytes: file.size, sha256: file.sha256, data: file.buffer });
	}
	return { application: applicantView(app, await deps.repo.listEvents(app.id), await deps.repo.listResumes(app.id), viewOpts(deps)), duplicate: !!existing };
}

// Submit (or resubmit after a request for more information). Saves any fields sent with it, then validates everything.
export async function submitApplication(deps, actor, input) {
	const user = await loadApplicant(deps, actor);
	await requireEligible(deps, user);
	if (!user.email_confirmed) fail(403, "email_unverified", "Confirm your email address before applying.");
	const app = await deps.repo.findByUser(user.id);
	if (!app) fail(404, "no_application", "Start an application first.");
	if (!TRANSITIONS.submit.from.includes(app.status)) fail(409, "invalid_transition", `An application that is ${app.status.replace(/_/g, " ")} cannot be submitted.`);
	const { values, errors: fmt } = cleanForm(input);
	const merged = { ...app, ...values };
	const attached = (await deps.repo.listResumes(app.id)).filter((r) => r.attempt === app.attempt);
	const errors = { ...validateForSubmit(merged, { resumeCount: attached.length }), ...fmt };
	if (Object.keys(errors).length) fail(422, "invalid", "Please complete the required fields.", errors);
	const resubmission = app.status === "more_info_requested";
	const now = deps.now();
	const eventId = uuidv4();
	const saved = await deps.repo.transition(
		app.id,
		{ version: app.version, statuses: TRANSITIONS.submit.from },
		{ ...values, status: "pending", submitted_at: now, consented_at: now, feedback: resubmission ? app.feedback : null },
		// The snapshot is written once, with this event, and never changed: later edits and new attempts add events, they do not touch it.
		{ id: eventId, attempt: app.attempt, from_status: app.status, to_status: "pending", actor: "applicant", actor_user_id: user.id, feedback: resubmission ? "Applicant responded and resubmitted." : null, form_snapshot: buildSnapshot(merged, attached) }
	);
	if (!saved) fail(409, "conflict", "The application changed. Reload and try again.");
	await audit(deps, "telecaller_application.submit", user.id, { applicationId: saved.id, attempt: saved.attempt });
	await emailApplicant(deps, resubmission ? "resubmitted" : "submitted", saved, user, eventId);
	await notifyAdmins(deps, saved, user, resubmission);
	const fresh = await deps.repo.findById(saved.id);
	return { application: applicantView(fresh, await deps.repo.listEvents(saved.id), await deps.repo.listResumes(saved.id), viewOpts(deps)) };
}

// A rejected applicant may open a NEW attempt only after the waiting period. This never grants access, and nothing from
// the earlier attempt (events, feedback, resumes) is removed.
export async function reapply(deps, actor) {
	const user = await loadApplicant(deps, actor);
	await requireEligible(deps, user);
	const app = await deps.repo.findByUser(user.id);
	if (!app) fail(404, "no_application", "No application found.");
	if (!TRANSITIONS.reapply.from.includes(app.status)) fail(409, "invalid_transition", "You can only start a new application after a rejected one.");
	const at = reapplyAt(app, reapplyDaysOf(deps));
	if (at && at > deps.now()) fail(403, "cooldown", "You can apply again after the waiting period shown on your status page.");
	const next = app.attempt + 1;
	const saved = await deps.repo.transition(
		app.id,
		{ version: app.version, statuses: TRANSITIONS.reapply.from },
		{ status: "draft", attempt: next, feedback: null, submitted_at: null, decided_at: null, decided_by: null, confirmed_adult: false, consented_privacy: false, consented_at: null },
		{ id: uuidv4(), attempt: next, from_status: app.status, to_status: "draft", actor: "applicant", actor_user_id: user.id, feedback: "Started a new application." }
	);
	if (!saved) fail(409, "conflict", "The application changed. Reload and try again.");
	await audit(deps, "telecaller_application.reapply", user.id, { applicationId: saved.id, attempt: saved.attempt });
	return { application: applicantView(saved, await deps.repo.listEvents(saved.id), await deps.repo.listResumes(saved.id), viewOpts(deps)) };
}

// ---------------------------------------------------------------- admin: applications

// view "open" (pending + more information requested, the default) or "rejected"; `status` narrows within the view.
export async function listApplications(deps, actor, query = {}) {
	requireAdmin(actor);
	const view = query.view === "rejected" ? "rejected" : "open";
	const pool = view === "rejected" ? ["rejected"] : OPEN;
	const statuses = pool.includes(query.status) ? [query.status] : pool;
	const q = line(query.q, 80);
	const page = Math.max(1, parseInt(query.page, 10) || 1);
	const { rows, count } = await deps.repo.list({ q, statuses, page, pageSize: PAGE_SIZE });
	const counts = await deps.repo.counts();
	return {
		view,
		applications: rows.map((r) => ({ id: r.id, user_id: r.user_id, name: r.full_name || r.applicant_name || "", email: r.applicant_email || "", phone: r.phone || "", city: r.city || "", state: r.state || "", qualification: r.qualification ? String(r.qualification).replace(/_/g, " ") : "", experience: r.has_telecalling_experience === true ? `${r.experience_years == null ? 0 : r.experience_years} yr` : r.has_telecalling_experience === false ? "No experience" : "", employment_preference: r.employment_preference || "", status: r.status, attempt: r.attempt, submitted_at: iso(r.submitted_at), decided_at: iso(r.decided_at) })),
		count,
		page,
		pages: Math.max(1, Math.ceil(count / PAGE_SIZE)),
		counts: Object.fromEntries(["pending", "more_info_requested", "approved", "rejected"].map((s) => [s, counts[s] || 0])),
	};
}

export async function getApplication(deps, actor, id) {
	requireAdmin(actor);
	const app = isUuid(id) ? await deps.repo.findById(id) : null;
	if (!app || app.status === "draft") fail(404, "not_found", "Application not found");
	return adminViewFor(deps, app);
}

async function adminViewFor(deps, app) {
	const [user, events, resumes, profile] = await Promise.all([deps.repo.getUser(app.user_id), deps.repo.listEvents(app.id), deps.repo.listResumes(app.id), deps.repo.getProfile(app.user_id)]);
	return adminView(app, user, events, resumes, profile, await namesFor(deps, events, app, profile), { reapplyDays: reapplyDaysOf(deps) });
}

// One entry point for every admin decision. `body` = { action, confirm, feedback, admin_notes }.
// Only an admin (role re-read from the database by the API layer, re-checked here) may call it.
export async function reviewAction(deps, actor, id, body = {}) {
	requireAdmin(actor);
	const action = String(body.action || "");
	const app = isUuid(id) ? await deps.repo.findById(id) : null;
	if (!app || app.status === "draft") fail(404, "not_found", "Application not found");
	const user = await deps.repo.getUser(app.user_id);
	if (!user) fail(404, "not_found", "Applicant account not found");
	const now = deps.now();
	const feedback = text(body.feedback, 2000);
	const note = text(body.admin_notes, 4000);

	if (action === "save_notes") {
		const saved = await deps.repo.updateIf(app.id, { version: app.version, statuses: STATUSES.filter((s) => s !== "draft") }, { admin_notes: note }, null);
		if (!saved) fail(409, "conflict", "The application changed. Reload and try again.");
		return { application: await adminViewFor(deps, saved) };
	}

	const t = TRANSITIONS[action];
	if (!t || t.by !== "admin") fail(422, "invalid_action", "Unknown action");
	if (!t.from.includes(app.status)) fail(409, "invalid_transition", `An application that is ${app.status.replace(/_/g, " ")} cannot be changed with "${action.replace(/_/g, " ")}".`);
	// Consequential actions need explicit confirmation from the caller.
	if (["approve", "reject"].includes(action) && body.confirm !== true) fail(422, "confirmation_required", "Confirm this action to continue.");
	if (["request_info", "reject"].includes(action) && feedback.length < 10) fail(422, "invalid", "Write a message for the applicant (at least 10 characters).", { feedback: "Required" });

	const patch = { status: t.to };
	if (note) patch.admin_notes = note;
	let profile = null;

	if (action === "approve") {
		if (app.user_id === actor.userId) fail(403, "self_approval", "You cannot approve your own application.");
		if (!user.email_confirmed) fail(409, "email_unverified", "The applicant has not verified their email address.");
		if (!accountIsActive(user)) fail(409, "account_disabled", "The applicant's account is disabled.");
		if (user.role === "admin") fail(409, "not_eligible", "Administrator accounts cannot be approved as telecallers.");
		if (await deps.repo.isLearnerAccount(user.id)) fail(409, "not_eligible", "A child's learner login cannot be approved as a telecaller.");
		patch.decided_at = now;
		patch.decided_by = actor.userId;
		patch.feedback = feedback || null;
		// The ONLY thing approval grants: an active telecaller profile. users.role is not touched.
		profile = { user_id: user.id, application_id: app.id, status: "active", approved_at: now, approved_by: actor.userId, status_changed_at: now, status_changed_by: actor.userId, version: 0 };
	} else if (action === "reject") {
		patch.decided_at = now;
		patch.decided_by = actor.userId;
		patch.feedback = feedback;
	} else if (action === "request_info") {
		patch.feedback = feedback;
	}

	const eventId = uuidv4();
	const saved = await deps.repo.transition(
		app.id,
		{ version: app.version, statuses: t.from },
		patch,
		{ id: eventId, attempt: app.attempt, from_status: app.status, to_status: t.to, actor: "admin", actor_user_id: actor.userId, feedback: feedback || null, internal_note: note || null },
		profile
	);
	if (!saved) fail(409, "conflict", "This application was changed by someone else. Reload and try again.");
	await audit(deps, `telecaller_application.${action}`, actor.userId, { applicationId: app.id, applicantId: user.id, attempt: app.attempt, from: app.status, to: t.to });
	const kind = { request_info: "more_info", approve: "approved", reject: "rejected" }[action];
	await notifyApplicant(deps.repo, kind, { userId: user.id, applicationId: app.id, version: saved.version, message: feedback, now });
	await emailApplicant(deps, kind, saved, user, eventId, feedback);
	return { application: await adminViewFor(deps, await deps.repo.findById(app.id)) };
}

// Admin-only download of one resume version. The only place the file bytes are read.
export async function getResumeForAdmin(deps, actor, id) {
	requireAdmin(actor);
	const r = isUuid(id) ? await deps.repo.getResumeWithData(id) : null;
	if (!r) fail(404, "not_found", "Resume not found");
	const app = await deps.repo.findById(r.application_id);
	await audit(deps, "telecaller_resume.download", actor.userId, { resumeId: r.id, applicationId: r.application_id, applicantId: app ? app.user_id : null, attempt: r.attempt, sha256: r.sha256 });
	const known = Object.values({ pdf: mimeFor("pdf"), doc: mimeFor("doc"), docx: mimeFor("docx") });
	return { filename: r.original_filename, mime: known.includes(r.mime_type) ? r.mime_type : "application/octet-stream", buffer: r.data, size: r.size_bytes };
}

// ---------------------------------------------------------------- admin: approved telecallers

export async function listMembers(deps, actor, query = {}) {
	requireAdmin(actor);
	const status = ["active", "inactive"].includes(query.status) ? query.status : "";
	const q = line(query.q, 80);
	const page = Math.max(1, parseInt(query.page, 10) || 1);
	const { rows, count } = await deps.repo.listProfiles({ q, status, page, pageSize: PAGE_SIZE });
	const counts = await deps.repo.profileCounts();
	return {
		members: rows.map((r) => ({ user_id: r.user_id, name: r.name || "", email: r.email || "", phone: r.phone || "", city: r.city || "", state: r.state || "", status: r.status, approved_at: iso(r.approved_at), status_changed_at: iso(r.status_changed_at), status_reason: r.status_reason || null, application_id: r.application_id || null })),
		count,
		page,
		pages: Math.max(1, Math.ceil(count / PAGE_SIZE)),
		counts: { active: counts.active || 0, inactive: counts.inactive || 0 },
	};
}

export async function getMember(deps, actor, userId) {
	requireAdmin(actor);
	const profile = isUuid(userId) ? await deps.repo.getProfile(userId) : null;
	if (!profile) fail(404, "not_found", "Telecaller not found");
	const app = profile.application_id ? await deps.repo.findById(profile.application_id) : await deps.repo.findByUser(userId);
	return { profile: profileView(profile, await namesFor(deps, [], app, profile)), application: app && app.status !== "draft" ? await adminViewFor(deps, app) : null };
}

// Activate / deactivate an approved telecaller. Takes effect on the telecaller's next request: access is read from this
// row every time, there is no token claim or cache to wait out.
export async function setMemberStatus(deps, actor, userId, body = {}) {
	requireAdmin(actor);
	const action = String(body.action || "");
	if (!["activate", "deactivate"].includes(action)) fail(422, "invalid_action", "Unknown action");
	const profile = isUuid(userId) ? await deps.repo.getProfile(userId) : null;
	if (!profile) fail(404, "not_found", "Telecaller not found");
	const to = action === "activate" ? "active" : "inactive";
	if (profile.status === to) fail(409, "invalid_transition", `This telecaller is already ${to}.`);
	const reason = line(body.reason, 300);
	if (action === "deactivate" && reason.length < 10) fail(422, "invalid", "Write a reason (at least 10 characters).", { reason: "Required" });
	const now = deps.now();
	const saved = await deps.repo.updateProfileIf(userId, { version: profile.version }, { status: to, status_changed_at: now, status_changed_by: actor.userId, status_reason: reason || null });
	if (!saved) fail(409, "conflict", "This telecaller was changed by someone else. Reload and try again.");
	await audit(deps, `telecaller_profile.${action}`, actor.userId, { telecallerId: userId, from: profile.status, to, reason });
	const user = await deps.repo.getUser(userId);
	const kind = action === "activate" ? "reactivated" : "deactivated";
	if (profile.application_id) await notifyApplicant(deps.repo, kind, { userId, applicationId: profile.application_id, version: saved.version, message: reason, now });
	if (user) await emailAccess(deps, kind, user, reason);
	return getMember(deps, actor, userId);
}

export async function getSummary(deps, actor) {
	requireAdmin(actor);
	const [apps, profiles] = await Promise.all([deps.repo.counts(), deps.repo.profileCounts()]);
	return { applications: Object.fromEntries(["pending", "more_info_requested", "approved", "rejected"].map((s) => [s, apps[s] || 0])), telecallers: { active: profiles.active || 0, inactive: profiles.inactive || 0 } };
}

// ---------------------------------------------------------------- side effects (never throw)

async function audit(deps, action, actorUserId, details) {
	try {
		if (deps.audit) await deps.audit(action, actorUserId, details);
	} catch (e) {
		/* the history table already holds the record; auditing must not undo the change */
	}
}

async function send(deps, mail) {
	try {
		if (!mail) return null;
		if (!mail.to || !isEmail(String(mail.to))) return { ok: false, skipped: true, error: "no valid recipient" };
		return await deps.mailer(mail);
	} catch (e) {
		return { ok: false, error: String((e && e.message) || "send failed").slice(0, 200) };
	}
}

// Sends the applicant e-mail and records the real outcome on the history row ("skipped" when e-mail is not configured).
async function emailApplicant(deps, kind, app, user, eventId, message) {
	const result = await send(deps, applicantEmail(kind, { app, user, baseUrl: deps.baseUrl, message }));
	const status = result && result.ok ? "sent" : result && result.skipped ? "skipped" : "failed";
	try {
		if (eventId) await deps.repo.setEventEmail(eventId, status);
	} catch (e) {
		/* bookkeeping only */
	}
}

async function emailAccess(deps, kind, user, message) {
	await send(deps, applicantEmail(kind, { app: null, user, baseUrl: deps.baseUrl, message }));
}

async function notifyAdmins(deps, app, user, resubmitted) {
	try {
		await notifySubmitted(deps.repo, app, { name: nameOf(user), resubmitted, now: deps.now() });
	} catch (e) {
		/* the application is already recorded */
	}
	try {
		if (deps.adminEmail) await deps.mailer(adminNewApplicationEmail({ app, user, baseUrl: deps.baseUrl, to: deps.adminEmail }));
	} catch (e) {
		/* the application is already recorded */
	}
}
