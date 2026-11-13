// Telecaller dashboard: shared meeting visibility, follow-up ownership and call history.
// Pure with respect to storage, notifications, audit and the clock: the repository and helpers are passed in (`deps`), so every
// rule here is tested without a database (see tests/followups).
//
// What this module can and cannot do
//  - It NEVER writes meeting_requests (no approve / reject / reschedule / cancel / edit of the enquiry). The repository it is given has
//    no method that could: follow-up state lives in meeting_followups, calls in meeting_call_logs, ownership/status history in
//    meeting_followup_events. "Follow-up status" is a separate field from the meeting's own status, and no status is ever inferred
//    from the clock (a meeting whose time has passed is not "completed"; a follow-up is completed only by an explicit, noted action).
//  - Access is decided from the DATABASE on every call: the account must be active and either an admin or hold an ACTIVE, approved
//    telecaller_profiles row. users.role is never changed and `telecaller` is not a role.
//  - Ownership: any active telecaller may claim an unowned follow-up; only the current owner (or an admin) may transfer it, always
//    with a reason; an admin may assign or clear it, with a reason. Every change is one compare-and-set on (meeting, version) in one
//    transaction together with its history row, so two simultaneous claims can never both win.
//  - Call history is append-only: there is no update or delete path for a call log or an event.
import { v4 as uuidv4 } from "uuid";
import { accountIsActive } from "../auth/accountState.js";
import {
	FILTERS,
	FOLLOW_UP_STATUSES,
	effectiveStatus,
	isClosed,
	isUuid,
	cleanLine,
	makeContext,
	parseVersion,
	validateCall,
	validateReason,
	validateStatusChange,
} from "./rules.js";
import { isValidTimeZone, zonedToUtc } from "../meetings/time.js";

export class FollowupError extends Error {
	constructor(status, code, message, fields) {
		super(message);
		this.status = status;
		this.code = code;
		if (fields) this.fields = fields;
	}
}
const fail = (...a) => {
	throw new FollowupError(...a);
};

export const PAGE_SIZE = 15;
const nameOf = (u) => `${(u && u.first_name) || ""} ${(u && u.last_name) || ""}`.trim();
const iso = (d) => (d ? new Date(d).toISOString() : null);

// ---------------------------------------------------------------- views

// What a telecaller may see of the customer's request. NEVER: admin notes, the manage-link token hash, who processed it, e-mail
// delivery state. The enquiry is read-only here.
export const meetingView = (m) => ({
	id: m.id,
	reference: m.reference,
	name: m.name,
	email: m.email,
	phone: m.phone,
	organization: m.organization || null,
	purpose: m.purpose,
	message: m.message || null,
	requested_date: m.requested_date,
	requested_time: m.requested_time,
	time_zone: m.time_zone,
	requested_at: iso(m.requested_at),
	duration_minutes: m.duration_minutes,
	status: m.status, // the ORIGINAL meeting status, owned by the admin Meeting Requests workflow
	confirmed_start: iso(m.confirmed_start),
	confirmed_end: iso(m.confirmed_end),
	created_at: iso(m.created_at),
});

// `names` maps user id -> display name. A meeting with no row has had no follow-up: not_contacted, no owner, version 0.
export const followupView = (f, names = new Map()) => ({
	status: effectiveStatus(f),
	owner_user_id: (f && f.owner_user_id) || null,
	owner_name: f && f.owner_user_id ? names.get(f.owner_user_id) || "Former telecaller" : null,
	owned_at: iso(f && f.owned_at),
	last_contacted_at: iso(f && f.last_contacted_at),
	next_follow_up_at: iso(f && f.next_follow_up_at),
	completed_at: iso(f && f.completed_at),
	completed_by_name: f && f.completed_by ? names.get(f.completed_by) || null : null,
	completion_note: (f && f.completion_note) || null,
	version: f ? f.version : 0,
});

const callView = (c) => ({
	id: c.id,
	telecaller_user_id: c.telecaller_user_id || null,
	telecaller_name: c.telecaller_name,
	called_at: iso(c.called_at),
	answered: !!c.answered,
	outcome: c.outcome,
	interest: c.interest || null,
	follow_up_status_after: c.follow_up_status_after || null,
	notes: c.notes,
	next_follow_up_at: iso(c.next_follow_up_at),
	confirmation_details: c.confirmation_details || null,
	recorded_at: iso(c.created_at),
});

const eventView = (e) => ({
	id: e.id,
	event_type: e.event_type,
	actor_user_id: e.actor_user_id || null,
	actor_name: e.actor_name,
	actor_role: e.actor_role,
	from_name: e.from_name || null,
	to_name: e.to_name || null,
	from_status: e.from_status || null,
	to_status: e.to_status || null,
	reason: e.reason || null,
	at: iso(e.created_at),
});

// ---------------------------------------------------------------- access

// Every telecaller API calls this first. Nothing about access comes from the request: the user and the profile are re-read.
//   mode "telecaller": active account + ACTIVE approved telecaller profile (and not a child's learner login)
//   mode "admin":      an admin account (read access to the same data; ownership changes go through the admin operations)
async function access(deps, actor) {
	if (!actor || !actor.userId) fail(401, "unauthenticated", "Sign in required");
	const user = await deps.repo.getUser(actor.userId);
	if (!accountIsActive(user)) fail(401, "unauthenticated", "Sign in required");
	const name = nameOf(user) || user.email;
	if (user.role === "admin") return { mode: "admin", userId: user.id, name };
	const profile = await deps.repo.getProfile(user.id);
	if (!profile) fail(403, "telecaller_access_denied", "Telecaller access is not available for this account.");
	if (profile.status !== "active" || !profile.approved_at) fail(403, "telecaller_inactive", "Your telecaller access is not active. Contact an administrator.");
	if (await deps.repo.isLearnerAccount(user.id)) fail(403, "telecaller_access_denied", "Telecaller access is not available for this account.");
	return { mode: "telecaller", userId: user.id, name };
}
const requireTelecaller = async (deps, actor) => {
	const a = await access(deps, actor);
	if (a.mode !== "telecaller") fail(403, "admin_not_telecaller", "Administrators manage follow-up ownership from Admin > Telecallers > Activity & Call History.");
	return a;
};
const requireAdmin = async (deps, actor) => {
	const a = await access(deps, actor);
	if (a.mode !== "admin") fail(403, "forbidden", "You do not have permission to do this");
	return a;
};

// For the page gate and the nav: does this account have telecaller access right now? Never throws.
export async function accessSummary(deps, userId) {
	try {
		const a = await access(deps, { userId });
		return { allowed: true, mode: a.mode };
	} catch (e) {
		return { allowed: false, mode: null, code: e.code || "error" };
	}
}

// ---------------------------------------------------------------- helpers

const audit = async (deps, action, userId, details) => {
	try {
		if (deps.audit) await deps.audit(action, userId, details);
	} catch (e) {
		/* the event table already holds the record; auditing must not undo the change */
	}
};

async function nameMap(deps, ids) {
	const list = [...new Set(ids.filter(Boolean))];
	const users = list.length ? await deps.repo.getUsersByIds(list) : [];
	return new Map(users.map((u) => [u.id, nameOf(u) || u.email]));
}

function dayContext(deps, actorId, tz) {
	return makeContext(deps.now(), isValidTimeZone(tz) ? tz : "UTC", actorId);
}

async function decorateRows(deps, rows) {
	const names = await nameMap(deps, rows.map((r) => r.followup && r.followup.owner_user_id));
	const last = rows.length ? await deps.repo.lastCalls(rows.map((r) => r.meeting.id)) : [];
	const lastBy = new Map(last.map((c) => [c.meeting_request_id, c]));
	return rows.map((r) => {
		const c = lastBy.get(r.meeting.id);
		return { meeting: meetingView(r.meeting), followup: followupView(r.followup, names), last_call: c ? { called_at: iso(c.called_at), outcome: c.outcome, answered: !!c.answered, telecaller_name: c.telecaller_name } : null };
	});
}

function ownershipEvent({ type, actor, from, to, reason, meetingId, now }) {
	return {
		id: uuidv4(),
		meeting_request_id: meetingId,
		event_type: type,
		actor_user_id: actor.userId,
		actor_name: actor.name,
		actor_role: actor.mode === "admin" ? "admin" : "telecaller",
		from_user_id: from ? from.id : null,
		from_name: from ? from.name : null,
		to_user_id: to ? to.id : null,
		to_name: to ? to.name : null,
		from_status: null,
		to_status: null,
		reason: reason || null,
		created_at: now,
	};
}

// Best effort and idempotent (dedupe key): an ownership notification problem must never undo the change. No customer details in it.
async function notifyOwner(deps, userId, { title, body, meeting, dedupe }) {
	try {
		if (!userId || !deps.repo.insertNotification) return;
		await deps.repo.insertNotification({ id: uuidv4(), user_id: userId, type: "telecaller_followup", title: cleanLine(title, 200), body: cleanLine(body, 500), link: `/telecaller/?open=${meeting.id}`, ref_id: meeting.id, email_status: "none", dedupe_key: String(dedupe).slice(0, 190), created_at: deps.now() });
	} catch (e) {
		/* the change is already recorded */
	}
}

async function loadMeeting(deps, id) {
	const m = isUuid(id) ? await deps.repo.getMeeting(id) : null;
	if (!m) fail(404, "not_found", "Meeting request not found");
	return m;
}

function checkVersion(sent, current) {
	const v = parseVersion(sent);
	if (v === null) fail(422, "invalid", "Reload the meeting and try again.", { version: "Required" });
	if (v !== current) fail(409, "conflict", "This follow-up was just changed by someone else. Reload and try again.");
}

// ---------------------------------------------------------------- reads

// Counts are exact database counts for the whole team (and the caller's own where marked). Nothing is estimated.
export async function getDashboard(deps, actor, query = {}) {
	const a = await access(deps, actor);
	const ctx = dayContext(deps, a.userId, query.tz);
	const counts = await deps.repo.counts(ctx);
	const reminder = async (filter) => {
		const { rows, total } = await deps.repo.listRows({ filter, mine: true, q: "", page: 1, pageSize: 5 }, ctx);
		return { total, items: await decorateRows(deps, rows) };
	};
	const [due, over, up] = await Promise.all([reminder("due_today"), reminder("overdue"), reminder("upcoming")]);
	const recent = await deps.repo.recentCalls(8);
	return {
		access: a.mode,
		time_zone: ctx.zone,
		now: ctx.now.toISOString(),
		counts,
		reminders: { due_today: due, overdue: over, upcoming: up },
		recent_calls: recent.map((c) => ({ id: c.id, meeting_id: c.meeting_request_id, meeting_reference: c.meeting_reference || null, customer_name: c.meeting_name || null, telecaller_name: c.telecaller_name, called_at: iso(c.called_at), answered: !!c.answered, outcome: c.outcome })),
	};
}

// Every active telecaller (and admin) sees ALL meeting requests, with their follow-up state.
export async function listMeetings(deps, actor, query = {}) {
	const a = await access(deps, actor);
	const filter = FILTERS.includes(query.filter) ? query.filter : "all";
	const page = Math.max(1, parseInt(query.page, 10) || 1);
	const q = cleanLine(query.q, 100);
	const mine = query.mine === "1" || query.mine === true;
	const ctx = dayContext(deps, a.userId, query.tz);
	const { rows, total } = await deps.repo.listRows({ filter, mine, q, page, pageSize: PAGE_SIZE }, ctx);
	return { meetings: await decorateRows(deps, rows), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), pageSize: PAGE_SIZE, filter, time_zone: ctx.zone };
}

export async function getMeeting(deps, actor, id) {
	const a = await access(deps, actor);
	const m = await loadMeeting(deps, id);
	const [f, calls, events] = await Promise.all([deps.repo.getFollowup(m.id), deps.repo.listCallLogs(m.id), deps.repo.listMeetingEvents(m.id)]);
	const names = await nameMap(deps, [f && f.owner_user_id, f && f.completed_by]);
	const owner = f && f.owner_user_id;
	const closed = isClosed(effectiveStatus(f));
	const mineOwned = a.mode === "telecaller" && owner === a.userId;
	return {
		meeting: meetingView(m),
		followup: followupView(f, names),
		calls: calls.map(callView), // newest first; the log is append-only
		events: events.map(eventView),
		// What THIS viewer may do, so the screen never offers an action the server would refuse. The server still re-checks each one.
		can: {
			claim: a.mode === "telecaller" && !owner && !closed,
			transfer: !!owner && (mineOwned || a.mode === "admin"),
			record_call: mineOwned && effectiveStatus(f) !== "completed",
			change_status: mineOwned,
			admin_assign: a.mode === "admin",
			admin_clear: a.mode === "admin" && !!owner,
		},
	};
}

export async function listTelecallerOptions(deps, actor) {
	await access(deps, actor);
	const rows = await deps.repo.listTelecallers();
	return rows.map((r) => ({ user_id: r.user_id, name: r.name, status: r.status }));
}

// ---------------------------------------------------------------- ownership

// Core of every ownership change. `kind`: take | transfer | admin_assign | admin_clear.
async function changeOwner(deps, a, id, { kind, to, reason, version }) {
	const m = await loadMeeting(deps, id);
	const f = await deps.repo.getFollowup(m.id);
	const current = f ? f.version : 0;
	// A plain claim may omit the version (the database insert / compare-and-set still decides the race); every other change must send it.
	if (version !== undefined || kind !== "take") checkVersion(version, current);
	const owner = (f && f.owner_user_id) || null;
	const names = await nameMap(deps, [owner, to && to.userId]);
	const from = owner ? { id: owner, name: names.get(owner) || "Former telecaller" } : null;
	const toWho = to ? { id: to.userId, name: to.name } : null;
	const now = deps.now();
	if (kind === "take" && f && isClosed(effectiveStatus(f))) fail(409, "closed", "This follow-up is already closed.");
	const event = ownershipEvent({ type: kind, actor: a, from, to: toWho, reason, meetingId: m.id, now });
	const patch = kind === "admin_clear" ? { owner_user_id: null, owned_at: null } : { owner_user_id: toWho.id, owned_at: now };
	const saved = await deps.repo.applyFollowup({ meetingId: m.id, expectedVersion: current, ownerGuard: owner, patch, events: [event], now });
	if (!saved) {
		// Lost a race: say who won, so the person knows what happened.
		const fresh = await deps.repo.getFollowup(m.id);
		const who = fresh && fresh.owner_user_id ? (await nameMap(deps, [fresh.owner_user_id])).get(fresh.owner_user_id) : null;
		if (kind === "take" && who) fail(409, "already_claimed", `${who} just claimed this follow-up.`);
		fail(409, "conflict", "This follow-up was just changed by someone else. Reload and try again.");
	}
	await audit(deps, `meeting_followup.${kind}`, a.userId, { meetingId: m.id, reference: m.reference, from: from && from.id, to: toWho && toWho.id, reason: reason || null });
	// Tell the person who gained it (and, for an admin change, the person who lost it).
	if (kind === "transfer" || kind === "admin_assign") await notifyOwner(deps, toWho.id, { title: `Follow-up ${kind === "transfer" ? "transferred to you" : "assigned to you"}: ${m.reference}`, body: `${a.name} ${kind === "transfer" ? "transferred" : "assigned"} the follow-up for ${m.reference} to you.${reason ? ` Reason: ${reason}` : ""}`, meeting: m, dedupe: `mfu:${event.id}:to` });
	if ((kind === "admin_assign" || kind === "admin_clear") && from && (!toWho || from.id !== toWho.id)) await notifyOwner(deps, from.id, { title: `Follow-up ${kind === "admin_clear" ? "unassigned" : "reassigned"}: ${m.reference}`, body: `An administrator ${kind === "admin_clear" ? "cleared your ownership of" : "reassigned"} the follow-up for ${m.reference}.${reason ? ` Reason: ${reason}` : ""}`, meeting: m, dedupe: `mfu:${event.id}:from` });
	return getMeeting(deps, { userId: a.userId }, m.id);
}

async function activeTelecaller(deps, userId) {
	if (!isUuid(userId)) fail(422, "invalid", "Choose a telecaller.", { to_user_id: "Required" });
	const user = await deps.repo.getUser(userId);
	const profile = user ? await deps.repo.getProfile(userId) : null;
	if (!user || !accountIsActive(user) || user.role === "admin" || !profile || profile.status !== "active" || !profile.approved_at) fail(422, "invalid_target", "That person is not an active telecaller.", { to_user_id: "Not an active telecaller" });
	if (await deps.repo.isLearnerAccount(user.id)) fail(422, "invalid_target", "That person is not an active telecaller.", { to_user_id: "Not an active telecaller" });
	return { userId: user.id, name: nameOf(user) || user.email };
}

// Any active telecaller may take an unowned follow-up.
export async function claimMeeting(deps, actor, id, input = {}) {
	const a = await requireTelecaller(deps, actor);
	const m = await loadMeeting(deps, id);
	const f = await deps.repo.getFollowup(m.id);
	if (f && f.owner_user_id) {
		if (f.owner_user_id === a.userId) fail(409, "already_yours", "You already handle this follow-up.");
		const who = (await nameMap(deps, [f.owner_user_id])).get(f.owner_user_id);
		fail(409, "already_claimed", `${who || "Another telecaller"} already handles this follow-up. Ask them or an administrator to transfer it.`);
	}
	return changeOwner(deps, a, m.id, { kind: "take", to: { userId: a.userId, name: a.name }, reason: null, version: input.version });
}

// Only the current owner (telecaller) or an admin. A reason is always required.
export async function transferMeeting(deps, actor, id, input = {}) {
	const a = await access(deps, actor);
	const m = await loadMeeting(deps, id);
	const f = await deps.repo.getFollowup(m.id);
	const owner = f && f.owner_user_id;
	if (!owner) fail(409, "no_owner", "Nobody owns this follow-up yet. Claim it instead.");
	if (a.mode !== "admin" && owner !== a.userId) fail(403, "not_owner", "Only the person who handles this follow-up, or an administrator, can transfer it.");
	const r = validateReason(input.reason);
	if (r.error) fail(422, "invalid", r.error, { reason: r.error });
	const to = await activeTelecaller(deps, input.to_user_id);
	if (to.userId === owner) fail(409, "same_owner", "That person already handles this follow-up.");
	return changeOwner(deps, a, m.id, { kind: a.mode === "admin" ? "admin_assign" : "transfer", to, reason: r.value, version: input.version });
}

export async function adminAssign(deps, actor, id, input = {}) {
	const a = await requireAdmin(deps, actor);
	const m = await loadMeeting(deps, id);
	const r = validateReason(input.reason);
	if (r.error) fail(422, "invalid", r.error, { reason: r.error });
	const to = await activeTelecaller(deps, input.to_user_id);
	const f = await deps.repo.getFollowup(m.id);
	if (f && f.owner_user_id === to.userId) fail(409, "same_owner", "That person already handles this follow-up.");
	return changeOwner(deps, a, m.id, { kind: "admin_assign", to, reason: r.value, version: input.version });
}

export async function adminClear(deps, actor, id, input = {}) {
	const a = await requireAdmin(deps, actor);
	const m = await loadMeeting(deps, id);
	const r = validateReason(input.reason);
	if (r.error) fail(422, "invalid", r.error, { reason: r.error });
	const f = await deps.repo.getFollowup(m.id);
	if (!f || !f.owner_user_id) fail(409, "no_owner", "Nobody owns this follow-up.");
	return changeOwner(deps, a, m.id, { kind: "admin_clear", to: null, reason: r.value, version: input.version });
}

// ---------------------------------------------------------------- calls and status (owner only)

async function loadOwned(deps, a, id) {
	const m = await loadMeeting(deps, id);
	const f = await deps.repo.getFollowup(m.id);
	if (!f || !f.owner_user_id) fail(409, "claim_first", "Claim this follow-up before recording calls or changing its status.");
	if (f.owner_user_id !== a.userId) {
		const who = (await nameMap(deps, [f.owner_user_id])).get(f.owner_user_id);
		fail(403, "not_owner", `${who || "Another telecaller"} handles this follow-up. Ask them or an administrator to transfer it.`);
	}
	return { m, f };
}

// Appends ONE call record (never edits an earlier one) and updates the follow-up beside it, in one transaction.
export async function recordCall(deps, actor, id, input = {}) {
	const a = await requireTelecaller(deps, actor);
	const { m, f } = await loadOwned(deps, a, id);
	checkVersion(input.version, f.version);
	const now = deps.now();
	const { values, errors } = validateCall(input, now);
	if (Object.keys(errors).length) fail(422, "invalid", "Please fix the highlighted fields.", errors);
	const before = effectiveStatus(f);
	if (before === "completed") fail(409, "closed", "This follow-up is completed. Change its status first if it needs more calls.");
	const after = values.follow_up_status_after || (before === "not_contacted" ? (values.answered ? "contacted" : "unable_to_reach") : before);
	const closing = isClosed(after);
	const log = {
		id: uuidv4(),
		meeting_request_id: m.id,
		telecaller_user_id: a.userId,
		telecaller_name: a.name,
		called_at: values.called_at,
		answered: values.answered,
		outcome: values.outcome,
		interest: values.interest || null,
		follow_up_status_after: after !== before || values.follow_up_status_after ? after : null,
		notes: values.notes,
		next_follow_up_at: closing ? null : values.next_follow_up_at || null,
		confirmation_details: values.confirmation_details || null,
		created_at: now,
	};
	const events = [];
	if (after !== before) events.push({ id: uuidv4(), meeting_request_id: m.id, event_type: "status_change", actor_user_id: a.userId, actor_name: a.name, actor_role: "telecaller", from_user_id: null, from_name: null, to_user_id: null, to_name: null, from_status: before, to_status: after, reason: null, created_at: now });
	// A call replaces the previous reminder: the new next follow-up, or none.
	const patch = { follow_up_status: after, last_contacted_at: values.called_at, next_follow_up_at: log.next_follow_up_at };
	const saved = await deps.repo.applyFollowup({ meetingId: m.id, expectedVersion: f.version, ownerGuard: a.userId, patch, events, callLog: log, now });
	if (!saved) fail(409, "conflict", "This follow-up was just changed by someone else. Reload and try again.");
	await audit(deps, "meeting_followup.call", a.userId, { meetingId: m.id, reference: m.reference, outcome: log.outcome, answered: log.answered, status: after });
	return getMeeting(deps, actor, m.id);
}

// An explicit follow-up status change without a call. "completed" is only ever set here, with a note, by the owner.
export async function changeStatus(deps, actor, id, input = {}) {
	const a = await requireTelecaller(deps, actor);
	const { m, f } = await loadOwned(deps, a, id);
	checkVersion(input.version, f.version);
	const now = deps.now();
	const { values, errors } = validateStatusChange(input, now);
	if (Object.keys(errors).length) fail(422, "invalid", "Please fix the highlighted fields.", errors);
	const before = effectiveStatus(f);
	const after = values.status;
	const closing = isClosed(after);
	const patch = { follow_up_status: after, next_follow_up_at: closing ? null : values.next_follow_up_at };
	if (after === "completed") Object.assign(patch, { completed_at: now, completed_by: a.userId, completion_note: values.note });
	else if (before === "completed") Object.assign(patch, { completed_at: null, completed_by: null, completion_note: null }); // reopened
	const event = { id: uuidv4(), meeting_request_id: m.id, event_type: after === "completed" ? "completed" : "status_change", actor_user_id: a.userId, actor_name: a.name, actor_role: "telecaller", from_user_id: null, from_name: null, to_user_id: null, to_name: null, from_status: before, to_status: after, reason: values.note || null, created_at: now };
	const saved = await deps.repo.applyFollowup({ meetingId: m.id, expectedVersion: f.version, ownerGuard: a.userId, patch, events: [event], now });
	if (!saved) fail(409, "conflict", "This follow-up was just changed by someone else. Reload and try again.");
	await audit(deps, "meeting_followup.status", a.userId, { meetingId: m.id, reference: m.reference, from: before, to: after });
	return getMeeting(deps, actor, m.id);
}

// ---------------------------------------------------------------- admin: activity & call history

const dayStartUtc = (s, tz) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? zonedToUtc(String(s), "00:00", isValidTimeZone(tz) ? tz : "UTC") : null);

// One merged, newest-first feed of call logs and ownership/status events, filterable by telecaller, meeting, date range and the
// meeting's current follow-up status.
export async function listActivity(deps, actor, query = {}) {
	await requireAdmin(deps, actor);
	const page = Math.max(1, parseInt(query.page, 10) || 1);
	const pageSize = PAGE_SIZE;
	const filters = { telecallerId: isUuid(query.telecaller) ? query.telecaller : null, meetingId: null, from: dayStartUtc(query.from, query.tz), to: null, status: FOLLOW_UP_STATUSES.includes(query.status) ? query.status : null };
	if (query.telecaller && !filters.telecallerId) fail(422, "invalid", "Choose a telecaller from the list.", { telecaller: "Invalid" });
	if (query.to) {
		const t = dayStartUtc(query.to, query.tz);
		if (t) filters.to = new Date(t.getTime() + 86400000); // inclusive of the whole "to" day
	}
	const meetingQ = cleanLine(query.meeting, 60);
	if (meetingQ) {
		const m = isUuid(meetingQ) ? await deps.repo.getMeeting(meetingQ) : await deps.repo.findMeetingByReference(meetingQ);
		if (!m) return { items: [], total: 0, page, pages: 1, pageSize };
		filters.meetingId = m.id;
	}
	const type = ["calls", "ownership"].includes(query.type) ? query.type : "all";
	const take = page * pageSize;
	const [calls, events] = await Promise.all([type === "ownership" ? { rows: [], total: 0 } : deps.repo.listCallFeed(filters, take), type === "calls" ? { rows: [], total: 0 } : deps.repo.listEventFeed(filters, take)]);
	const items = [
		...calls.rows.map((c) => ({ kind: "call", id: c.id, at: iso(c.called_at), meeting_id: c.meeting_request_id, meeting_reference: c.meeting_reference || null, customer_name: c.meeting_name || null, who: c.telecaller_name, who_user_id: c.telecaller_user_id || null, call: callView(c) })),
		...events.rows.map((e) => ({ kind: "event", id: e.id, at: iso(e.created_at), meeting_id: e.meeting_request_id, meeting_reference: e.meeting_reference || null, customer_name: e.meeting_name || null, who: e.actor_name, who_user_id: e.actor_user_id || null, event: eventView(e) })),
	].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : x.id < y.id ? 1 : -1));
	const total = calls.total + events.total;
	return { items: items.slice((page - 1) * pageSize, page * pageSize), total, page, pages: Math.max(1, Math.ceil(total / pageSize)), pageSize, telecallers: (await deps.repo.listTelecallers()).map((r) => ({ user_id: r.user_id, name: r.name, status: r.status })) };
}
