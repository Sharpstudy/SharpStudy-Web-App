// Instructor applications. Pure with respect to storage, e-mail and the clock:
// the repository, mailer, audit hook and clock are passed in (`deps`), so every
// rule here is tested without a database or a mail server (see tests/instructor).
//
// Rules in short
//  - A user becomes an instructor ONLY through approveApplication() below, called by an
//    admin whose role is re-read from the database by the API layer. The role change, the
//    application status and the history row are written in ONE compare-and-set transaction
//    (repo.transition), so two clicks cannot both succeed and a half-applied approval
//    cannot exist.
//  - Nothing here trusts ids or roles from the browser: actors come from the verified
//    token + database, and applicants only ever load THEIR OWN row (by actor.userId).
//  - Applications start as drafts, are submitted (pending) only by verified, ordinary
//    students, and cannot change under a reviewer once submitted.
//  - Admin notes and the rubric are never part of the applicant view.
//  - E-mail failures never undo a recorded application or decision; they are stored on the
//    application and an admin can retry.

import isEmail from "validator/lib/isEmail.js";
import { applicationEmail, adminNewApplicationEmail } from "./emails.js";
import { EDUCATION_LEVELS, STUDENT_LEVELS, TEACHING_MODES, SAMPLE_KINDS, RUBRIC_KEYS, validateForSubmit } from "./rules.js";

export { EDUCATION_LEVELS, STUDENT_LEVELS, TEACHING_MODES, SAMPLE_KINDS, RUBRIC_KEYS, validateForSubmit };

export class ApplicationError extends Error {
	constructor(status, code, message, fields) {
		super(message);
		this.status = status;
		this.code = code;
		if (fields) this.fields = fields;
	}
}
const fail = (...a) => {
	throw new ApplicationError(...a);
};

export const STATUSES = ["draft", "pending", "under_review", "more_info_requested", "approved", "rejected", "revoked"];
export const REAPPLY_DAYS = 30;
const PAGE_SIZE = 10;

// Allowed status changes (everything else is refused). `by` is who may make the change.
export const TRANSITIONS = {
	submit: { from: ["draft", "more_info_requested"], to: "pending", by: "applicant" },
	reapply: { from: ["rejected", "revoked"], to: "draft", by: "applicant" },
	start_review: { from: ["pending"], to: "under_review", by: "admin" },
	request_info: { from: ["pending", "under_review"], to: "more_info_requested", by: "admin" },
	approve: { from: ["pending", "under_review"], to: "approved", by: "admin" },
	reject: { from: ["pending", "under_review"], to: "rejected", by: "admin" },
	revoke: { from: ["approved"], to: "revoked", by: "admin" },
};
export const EDITABLE = ["draft", "more_info_requested"]; // applicant may change the form only here
export const REVIEW_OPEN = ["pending", "under_review", "more_info_requested"];

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
const pickList = (v, allowed) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x) => allowed.includes(x)))];

// https only, no credentials, no obviously internal hosts. Returns the normalised URL or "" / null (invalid).
export function cleanUrl(v) {
	const raw = String(v == null ? "" : v).trim();
	if (!raw) return "";
	if (raw.length > 500) return null;
	let u;
	try {
		u = new URL(raw);
	} catch (e) {
		return null;
	}
	if (u.protocol !== "https:" || u.username || u.password) return null;
	const h = u.hostname.toLowerCase();
	if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.startsWith("[")) return null;
	return u.toString();
}

const FORM_FIELDS = [
	"full_name", "phone", "country", "location", "education_level", "degree", "institution", "graduation_year", "certifications", "profession",
	"has_teaching_experience", "teaching_years", "teaching_modes", "student_levels", "prior_experience", "subjects", "topics", "languages", "expertise_notes",
	"sample_kind", "sample_url", "sample_title", "sample_outline", "methodology", "material_url", "motivation", "agreed_policies", "consented_privacy",
];

// Normalises ONLY known form fields that are present in `input` (anything else, including
// status/role/user ids, is dropped). `categories` are the real category rows for the subject ids.
// Returns { values, errors } where errors are format problems of the values that were given.
export function cleanForm(input, { categories = [], now = new Date() } = {}) {
	const b = input && typeof input === "object" ? input : {};
	const values = {};
	const errors = {};
	const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
	const str = (k, max, multi) => has(k) && (values[k] = (multi ? text : line)(b[k], max));

	str("full_name", 120); str("phone", 40); str("country", 80); str("location", 120);
	str("degree", 160); str("institution", 160); str("profession", 120); str("languages", 200);
	str("certifications", 2000, true); str("prior_experience", 3000, true); str("topics", 1500, true); str("expertise_notes", 3000, true);
	str("sample_title", 160); str("sample_outline", 4000, true); str("methodology", 3000, true); str("motivation", 3000, true);

	if (has("education_level")) values.education_level = EDUCATION_LEVELS.includes(b.education_level) ? b.education_level : "";
	if (has("sample_kind")) values.sample_kind = SAMPLE_KINDS.includes(b.sample_kind) ? b.sample_kind : null;
	if (has("teaching_modes")) values.teaching_modes = pickList(b.teaching_modes, TEACHING_MODES);
	if (has("student_levels")) values.student_levels = pickList(b.student_levels, STUDENT_LEVELS);
	if (has("has_teaching_experience")) values.has_teaching_experience = bool(b.has_teaching_experience);
	if (has("agreed_policies")) values.agreed_policies = bool(b.agreed_policies) === true;
	if (has("consented_privacy")) values.consented_privacy = bool(b.consented_privacy) === true;

	if (has("phone") && values.phone && !/^\+?[0-9 ()\-.]{7,25}$/.test(values.phone)) errors.phone = "Enter a valid phone number.";
	if (has("graduation_year")) {
		const y = int(b.graduation_year);
		if (y === null) values.graduation_year = null;
		else if (Number.isNaN(y) || y < 1950 || y > now.getUTCFullYear() + 6) errors.graduation_year = "Enter a valid graduation year.";
		else values.graduation_year = y;
	}
	if (has("teaching_years")) {
		const y = int(b.teaching_years);
		if (y === null) values.teaching_years = null;
		else if (Number.isNaN(y) || y < 0 || y > 60) errors.teaching_years = "Enter whole years between 0 and 60.";
		else values.teaching_years = y;
	}
	for (const k of ["sample_url", "material_url"]) {
		if (!has(k)) continue;
		const u = cleanUrl(b[k]);
		if (u === null) errors[k] = "Enter a public https:// link.";
		else values[k] = u;
	}
	if (has("subjects")) {
		const ids = [...new Set((Array.isArray(b.subjects) ? b.subjects : []).map((s) => String(s && typeof s === "object" ? s.id : s)))];
		const byId = new Map(categories.map((c) => [c.id, c]));
		const found = ids.filter((i) => byId.has(i)).map((i) => ({ id: i, name: line(byId.get(i).name, 120) }));
		if (found.length !== ids.length) errors.subjects = "Choose subjects from the list.";
		values.subjects = found.slice(0, 12);
	}
	return { values, errors };
}

// ---------------------------------------------------------------- views

const APPLICANT_FIELDS = [...FORM_FIELDS];
const iso = (d) => (d ? new Date(d).toISOString() : null);

// What the applicant may see: their form, status and the feedback written for them. Never admin notes or rubric.
export function applicantView(app, events, now = new Date()) {
	if (!app) return null;
	const out = { id: app.id, status: app.status, attempt: app.attempt, submitted_at: iso(app.submitted_at), decided_at: iso(app.decided_at), feedback: app.applicant_feedback || null };
	for (const k of APPLICANT_FIELDS) out[k] = app[k] === undefined ? null : app[k];
	out.can_edit = EDITABLE.includes(app.status);
	const wait = app.reapply_after && new Date(app.reapply_after) > now ? iso(app.reapply_after) : null;
	out.can_reapply = (app.status === "rejected" || app.status === "revoked") && !wait;
	out.reapply_after = app.status === "rejected" || app.status === "revoked" ? wait : null;
	out.history = (events || []).map((ev) => ({ from: ev.from_status || null, to: ev.to_status, at: iso(ev.created_at), feedback: ev.feedback || null }));
	return out;
}

export function adminView(app, user, events) {
	const out = applicantView(app, [], new Date(0));
	return {
		...out,
		can_reapply: undefined,
		reapply_after: iso(app.reapply_after),
		admin_notes: app.admin_notes || "",
		rubric: app.rubric || {},
		reviewed_at: iso(app.reviewed_at),
		reviewed_by: app.reviewed_by || null,
		notify: { kind: app.notify_kind || null, status: app.notify_status || "none", error: app.notify_error || null },
		version: app.version,
		applicant: user ? { id: user.id, email: user.email, name: `${user.first_name || ""} ${user.last_name || ""}`.trim(), role: user.role, email_confirmed: !!user.email_confirmed, profile_photo: user.profile_photo || null } : null,
		history: (events || []).map((ev) => ({ from: ev.from_status || null, to: ev.to_status, actor: ev.actor, actor_user_id: ev.actor_user_id || null, at: iso(ev.created_at), feedback: ev.feedback || null, internal_note: ev.internal_note || null })),
		allowed: Object.entries(TRANSITIONS)
			.filter(([k, t]) => t.by === "admin" && t.from.includes(app.status))
			.map(([k]) => k),
	};
}

// ---------------------------------------------------------------- applicant

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
	if (!user || user.status === false) fail(401, "unauthenticated", "Sign in required");
	return user;
}

// The applicant's own application (or null) plus what the form needs. Looked up by the verified user id only.
export async function getMine(deps, actor) {
	const user = await loadApplicant(deps, actor);
	const app = await deps.repo.findByUser(user.id);
	const events = app ? await deps.repo.listEvents(app.id) : [];
	return {
		application: applicantView(app, events, deps.now()),
		eligible: user.role === "student",
		role: user.role,
		email_confirmed: !!user.email_confirmed,
		prefill: { full_name: `${user.first_name || ""} ${user.last_name || ""}`.trim(), email: user.email, phone: user.phone || "", profile_photo: user.profile_photo || "" },
		categories: (await deps.repo.listCategories()).map((c) => ({ id: c.id, name: c.name })),
		policy: { reapply_days: deps.reapplyDays || REAPPLY_DAYS },
	};
}

function requireEligible(user) {
	if (user.role === "instructor") fail(409, "already_instructor", "Your account already has instructor access.");
	if (user.role !== "student") fail(403, "not_eligible", "This account type cannot apply to teach.");
}

async function categoriesFor(deps, input) {
	if (!input || !Array.isArray(input.subjects)) return [];
	const ids = input.subjects.map((s) => String(s && typeof s === "object" ? s.id : s));
	return deps.repo.findCategories(ids);
}

// Create or update the applicant's DRAFT (or a "more information requested" application). Never changes status.
export async function saveDraft(deps, actor, input) {
	const user = await loadApplicant(deps, actor);
	requireEligible(user);
	const { values, errors } = cleanForm(input, { categories: await categoriesFor(deps, input), now: deps.now() });
	if (Object.keys(errors).length) fail(422, "invalid", "Please fix the highlighted fields.", errors);
	let app = await deps.repo.findByUser(user.id);
	if (!app) {
		app = await deps.repo.createApplication({ user_id: user.id, status: "draft", attempt: 1, version: 0, full_name: `${user.first_name || ""} ${user.last_name || ""}`.trim(), ...values }, { from_status: null, to_status: "draft", actor: "applicant", actor_user_id: user.id });
	} else {
		if (!EDITABLE.includes(app.status)) fail(409, "locked", "This application can no longer be edited.");
		const saved = await deps.repo.updateIf(app.id, { version: app.version, statuses: EDITABLE }, values, null);
		if (!saved) fail(409, "conflict", "The application changed. Reload and try again.");
		app = saved;
	}
	return { application: applicantView(app, await deps.repo.listEvents(app.id), deps.now()) };
}

// Submit (or resubmit after a request for more information). Saves any fields sent with it, then validates everything.
export async function submitApplication(deps, actor, input) {
	const user = await loadApplicant(deps, actor);
	requireEligible(user);
	if (!user.email_confirmed) fail(403, "email_unverified", "Confirm your email address before applying.");
	let app = await deps.repo.findByUser(user.id);
	if (!app) fail(404, "no_application", "Start an application first.");
	if (!TRANSITIONS.submit.from.includes(app.status)) fail(409, "invalid_transition", `An application that is ${app.status.replace(/_/g, " ")} cannot be submitted.`);
	const { values, errors: fmt } = cleanForm(input, { categories: await categoriesFor(deps, input), now: deps.now() });
	const merged = { ...app, ...values };
	const errors = { ...validateForSubmit(merged), ...fmt };
	if (Object.keys(errors).length) fail(422, "invalid", "Please complete the required fields.", errors);
	const resubmission = app.status === "more_info_requested";
	const now = deps.now();
	const saved = await deps.repo.transition(app.id, { version: app.version, statuses: TRANSITIONS.submit.from }, { ...values, status: "pending", submitted_at: now, applicant_feedback: resubmission ? app.applicant_feedback : null, notify_kind: null }, { from_status: app.status, to_status: "pending", actor: "applicant", actor_user_id: user.id, feedback: resubmission ? "Applicant responded and resubmitted." : null });
	if (!saved) fail(409, "conflict", "The application changed. Reload and try again.");
	await audit(deps, "instructor_application.submit", user.id, { applicationId: saved.id, attempt: saved.attempt });
	await notify(deps, saved, user, resubmission ? "resubmitted" : "submitted");
	await notifyAdmin(deps, saved, user);
	return { application: applicantView(await deps.repo.findById(saved.id), await deps.repo.listEvents(saved.id), now) };
}

// Rejected / revoked applicants may open a NEW draft only after the waiting period; this never grants access.
export async function reapply(deps, actor) {
	const user = await loadApplicant(deps, actor);
	requireEligible(user);
	const app = await deps.repo.findByUser(user.id);
	if (!app) fail(404, "no_application", "No application found.");
	if (!TRANSITIONS.reapply.from.includes(app.status)) fail(409, "invalid_transition", "You can only reapply after a rejected application.");
	if (app.reapply_after && new Date(app.reapply_after) > deps.now()) fail(403, "cooldown", "You can reapply after the waiting period shown on your status page.");
	const saved = await deps.repo.transition(app.id, { version: app.version, statuses: TRANSITIONS.reapply.from }, { status: "draft", attempt: app.attempt + 1, applicant_feedback: null, submitted_at: null, decided_at: null, reapply_after: null, agreed_policies: false, consented_privacy: false }, { from_status: app.status, to_status: "draft", actor: "applicant", actor_user_id: user.id, feedback: "Started a new application." });
	if (!saved) fail(409, "conflict", "The application changed. Reload and try again.");
	return { application: applicantView(saved, await deps.repo.listEvents(saved.id), deps.now()) };
}

// ---------------------------------------------------------------- admin

export async function listApplications(deps, actor, query = {}) {
	requireAdmin(actor);
	const status = STATUSES.includes(query.status) && query.status !== "draft" ? query.status : "";
	const q = line(query.q, 80);
	const page = Math.max(1, parseInt(query.page, 10) || 1);
	const { rows, count } = await deps.repo.list({ q, status, page, pageSize: PAGE_SIZE });
	const counts = await deps.repo.counts();
	return {
		applications: rows.map((r) => ({ id: r.id, name: r.full_name || r.applicant_name || "", email: r.applicant_email || "", phone: r.phone || "", status: r.status, attempt: r.attempt, submitted_at: iso(r.submitted_at), subjects: (r.subjects || []).map((s) => s.name), teaching_years: r.teaching_years, has_teaching_experience: r.has_teaching_experience })),
		count,
		page,
		pages: Math.max(1, Math.ceil(count / PAGE_SIZE)),
		counts: Object.fromEntries(["pending", "under_review", "more_info_requested", "approved", "rejected", "revoked"].map((s) => [s, counts[s] || 0])),
	};
}

export async function getApplication(deps, actor, id) {
	requireAdmin(actor);
	const app = await deps.repo.findById(id);
	if (!app || app.status === "draft") fail(404, "not_found", "Application not found");
	return adminView(app, await deps.repo.getUser(app.user_id), await deps.repo.listEvents(app.id));
}

const cleanRubric = (r) => {
	const out = {};
	if (r && typeof r === "object") {
		for (const k of RUBRIC_KEYS) {
			const n = int(r[k]);
			if (n !== null && n !== undefined && !Number.isNaN(n) && n >= 1 && n <= 5) out[k] = n;
		}
	}
	return out;
};

// One entry point for every admin operation. `body` = { action, confirm, feedback, admin_notes, rubric }.
export async function reviewAction(deps, actor, id, body = {}) {
	requireAdmin(actor);
	const action = String(body.action || "");
	const app = await deps.repo.findById(id);
	if (!app || app.status === "draft") fail(404, "not_found", "Application not found");
	const user = await deps.repo.getUser(app.user_id);
	if (!user) fail(404, "not_found", "Applicant account not found");
	const now = deps.now();
	const feedback = text(body.feedback, 2000);
	const note = text(body.admin_notes, 4000);

	if (action === "save_review") {
		const saved = await deps.repo.updateIf(app.id, { version: app.version, statuses: STATUSES.filter((s) => s !== "draft") }, { admin_notes: note, rubric: cleanRubric(body.rubric), reviewed_by: actor.userId, reviewed_at: now }, null);
		if (!saved) fail(409, "conflict", "The application changed. Reload and try again.");
		return { application: adminView(saved, user, await deps.repo.listEvents(app.id)) };
	}
	if (action === "retry_email") {
		if (!app.notify_kind) fail(409, "nothing_to_send", "There is no notification to retry.");
		await notify(deps, app, user, app.notify_kind);
		return { application: adminView(await deps.repo.findById(app.id), user, await deps.repo.listEvents(app.id)) };
	}

	const t = TRANSITIONS[action];
	if (!t || t.by !== "admin") fail(422, "invalid_action", "Unknown action");
	if (!t.from.includes(app.status)) fail(409, "invalid_transition", `An application that is ${app.status.replace(/_/g, " ")} cannot be changed with "${action.replace(/_/g, " ")}".`);
	// Consequential actions need explicit confirmation from the caller.
	if (["approve", "reject", "revoke"].includes(action) && body.confirm !== true) fail(422, "confirmation_required", "Confirm this action to continue.");
	if (["request_info", "reject", "revoke"].includes(action) && feedback.length < 10) fail(422, "invalid", "Write a message for the applicant (at least 10 characters).", { feedback: "Required" });

	const patch = { status: t.to, reviewed_by: actor.userId, reviewed_at: now };
	if (note) patch.admin_notes = note;
	if (body.rubric !== undefined) patch.rubric = cleanRubric(body.rubric);
	let userEffect = null;

	if (action === "approve") {
		if (app.user_id === actor.userId) fail(403, "self_approval", "You cannot approve your own application.");
		if (!user.email_confirmed) fail(409, "email_unverified", "The applicant has not verified their email address.");
		if (user.status === false) fail(409, "account_disabled", "The applicant's account is disabled.");
		if (user.role !== "student" && user.role !== "instructor") fail(409, "not_eligible", "Only student accounts can be approved as instructors.");
		patch.decided_at = now;
		patch.applicant_feedback = feedback || null;
		patch.reapply_after = null;
		userEffect = { userId: user.id, setRole: { from: "student", to: "instructor" }, profile: { subjects: (app.subjects || []).map((s) => s.name).join(", ").slice(0, 300), languages: app.languages, qualifications: [app.degree, app.institution, app.certifications].filter(Boolean).join(" - ").slice(0, 2000), experience: app.prior_experience } };
	} else if (action === "reject") {
		patch.decided_at = now;
		patch.applicant_feedback = feedback;
		patch.reapply_after = new Date(now.getTime() + (deps.reapplyDays || REAPPLY_DAYS) * 86400000);
	} else if (action === "revoke") {
		patch.decided_at = now;
		patch.applicant_feedback = feedback;
		patch.reapply_after = new Date(now.getTime() + (deps.reapplyDays || REAPPLY_DAYS) * 86400000);
		userEffect = { userId: user.id, setRole: { from: "instructor", to: "student" } };
	} else if (action === "request_info") {
		patch.applicant_feedback = feedback;
	}

	const saved = await deps.repo.transition(app.id, { version: app.version, statuses: t.from }, patch, { from_status: app.status, to_status: t.to, actor: "admin", actor_user_id: actor.userId, feedback: feedback || null, internal_note: note || null }, userEffect);
	if (!saved) fail(409, "conflict", "This application was changed by someone else. Reload and try again.");
	await audit(deps, `instructor_application.${action}`, actor.userId, { applicationId: app.id, applicantId: user.id, from: app.status, to: t.to, ...(userEffect ? { roleFrom: userEffect.setRole.from, roleTo: userEffect.setRole.to } : {}) });
	const kind = { start_review: "under_review", request_info: "more_info", approve: "approved", reject: "rejected", revoke: "revoked" }[action];
	await notify(deps, saved, user, kind);
	return { application: adminView(await deps.repo.findById(app.id), await deps.repo.getUser(app.user_id), await deps.repo.listEvents(app.id)) };
}

// ---------------------------------------------------------------- side effects (never throw)

async function audit(deps, action, actorUserId, details) {
	try {
		if (deps.audit) await deps.audit(action, actorUserId, details);
	} catch (e) {
		/* the history table already holds the record; auditing must not undo the change */
	}
}

async function notify(deps, app, user, kind) {
	let result;
	try {
		const mail = applicationEmail(kind, { app, user, baseUrl: deps.baseUrl });
		if (!mail) return;
		if (!user.email || !isEmail(String(user.email))) result = { ok: false, skipped: true, error: "no valid recipient" };
		else result = await deps.mailer(mail);
	} catch (e) {
		result = { ok: false, error: String((e && e.message) || "send failed").slice(0, 200) };
	}
	const status = result && result.ok ? "sent" : result && result.skipped ? "skipped" : "failed";
	try {
		await deps.repo.setNotify(app.id, { notify_kind: kind, notify_status: status, notify_error: result && result.error ? String(result.error).slice(0, 300) : null });
	} catch (e) {
		/* bookkeeping only */
	}
}

async function notifyAdmin(deps, app, user) {
	try {
		if (!deps.adminEmail) return;
		await deps.mailer(adminNewApplicationEmail({ app, user, baseUrl: deps.baseUrl, to: deps.adminEmail }));
	} catch (e) {
		/* the application is already recorded */
	}
}
