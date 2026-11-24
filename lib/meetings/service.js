// Meeting requests ("Schedule a call"). Pure with respect to storage and e-mail:
// the repository, the mailer and the clock are passed in, so every rule here is
// tested without a database or a mail server (see tests/meetings).
//
// Rules in short
//  - Anyone may submit a request; it starts as `pending` and nothing is confirmed
//    until an admin approves it. There is no calendar integration: availability is
//    only checked against meetings already approved IN THIS SYSTEM.
//  - Only admins list/see/process requests (enforced by the API layer + actor.role
//    re-checked here). A visitor gets a secret link (reference + token) that lets
//    only them see their own request (without admin notes), cancel it, or accept a
//    proposed new time.
//  - Status changes are compare-and-set on (id, version, allowed from-status), so
//    two simultaneous clicks cannot both succeed.
//  - E-mail failures never lose or roll back a request; they are recorded and can
//    be retried by an admin.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import isEmail from "validator/lib/isEmail.js";
import { isValidTimeZone, zonedToUtc } from "./time.js";
import { adminNewRequestEmail, visitorReceivedEmail, visitorDecisionEmail } from "./emails.js";
import { PROGRAM_SLUGS } from "../programs/catalog.js";
import { sourceId, safePage } from "../freeDemo/config.js";
import { normalizeIncomingPhone } from "../freeDemo/phone.js";

export class MeetingError extends Error {
	constructor(status, code, message, fields) {
		super(message);
		this.status = status;
		this.code = code;
		if (fields) this.fields = fields;
	}
}
const fail = (...a) => {
	throw new MeetingError(...a);
};

export const PURPOSES = ["product_demo", "course_inquiry", "partnership", "technical_support", "other"];
// A request is either an ordinary "meeting" (Schedule a call) or a "free_demo" class request from the website's Free Demo popup/buttons.
export const KINDS = ["meeting", "free_demo"];
export const CLASS_MODES = ["online", "offline"];
export const STATUSES = ["pending", "approved", "rejected", "reschedule_requested", "cancelled"];
export const LIMITS = {
	minLeadMinutes: 60, // a request must be at least an hour away
	maxAheadDays: 180,
	perEmailPerDay: 3,
	durationMinutes: 30,
	notesMax: 2000,
	messageMax: 2000,
};

// Allowed status changes. Terminal states (rejected, cancelled) never change again.
const TRANSITIONS = {
	approve: { from: ["pending", "reschedule_requested"], to: "approved" },
	reject: { from: ["pending", "reschedule_requested"], to: "rejected" },
	reschedule: { from: ["pending", "approved", "reschedule_requested"], to: "reschedule_requested" },
	cancel: { from: ["pending", "approved", "reschedule_requested"], to: "cancelled" },
};

const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanMultiline = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");
const sameHash = (a, b) => {
	const x = Buffer.from(a, "hex");
	const y = Buffer.from(b, "hex");
	return x.length === y.length && timingSafeEqual(x, y);
};
// The visitor's status-link token is DERIVED, not stored: HMAC(server secret, request id).
// Only its SHA-256 hash is saved (manage_token_hash), so a database leak does not reveal
// working links, yet every later e-mail can include the link because the server can
// recompute it. Needs MEETING_LINK_SECRET (falls back to JWT_SECRET); without a secret a
// random one-time token is used and later e-mails simply omit the link.
export const deriveToken = (secret, id) => createHmac("sha256", String(secret)).update(`meeting-status:${id}`).digest("hex").slice(0, 48);
const visitorToken = (deps, r) => {
	if (!deps.linkSecret) return null;
	const t = deriveToken(deps.linkSecret, r.id);
	return sameHash(r.manage_token_hash, hashToken(t)) ? t : null; // legacy rows with random tokens: no link
};
const newReference = () => "MTG-" + randomBytes(5).toString("hex").toUpperCase().slice(0, 8);
export const isHttpUrl = (u) => {
	try {
		const p = new URL(u);
		return (p.protocol === "https:" || p.protocol === "http:") && u.length <= 500;
	} catch (e) {
		return false;
	}
};

// ---------------------------------------------------------------- validation

// ---- Free Demo Class request. Parent name, phone, child name, grade and program are required; email, preferred date/time, online/offline
// and a message are optional. The source and page are informational (whitelisted / sanitised): nothing trusts them for access decisions.
function validateDemoSubmission(i, now) {
	const errors = {};
	const name = clean(i.name, 120);
	if (name.length < 2) errors.name = "Please enter the parent or guardian's name.";
	let phone = clean(i.phone, 40);
	// "+..." = an international number: must be valid for its country and is stored as E.164 ("+919876543210"). Without "+" (older clients): the original rule.
	const intl = normalizeIncomingPhone(phone);
	if (!intl.legacy) {
		if (intl.value) phone = intl.value;
		else errors.phone = "Please enter a valid phone number for the selected country.";
	} else if (!/^[0-9+()\-.\s]{7,40}$/.test(phone) || phone.replace(/\D/g, "").length < 7) errors.phone = "Please enter a valid phone number.";
	const emailRaw = clean(i.email, 200).toLowerCase();
	let email = null;
	if (emailRaw) {
		if (isEmail(emailRaw)) email = emailRaw;
		else errors.email = "Please enter a valid email address, or leave it empty.";
	}
	const childName = clean(i.childName, 120);
	if (childName.length < 2) errors.childName = "Please enter your child's name.";
	const childGrade = clean(i.childGrade, 40);
	if (!childGrade) errors.childGrade = "Please enter your child's grade.";
	const program = PROGRAM_SLUGS.includes(i.program) ? i.program : null;
	if (!program) errors.program = "Please choose a program.";
	let classMode = null;
	if (i.classMode !== undefined && i.classMode !== null && i.classMode !== "") {
		if (CLASS_MODES.includes(i.classMode)) classMode = i.classMode;
		else errors.classMode = "Please choose online or offline.";
	}
	const message = cleanMultiline(i.message, LIMITS.messageMax) || null;

	// Preferred date and time are optional, but if one is given both are needed (and the time zone must be real).
	const date = clean(i.date, 10);
	const time = clean(i.time, 5);
	let timeZone = clean(i.timeZone, 64);
	let requestedAt = null;
	let requestedDate = null;
	let requestedTime = null;
	if (date || time) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "Please choose a date, or clear the time as well.";
		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = "Please choose a time, or clear the date as well.";
		if (!isValidTimeZone(timeZone)) errors.timeZone = "Please choose a valid time zone.";
		if (!errors.date && !errors.time && !errors.timeZone) {
			requestedAt = zonedToUtc(date, time, timeZone);
			if (!requestedAt) errors.date = "That is not a valid date.";
			else if (requestedAt.getTime() < now.getTime() + LIMITS.minLeadMinutes * 60000) errors.date = "Please choose a date and time at least one hour from now.";
			else if (requestedAt.getTime() > now.getTime() + LIMITS.maxAheadDays * 86400000) errors.date = `Please choose a date within the next ${LIMITS.maxAheadDays} days.`;
			else {
				requestedDate = date;
				requestedTime = time;
			}
		}
	} else if (!isValidTimeZone(timeZone)) timeZone = "UTC";
	let submissionKey = null;
	if (i.submissionKey !== undefined && i.submissionKey !== null && i.submissionKey !== "") {
		if (typeof i.submissionKey === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(i.submissionKey)) submissionKey = i.submissionKey;
		else errors.submissionKey = "Invalid submission key.";
	}
	if (Object.keys(errors).length) fail(422, "invalid", "Please correct the highlighted fields.", errors);
	return {
		kind: "free_demo",
		name,
		email,
		phone,
		organization: null,
		purpose: "product_demo",
		message,
		requested_date: requestedDate,
		requested_time: requestedTime,
		time_zone: timeZone,
		requested_at: requestedAt,
		submission_key: submissionKey,
		child_name: childName,
		child_grade: childGrade,
		program,
		source: sourceId(i.source),
		source_page: safePage(i.page),
		class_mode: classMode,
	};
}

export function validateSubmission(input, now = new Date()) {
	const i = input || {};
	if (i.kind === "free_demo") return validateDemoSubmission(i, now);
	const errors = {};
	const name = clean(i.name, 120);
	if (name.length < 2) errors.name = "Please enter your full name.";
	const email = clean(i.email, 200).toLowerCase();
	if (!email || !isEmail(email)) errors.email = "Please enter a valid email address.";
	const phone = clean(i.phone, 40);
	if (!/^[0-9+()\-.\s]{7,40}$/.test(phone) || phone.replace(/\D/g, "").length < 7) errors.phone = "Please enter a valid phone number.";
	const organization = clean(i.organization, 160) || null;
	if (!PURPOSES.includes(i.purpose)) errors.purpose = "Please choose a meeting purpose.";
	const message = cleanMultiline(i.message, LIMITS.messageMax) || null;
	const timeZone = clean(i.timeZone, 64);
	if (!isValidTimeZone(timeZone)) errors.timeZone = "Please choose a valid time zone.";

	let requestedAt = null;
	const date = clean(i.date, 10);
	const time = clean(i.time, 5);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "Please choose a date.";
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = "Please choose a time.";
	if (!errors.date && !errors.time && !errors.timeZone) {
		requestedAt = zonedToUtc(date, time, timeZone);
		if (!requestedAt) errors.date = "That is not a valid date.";
		else if (requestedAt.getTime() < now.getTime() + LIMITS.minLeadMinutes * 60000) errors.date = "Please choose a date and time at least one hour from now.";
		else if (requestedAt.getTime() > now.getTime() + LIMITS.maxAheadDays * 86400000) errors.date = `Please choose a date within the next ${LIMITS.maxAheadDays} days.`;
	}
	let submissionKey = null;
	if (i.submissionKey !== undefined && i.submissionKey !== null && i.submissionKey !== "") {
		if (typeof i.submissionKey === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(i.submissionKey)) submissionKey = i.submissionKey;
		else errors.submissionKey = "Invalid submission key.";
	}
	if (Object.keys(errors).length) fail(422, "invalid", "Please correct the highlighted fields.", errors);
	return { kind: "meeting", name, email, phone, organization, purpose: i.purpose, message, requested_date: date, requested_time: time, time_zone: timeZone, requested_at: requestedAt, submission_key: submissionKey };
}

// ------------------------------------------------------------------- views

// What the visitor who owns the request may see: never admin notes or internal ids.
export const publicView = (r) => ({
	reference: r.reference,
	status: r.status,
	name: r.name,
	purpose: r.purpose,
	kind: r.kind || "meeting",
	requestedAt: r.requested_at || null,
	timeZone: r.time_zone,
	confirmedStart: r.status === "approved" ? r.confirmed_start : null,
	proposedStart: r.status === "reschedule_requested" ? r.proposed_start : null,
	durationMinutes: r.duration_minutes,
	meetingUrl: r.status === "approved" ? r.meeting_url : null,
	createdAt: r.created_at,
});

export const adminView = (r) => ({
	id: r.id,
	reference: r.reference,
	status: r.status,
	version: r.version,
	name: r.name,
	email: r.email,
	phone: r.phone,
	organization: r.organization,
	purpose: r.purpose,
	message: r.message,
	kind: r.kind || "meeting",
	childName: r.child_name || null,
	childGrade: r.child_grade || null,
	program: r.program || null,
	source: r.source || null,
	sourcePage: r.source_page || null,
	classMode: r.class_mode || null,
	requestedDate: r.requested_date,
	requestedTime: r.requested_time,
	timeZone: r.time_zone,
	requestedAt: r.requested_at,
	durationMinutes: r.duration_minutes,
	confirmedStart: r.confirmed_start,
	confirmedEnd: r.confirmed_end,
	proposedStart: r.proposed_start,
	meetingUrl: r.meeting_url,
	adminNotes: r.admin_notes,
	processedBy: r.processed_by,
	processedAt: r.processed_at,
	adminEmailStatus: r.admin_email_status,
	visitorEmailStatus: r.visitor_email_status,
	lastEmailError: r.last_email_error,
	createdAt: r.created_at,
	updatedAt: r.updated_at,
});

// -------------------------------------------------------------------- e-mail

const statusUrl = (deps, r, token) => (token ? `${deps.baseUrl}/schedule-a-call/status/?ref=${encodeURIComponent(r.reference)}&token=${encodeURIComponent(token)}` : null);

const redact = (text) => String(text).replace(/token=[^&\s"']+/gi, "token=[hidden]").replace(/[a-f0-9]{48}/gi, "[hidden]");

// Send, record the outcome, never throw.
async function deliver(deps, r, kind, mail) {
	const column = kind === "admin" ? "admin_email_status" : "visitor_email_status";
	if (!mail) return;
	let result;
	try {
		result = await deps.mailer(mail);
	} catch (e) {
		result = { ok: false, error: "mail transport error" };
	}
	const patch = { [column]: result.ok ? "sent" : result.skipped ? "skipped" : "failed" };
	// Errors are stored/logged for the admin; make sure no status-link token can end up in them.
	if (!result.ok) patch.last_email_error = redact(clean(`${kind}: ${result.error || "send failed"}`, 300));
	await deps.repo.setEmailState(r.id, patch).catch(() => {});
	if (!result.ok) console.error(`[meetings] ${kind} e-mail for ${r.reference} not delivered: ${patch.last_email_error}`);
}

// Every visitor e-mail carries the private status link (see deriveToken).
async function notifyVisitor(deps, r, token = visitorToken(deps, r)) {
	// A free-demo request may have no e-mail address: there is nothing to send, and that is recorded as "skipped".
	if (!r.email) {
		await deps.repo.setEmailState(r.id, { visitor_email_status: "skipped" }).catch(() => {});
		return;
	}
	const ctx = { baseUrl: deps.baseUrl, statusUrl: statusUrl(deps, r, token) };
	await deliver(deps, r, "visitor", r.status === "pending" ? visitorReceivedEmail(r, ctx) : visitorDecisionEmail(r, ctx));
}
async function notifyAdmin(deps, r) {
	if (!deps.adminEmail) {
		await deps.repo.setEmailState(r.id, { admin_email_status: "skipped", last_email_error: "admin: MEETING_ADMIN_EMAIL is not configured" }).catch(() => {});
		console.error("[meetings] MEETING_ADMIN_EMAIL is not configured; the admin was not e-mailed");
		return;
	}
	await deliver(deps, r, "admin", adminNewRequestEmail(r, { baseUrl: deps.baseUrl, adminTo: deps.adminEmail }));
}

// -------------------------------------------------------------- public: submit

// deps: { repo, mailer, baseUrl, adminEmail, linkSecret, defaultMeetingUrl, now: () => Date }
export async function submitRequest(deps, input) {
	const now = deps.now();
	const data = validateSubmission(input, now);

	// Same button pressed twice (or a retried request): return the original.
	if (data.submission_key) {
		const prior = await deps.repo.findBySubmissionKey(data.submission_key);
		if (prior) return { duplicate: true, reference: prior.reference, status: prior.status };
	}
	const dayAgo = new Date(now.getTime() - 86400000);
	// Same person asking for the same moment while the first is still open.
	const twin = data.email && data.requested_at ? await deps.repo.findOpenTwin(data.email, data.requested_at) : null;
	if (twin) return { duplicate: true, reference: twin.reference, status: twin.status };
	// Same parent, child and program while the first demo request is still open: the same request, not a new one.
	if (data.kind === "free_demo") {
		const demoTwin = await deps.repo.findOpenDemoTwin(data.phone, data.child_name, data.program);
		if (demoTwin) return { duplicate: true, reference: demoTwin.reference, status: demoTwin.status };
	}
	const tooMany =
		(data.email && (await deps.repo.countByEmailSince(data.email, dayAgo)) >= LIMITS.perEmailPerDay) ||
		(data.kind === "free_demo" && (await deps.repo.countByPhoneSince(data.phone, dayAgo)) >= LIMITS.perEmailPerDay);
	if (tooMany) fail(429, "too_many_requests", "You have sent several requests recently. Please wait for a reply or try again tomorrow.");

	const id = randomUUID();
	const token = deps.linkSecret ? deriveToken(deps.linkSecret, id) : randomBytes(24).toString("hex");
	let row;
	try {
		row = await deps.repo.create({
			...data,
			id,
			reference: newReference(),
			manage_token_hash: hashToken(token),
			status: "pending",
			duration_minutes: LIMITS.durationMinutes,
			version: 0,
		});
	} catch (e) {
		if (e && e.code === "duplicate") {
			// lost a race on submission_key / reference: return what exists
			const prior = data.submission_key && (await deps.repo.findBySubmissionKey(data.submission_key));
			if (prior) return { duplicate: true, reference: prior.reference, status: prior.status };
		}
		throw e;
	}
	await deps.repo.addEvent({ meeting_request_id: row.id, from_status: null, to_status: "pending", actor: "visitor", note: "Request submitted" });

	// The request is saved. Notifications are best effort.
	await notifyAdmin(deps, row);
	await notifyVisitor(deps, row, token);
	return { duplicate: false, reference: row.reference, status: "pending", manageToken: token };
}

// ------------------------------------------------------------ public: manage

async function loadForVisitor(deps, reference, token) {
	if (typeof reference !== "string" || typeof token !== "string" || !/^MTG-[A-Z0-9]{8}$/.test(reference) || !/^[a-f0-9]{48}$/.test(token)) {
		fail(404, "not_found", "We could not find that request.");
	}
	const r = await deps.repo.findByReference(reference);
	// Same answer for "no such request" and "wrong token": no way to probe references.
	if (!r || !sameHash(r.manage_token_hash, hashToken(token))) fail(404, "not_found", "We could not find that request.");
	return r;
}

export async function visitorView(deps, reference, token) {
	return publicView(await loadForVisitor(deps, reference, token));
}

export async function visitorAct(deps, reference, token, action) {
	const r = await loadForVisitor(deps, reference, token);
	if (action === "cancel") {
		const updated = await changeStatus(deps, deps.repo, r, TRANSITIONS.cancel, { actor: "visitor", note: "Cancelled by the visitor", patch: { confirmed_start: null, confirmed_end: null, proposed_start: null } });
		await notifyVisitor(deps, updated, token);
		return publicView(updated);
	}
	if (action === "accept") {
		if (r.status !== "reschedule_requested" || !r.proposed_start) fail(409, "invalid_state", "There is no proposed time to accept.");
		const start = new Date(r.proposed_start);
		if (start.getTime() <= deps.now().getTime()) fail(409, "past", "The proposed time has passed. Please submit a new request.");
		const end = new Date(start.getTime() + r.duration_minutes * 60000);
		const updated = await withSchedule(deps, async (repo) => {
			await ensureFree(repo, start, end, r.id);
			return changeStatus(deps, repo, r, TRANSITIONS.approve, {
				actor: "visitor",
				note: "Visitor accepted the proposed time",
				patch: { confirmed_start: start, confirmed_end: end, proposed_start: null },
			});
		});
		await notifyVisitor(deps, updated, token);
		return publicView(updated);
	}
	return fail(422, "invalid", "Unknown action.");
}

// ------------------------------------------------------------------- admin

function requireAdmin(actor) {
	// The API layer resolves the actor from the verified token + database; re-checked here.
	if (!actor || !actor.userId) fail(401, "unauthorized", "Sign in first");
	if (actor.role !== "admin") fail(403, "forbidden", "Administrators only");
}

export async function listRequests(deps, actor, query = {}) {
	requireAdmin(actor);
	const status = STATUSES.includes(query.status) ? query.status : null;
	const page = Math.max(1, parseInt(query.page, 10) || 1);
	const pageSize = Math.min(50, Math.max(5, parseInt(query.pageSize, 10) || 15));
	const q = clean(query.q, 100);
	const kind = KINDS.includes(query.kind) ? query.kind : null;
	const program = PROGRAM_SLUGS.includes(query.program) ? query.program : null;
	const source = query.source ? sourceId(clean(query.source, 40)) : null;
	const { rows, total } = await deps.repo.list({ q, status, page, pageSize, kind, program, source });
	const counts = await deps.repo.countsByStatus(kind);
	return { requests: rows.map(adminView), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), counts: Object.fromEntries(STATUSES.map((s) => [s, counts[s] || 0])) };
}

export async function getRequest(deps, actor, id) {
	requireAdmin(actor);
	const r = await deps.repo.findById(id);
	if (!r) fail(404, "not_found", "Request not found");
	const events = await deps.repo.listEvents(r.id);
	return { request: adminView(r), events: events.map((e) => ({ from: e.from_status, to: e.to_status, actor: e.actor, note: e.note, at: e.created_at })) };
}

// Run `fn(repo)` while holding the database-wide scheduling lock (a row lock inside a
// transaction, see repo.withScheduleLock), so the overlap check and the write that
// makes a meeting "approved" cannot interleave with another approval, in this or any
// other server instance. Repositories without locking just run fn directly.
const withSchedule = (deps, fn) => (deps.repo.withScheduleLock ? deps.repo.withScheduleLock(fn) : fn(deps.repo));

async function ensureFree(repo, start, end, excludeId) {
	const clash = await repo.findOverlap(start, end, excludeId);
	if (clash) fail(409, "overlap", `That time overlaps another approved meeting (${clash.reference}). Please choose a different time.`);
}

// Compare-and-set the status; 409 when someone else got there first.
async function changeStatus(deps, repo, r, rule, { actor, actorUserId = null, note, patch = {} }) {
	if (!rule.from.includes(r.status)) fail(409, "invalid_transition", `A ${r.status.replace("_", " ")} request cannot be changed this way.`);
	const updated = await repo.updateIfCurrent(r.id, r.version, rule.from, {
		...patch,
		status: rule.to,
		...(actor === "admin" ? { processed_by: actorUserId, processed_at: deps.now() } : {}),
	});
	if (!updated) fail(409, "conflict", "This request was just changed by someone else. Reload and try again.");
	await repo.addEvent({ meeting_request_id: r.id, from_status: r.status, to_status: rule.to, actor, actor_user_id: actorUserId, note: note ? clean(note, 500) : null });
	return updated;
}

// payload: { version, notes?, meetingUrl?, date?, time? }  (date/time are in the request's own time zone)
export async function processRequest(deps, actor, id, action, payload = {}) {
	requireAdmin(actor);
	const r = await deps.repo.findById(id);
	if (!r) fail(404, "not_found", "Request not found");
	if (action === "note") {
		const notes = cleanMultiline(payload.notes, LIMITS.notesMax);
		const updated = await deps.repo.setNotes(r.id, notes || null);
		return { request: adminView(updated || r) };
	}
	if (action === "resend_email") return resendEmails(deps, r);

	const rule = TRANSITIONS[action];
	if (!rule) fail(422, "invalid", "Unknown action");
	// Optimistic concurrency: the admin must have seen the current version.
	if (!Number.isInteger(payload.version)) fail(422, "invalid", "version is required");
	if (payload.version !== r.version) fail(409, "conflict", "This request was just changed by someone else. Reload and try again.");

	const notes = payload.notes !== undefined ? cleanMultiline(payload.notes, LIMITS.notesMax) || null : undefined;
	const base = { ...(notes !== undefined ? { admin_notes: notes } : {}) };
	const url = payload.meetingUrl ? clean(payload.meetingUrl, 500) : deps.defaultMeetingUrl || null;

	// Time the admin chose, interpreted in the request's own zone; default to what was asked / proposed.
	const chosen = () => {
		if (payload.date || payload.time) {
			const t = zonedToUtc(clean(payload.date, 10), clean(payload.time, 5), r.time_zone);
			if (!t) fail(422, "invalid", "Please enter a valid date and time.");
			return t;
		}
		const base = action === "approve" && r.status === "reschedule_requested" && r.proposed_start ? r.proposed_start : r.requested_at;
		// A free-demo request may have no preferred time: the admin must then choose one.
		if (!base) fail(422, "invalid", "This request has no preferred time. Enter the date and time to schedule it.");
		return new Date(base);
	};

	let patch = base;
	let slot = null;
	if (action === "approve" || action === "reschedule") {
		const start = chosen();
		if (start.getTime() <= deps.now().getTime()) fail(422, "invalid", "The meeting time must be in the future.");
		if (start.getTime() > deps.now().getTime() + LIMITS.maxAheadDays * 86400000) fail(422, "invalid", "The meeting time is too far ahead.");
		if (!url || !isHttpUrl(url)) fail(422, "invalid", "Enter the meeting link (an http or https URL) or configure MEETING_DEFAULT_URL.");
		if (action === "approve") {
			const end = new Date(start.getTime() + r.duration_minutes * 60000);
			patch = { ...base, confirmed_start: start, confirmed_end: end, proposed_start: null, meeting_url: url };
			slot = { start, end };
		} else {
			// Proposing a time does not reserve it; it is checked again when it is accepted.
			patch = { ...base, proposed_start: start, confirmed_start: null, confirmed_end: null, meeting_url: url };
		}
	} else {
		patch = { ...base, confirmed_start: null, confirmed_end: null, proposed_start: null };
	}

	const commit = (repo) => changeStatus(deps, repo, r, rule, { actor: "admin", actorUserId: actor.userId, note: notes || `Admin: ${action}`, patch });
	// Approvals reserve a time slot: check for overlaps and write under the scheduling lock.
	const updated = slot
		? await withSchedule(deps, async (repo) => {
				await ensureFree(repo, slot.start, slot.end, r.id);
				return commit(repo);
		  })
		: await commit(deps.repo);
	// Reset delivery state for the new status, then notify. Failures are recorded, not thrown.
	await deps.repo.setEmailState(updated.id, { visitor_email_status: "pending", last_email_error: null }).catch(() => {});
	await notifyVisitor(deps, updated);
	return { request: adminView((await deps.repo.findById(updated.id)) || updated) };
}

// Retry failed/skipped notifications for the request's current state.
async function resendEmails(deps, r) {
	if (r.admin_email_status !== "sent") await notifyAdmin(deps, r);
	await notifyVisitor(deps, r);
	return { request: adminView((await deps.repo.findById(r.id)) || r) };
}

// Admin overview of free-demo requests: every number is counted from the database at the moment of the request.
export async function demoStats(deps, actor) {
	requireAdmin(actor);
	const st = await deps.repo.demoStats();
	return { ...st, statuses: Object.fromEntries(STATUSES.map((x) => [x, (st.byStatus && st.byStatus[x]) || 0])) };
}
