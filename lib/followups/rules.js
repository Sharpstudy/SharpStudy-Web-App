// Telecaller follow-up rules (pure: no database, no clock of its own). Shared by the service, the repositories and the tests.
//
// The follow-up lives BESIDE the customer's meeting request (tables meeting_followups / meeting_call_logs /
// meeting_followup_events). Nothing here reads or changes meeting_requests.status: "follow-up status" and "meeting status"
// are separate things, and a status is never inferred from the clock.
import { isValidTimeZone, zonedToUtc } from "../meetings/time.js";

export const FOLLOW_UP_STATUSES = ["not_contacted", "contacted", "follow_up_required", "meeting_confirmed", "not_interested", "unable_to_reach", "completed"];
// A follow-up in one of these needs no more calls, so it is never "due" or "overdue" and never counts as unclaimed work.
export const CLOSED_STATUSES = ["completed", "not_interested"];
export const CALL_OUTCOMES = ["spoke_to_customer", "no_answer", "busy", "voicemail_left", "wrong_number", "call_back_requested", "other"];
export const INTERESTS = ["high", "medium", "low", "none"];
export const FILTERS = ["all", "unclaimed", "mine", "due_today", "overdue", "upcoming", "completed"];

export const LIMITS = {
	reasonMin: 5,
	reasonMax: 500,
	noteMin: 3,
	noteMax: 2000,
	confirmMax: 2000,
	completionNoteMin: 5,
	completionNoteMax: 500,
	upcomingDays: 7,
	maxCallAgeDays: 365,
	maxFutureMs: 5 * 60 * 1000, // a call cannot be logged as happening more than 5 minutes from now (clock drift allowance)
	maxFollowUpDays: 365,
};

export const effectiveStatus = (f) => (f && f.follow_up_status) || "not_contacted";
export const isClosed = (status) => CLOSED_STATUSES.includes(status);

// ---------------------------------------------------------------- local day (the viewer's own time zone)

const MS_DAY = 86400000;

// [start, end) of the calendar day containing `now` in `tz`, as UTC instants. An invalid zone falls back to UTC.
export function localDayBounds(now, tz) {
	const zone = isValidTimeZone(tz) ? tz : "UTC";
	const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
	const v = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
	const today = `${v.year}-${v.month}-${v.day}`;
	const next = new Date(Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day)) + MS_DAY).toISOString().slice(0, 10);
	return { zone, start: zonedToUtc(today, "00:00", zone), end: zonedToUtc(next, "00:00", zone) };
}

// The context every list / count shares: `now` and the viewer's day, plus who is asking.
export function makeContext(now, tz, userId) {
	const { zone, start, end } = localDayBounds(now, tz);
	return { now: new Date(now), zone, dayStart: start, dayEnd: end, upcomingEnd: new Date(end.getTime() + (LIMITS.upcomingDays - 1) * MS_DAY), userId: userId || null };
}

// ---------------------------------------------------------------- filters

// `row` = { followup: row-or-null }. Exactly the semantics the SQL repository implements:
//   unclaimed  no owner and not closed (includes meetings that have no follow-up row yet)
//   mine       I am the owner and it is not closed
//   overdue    not closed, next follow-up before now
//   due_today  not closed, next follow-up from now until the end of the viewer's day (so it never double-counts with overdue)
//   upcoming   not closed, next follow-up after today, within the next 7 days (today included in the window's start)
//   completed  follow-up status is "completed"
export function matchesFilter(row, filter, ctx) {
	const f = row.followup;
	const status = effectiveStatus(f);
	const closed = isClosed(status);
	const next = f && f.next_follow_up_at ? new Date(f.next_follow_up_at) : null;
	const owner = (f && f.owner_user_id) || null;
	switch (filter) {
		case "unclaimed":
			return !owner && !closed;
		case "mine":
			return !!ctx.userId && owner === ctx.userId && !closed;
		case "overdue":
			return !closed && !!next && next < ctx.now;
		case "due_today":
			return !closed && !!next && next >= ctx.now && next < ctx.dayEnd;
		case "upcoming":
			return !closed && !!next && next >= ctx.dayEnd && next < new Date(ctx.dayEnd.getTime() + LIMITS.upcomingDays * MS_DAY);
		case "completed":
			return status === "completed";
		default:
			return true;
	}
}

// ---------------------------------------------------------------- input cleaning / validation

const line = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const text = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
export const cleanLine = line;
export const cleanText = text;

export const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Strict ISO instant (or null for empty). Anything else is an error, never a silently-guessed date.
export function parseInstant(v) {
	if (v === undefined || v === null || v === "") return { value: null };
	if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return { error: "Enter a valid date and time." };
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? { error: "Enter a valid date and time." } : { value: d };
}

// Version as the client sent it: a non-negative integer. 0 means "this meeting has no follow-up row yet".
export function parseVersion(v) {
	const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
	return Number.isInteger(n) && n >= 0 ? n : null;
}

export function validateReason(raw) {
	const reason = line(raw, LIMITS.reasonMax);
	if (reason.length < LIMITS.reasonMin) return { error: `Give a reason (at least ${LIMITS.reasonMin} characters).` };
	return { value: reason };
}

// A call attempt. Returns { values, errors }.
export function validateCall(input, now) {
	const b = input && typeof input === "object" ? input : {};
	const errors = {};
	const values = {};

	const calledAt = b.called_at === undefined || b.called_at === null || b.called_at === "" ? { value: new Date(now) } : parseInstant(b.called_at);
	if (calledAt.error) errors.called_at = calledAt.error;
	else {
		values.called_at = calledAt.value;
		if (calledAt.value.getTime() > new Date(now).getTime() + LIMITS.maxFutureMs) errors.called_at = "A call cannot be recorded in the future.";
		else if (calledAt.value.getTime() < new Date(now).getTime() - LIMITS.maxCallAgeDays * MS_DAY) errors.called_at = "That call time is too far in the past.";
	}

	if (b.answered !== true && b.answered !== false) errors.answered = "Say whether the call was answered.";
	else values.answered = b.answered;

	if (!CALL_OUTCOMES.includes(b.outcome)) errors.outcome = "Choose the call outcome.";
	else values.outcome = b.outcome;
	// An unanswered call cannot have been a conversation, and a conversation was answered: keep the record consistent.
	if (values.outcome && values.answered === false && values.outcome === "spoke_to_customer") errors.outcome = "A call that was not answered cannot be recorded as spoken to the customer.";
	if (values.outcome && values.answered === true && ["no_answer", "busy"].includes(values.outcome)) errors.outcome = "An answered call cannot have the outcome no answer or busy.";

	if (b.interest !== undefined && b.interest !== null && b.interest !== "") {
		if (!INTERESTS.includes(b.interest)) errors.interest = "Choose a valid interest level.";
		else values.interest = b.interest;
	}

	const notes = text(b.notes, LIMITS.noteMax);
	if (notes.length < LIMITS.noteMin) errors.notes = "Add a short call note.";
	else values.notes = notes;

	if (b.confirmation_details !== undefined && b.confirmation_details !== null && b.confirmation_details !== "") values.confirmation_details = text(b.confirmation_details, LIMITS.confirmMax);

	if (b.follow_up_status_after !== undefined && b.follow_up_status_after !== null && b.follow_up_status_after !== "") {
		if (!FOLLOW_UP_STATUSES.includes(b.follow_up_status_after)) errors.follow_up_status_after = "Choose a valid follow-up status.";
		else if (b.follow_up_status_after === "completed") errors.follow_up_status_after = 'Use "Mark follow-up completed" (with a note) to complete a follow-up.';
		else values.follow_up_status_after = b.follow_up_status_after;
	}

	const next = nextFollowUp(b.next_follow_up_at, now);
	if (next.error) errors.next_follow_up_at = next.error;
	else if (next.value) values.next_follow_up_at = next.value;
	return { values, errors };
}

// A next follow-up must be a real future moment, within a year.
export function nextFollowUp(raw, now) {
	const p = parseInstant(raw);
	if (p.error) return p;
	if (!p.value) return { value: null };
	const t = p.value.getTime();
	const n = new Date(now).getTime();
	if (t <= n) return { error: "The next follow-up must be in the future." };
	if (t > n + LIMITS.maxFollowUpDays * MS_DAY) return { error: "The next follow-up must be within a year." };
	return { value: p.value };
}

// An explicit status change on its own (no call). "completed" is only ever set here, with a note.
export function validateStatusChange(input, now) {
	const b = input && typeof input === "object" ? input : {};
	const errors = {};
	const values = {};
	if (!FOLLOW_UP_STATUSES.includes(b.status)) errors.status = "Choose a valid follow-up status.";
	else values.status = b.status;
	const next = nextFollowUp(b.next_follow_up_at, now);
	if (next.error) errors.next_follow_up_at = next.error;
	else values.next_follow_up_at = next.value;
	const note = line(b.note, LIMITS.completionNoteMax);
	if (values.status === "completed") {
		if (note.length < LIMITS.completionNoteMin) errors.note = `Completing a follow-up needs a note on the outcome (at least ${LIMITS.completionNoteMin} characters).`;
		else values.note = note;
	} else if (note) values.note = note;
	return { values, errors };
}
