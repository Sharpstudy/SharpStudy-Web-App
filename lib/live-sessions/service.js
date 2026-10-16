// Scheduled live sessions: one-to-one tutoring and group classes.
//
// A session is a row of lc_classes with a stable id and its own random Jitsi room.
// The server is authoritative for who may manage it (the instructor who owns
// it, or an admin), who may take a seat and who may join (a seat holder who still
// has a PAID enrolment in the session's course), for time windows and for status
// transitions. Nothing here trusts a client-supplied instructor id, price or room.
//
// Pure with respect to storage: every function takes a `repo` (see repo.js; tests
// use an in-memory one) and an explicit `now` (Date).
//
// Status: scheduled -> live -> completed, or scheduled -> cancelled.
//   Starting happens when the instructor joins. A session nobody started is
//   completed (never held) once its end + grace passes. Cancelled and completed are final.

import { v4 as uuidv4 } from "uuid";
import { ServiceError } from "../mastery/service.js";
import { zonedToUtc } from "../meetings/time.js";

const fail = (status, code, message) => {
	throw new ServiceError(status, code, message);
};

export const SESSION_TYPES = ["group", "one_to_one"];
export const LIMITS = {
	titleMin: 3,
	titleMax: 160,
	descriptionMax: 2000,
	durationMin: 15,
	durationMax: 240,
	capacityMin: 2,
	capacityMax: 500,
	capacityDefault: 30,
	horizonDays: 365,
};
const MIN = 60 * 1000;
export const WINDOW = {
	studentEarlyMs: 10 * MIN, // students can enter from 10 min before the start
	instructorEarlyMs: 30 * MIN,
	graceMs: 30 * MIN, // and until 30 min after the scheduled end
	lateAfterMs: 10 * MIN, // arriving later than this is "late"
	maxStintMs: 6 * 60 * MIN, // cap for one unclosed stint when crediting time
};

const ms = (d) => (d ? new Date(d).getTime() : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);
export const participantKey = (userId) => `u:${userId}`;
const overlaps = (aStart, aEnd, bStart, bEnd) => ms(aStart) < ms(bEnd) && ms(aEnd) > ms(bStart);

// ------------------------------------------------------------- settle

// Persist the time-driven transitions the first time anyone looks after they are due.
export async function settleSession(repo, s, now) {
	if (!s) return s;
	const due = ms(s.end_at) + WINDOW.graceMs <= now.getTime();
	if (due && (s.status === "live" || s.status === "scheduled")) {
		const patch = { status: "completed", ended_at: s.status === "live" ? s.end_at : null };
		const updated = await repo.updateSession(s.id, patch, { whereStatus: s.status });
		if (s.status === "live") await closeStints(repo, s.id, new Date(ms(s.end_at)));
		return updated || { ...s, ...patch };
	}
	return s;
}

async function closeStints(repo, classId, at) {
	for (const a of await repo.listAttendance(classId)) {
		if (!a.left_at) await repo.updateAttendance(a.id, stintEnd(a, at));
	}
}

const stintEnd = (a, at) => {
	const spent = a.last_seen_at ? Math.max(0, Math.min(at.getTime() - ms(a.last_seen_at), WINDOW.maxStintMs)) : 0;
	return { left_at: at, total_seconds: (a.total_seconds || 0) + Math.floor(spent / 1000) };
};

// ----------------------------------------------------------- validation

function parseWhen(input, now) {
	const startAt = zonedToUtc(String(input.date || ""), String(input.time || ""), String(input.timeZone || ""));
	if (!startAt) fail(422, "invalid", "Choose a valid date, start time and time zone");
	const duration = Number(input.durationMin);
	if (!Number.isInteger(duration) || duration < LIMITS.durationMin || duration > LIMITS.durationMax) {
		fail(422, "invalid", `Duration must be ${LIMITS.durationMin}–${LIMITS.durationMax} minutes`);
	}
	if (startAt.getTime() <= now.getTime()) fail(422, "invalid", "The start time must be in the future");
	if (startAt.getTime() > now.getTime() + LIMITS.horizonDays * 24 * 60 * MIN) fail(422, "invalid", "Sessions can be scheduled up to a year ahead");
	return { startAt, endAt: new Date(startAt.getTime() + duration * MIN), timeZone: String(input.timeZone) };
}

function validateCreate(input, now) {
	const title = String(input.title || "").trim();
	if (title.length < LIMITS.titleMin || title.length > LIMITS.titleMax) fail(422, "invalid", `Title must be ${LIMITS.titleMin}–${LIMITS.titleMax} characters`);
	const description = String(input.description || "").trim();
	if (description.length > LIMITS.descriptionMax) fail(422, "invalid", `Description must be at most ${LIMITS.descriptionMax} characters`);
	if (!SESSION_TYPES.includes(input.sessionType)) fail(422, "invalid", "Choose one-to-one or group");
	let capacity = 1;
	if (input.sessionType === "group") {
		capacity = input.capacity === undefined || input.capacity === "" || input.capacity === null ? LIMITS.capacityDefault : Number(input.capacity);
		if (!Number.isInteger(capacity) || capacity < LIMITS.capacityMin || capacity > LIMITS.capacityMax) {
			fail(422, "invalid", `Group capacity must be ${LIMITS.capacityMin}–${LIMITS.capacityMax}`);
		}
	}
	if (!input.courseId) fail(422, "invalid", "Choose the course this session belongs to");
	// Assigned students: ids only; who they are is looked up and checked on the server.
	const rawIds = input.studentIds === undefined || input.studentIds === null ? [] : input.studentIds;
	if (!Array.isArray(rawIds) || rawIds.length > LIMITS.capacityMax || rawIds.some((x) => typeof x !== "string" || !x || x.length > 36)) fail(422, "invalid", "Choose students from the list");
	const studentIds = [...new Set(rawIds)];
	if (input.sessionType === "one_to_one" && studentIds.length !== 1) fail(422, "invalid", "A one-to-one session needs exactly one student");
	if (studentIds.length > capacity) fail(422, "invalid", `You selected ${studentIds.length} students but the session has ${capacity} seats`);
	return { studentIds, title, description: description || null, sessionType: input.sessionType, capacity, ...parseWhen(input, now) };
}

// ----------------------------------------------------------------- access

// Resolve what the caller may do with a session.
//   instructor: the owning instructor, or an admin
//   student:    anyone else (seat + paid enrolment are checked per action)
export async function getSessionAccess(repo, actor, id, now = new Date()) {
	if (!actor || !actor.userId) fail(401, "unauthorized", "Sign in first");
	let session = await repo.getSession(String(id || ""));
	if (!session) fail(404, "not_found", "Session not found");
	session = await settleSession(repo, session, now);
	const manager = session.instructor_id === actor.userId || actor.role === "admin";
	return { session, role: manager ? "instructor" : "student" };
}

// Managing requires being the owner/admin. Anyone else gets a 404 unless they hold a seat.
async function requireManager(repo, actor, id, now) {
	const a = await getSessionAccess(repo, actor, id, now);
	if (a.role !== "instructor") {
		const seat = await repo.getSeat(a.session.id, participantKey(actor.userId));
		if (seat) fail(403, "forbidden", "Only the instructor can do this");
		fail(404, "not_found", "Session not found");
	}
	return a;
}

function requireTeacher(actor) {
	if (!actor || !actor.userId) fail(401, "unauthorized", "Sign in first");
	if (actor.role !== "instructor" && actor.role !== "admin") fail(403, "forbidden", "Only approved instructors can manage live sessions");
}

// The student side of access: a paid enrolment in the course AND a seat.
export async function studentEntitlement(repo, actor, session) {
	const seat = await repo.getSeat(session.id, participantKey(actor.userId));
	const paid = !!session.course_id && (await repo.hasPaidEnrolment(actor.userId, session.course_id));
	return { seat, paid, ok: !!seat && paid };
}

// ------------------------------------------------------------------ views

export const joinWindow = (s, role, now) => {
	const early = role === "instructor" ? WINDOW.instructorEarlyMs : WINDOW.studentEarlyMs;
	return { opensAt: new Date(ms(s.start_at) - early), closesAt: new Date(ms(s.end_at) + WINDOW.graceMs) };
};

function baseView(s, { course, seats, role, now }) {
	const w = joinWindow(s, role, now);
	const open = (s.status === "scheduled" || s.status === "live") && now >= w.opensAt && now <= w.closesAt;
	return {
		id: s.id,
		title: s.title,
		description: s.description || "",
		courseId: s.course_id,
		courseTitle: course ? course.title : null,
		sessionType: s.session_type,
		capacity: s.capacity,
		enrollmentMode: s.enrollment_mode || "open",
		seatsTaken: seats,
		seatsLeft: Math.max(0, s.capacity - seats),
		full: seats >= s.capacity,
		startAt: iso(s.start_at),
		endAt: iso(s.end_at),
		timeZone: s.time_zone,
		status: s.status,
		held: !!s.started_at,
		startedAt: iso(s.started_at),
		endedAt: iso(s.ended_at),
		cancelledAt: iso(s.cancelled_at),
		joinOpensAt: iso(w.opensAt),
		joinClosesAt: iso(w.closesAt),
		windowOpen: open,
	};
}

const attendanceView = (a) => ({
	status: a.status,
	firstJoinedAt: iso(a.first_joined_at),
	leftAt: iso(a.left_at),
	totalSeconds: a.total_seconds || 0,
});
const ABSENT = { status: "absent", firstJoinedAt: null, leftAt: null, totalSeconds: 0 };

async function instructorView(repo, s, now) {
	const course = s.course_id ? (await repo.getCourses([s.course_id]))[0] : null;
	const seats = await repo.listSeats(s.id);
	const attendance = new Map((await repo.listAttendance(s.id)).map((a) => [a.participant_key, a]));
	const held = s.status === "completed" && !!s.started_at;
	return {
		...baseView(s, { course, seats: seats.length, role: "instructor", now }),
		role: "instructor",
		participants: seats.map((p) => {
			const a = attendance.get(p.participant_key);
			return { userId: p.user_id, name: p.display_name, bookedAt: iso(p.created_at), attendance: a ? attendanceView(a) : held ? ABSENT : null };
		}),
	};
}

async function studentView(repo, s, actor, now, { course, seats, seat, entitled }) {
	const mine = seat ? await repo.getAttendance(s.id, participantKey(actor.userId)) : null;
	const v = baseView(s, { course, seats, role: "student", now });
	const held = s.status === "completed" && !!s.started_at;
	return {
		...v,
		role: "student",
		booked: !!seat,
		entitled: !!entitled,
		canJoin: !!seat && !!entitled && v.windowOpen,
		myAttendance: mine ? attendanceView(mine) : seat && held ? ABSENT : null,
	};
}

async function studentContext(repo, actor, session) {
	const { seat, paid } = await studentEntitlement(repo, actor, session);
	const seats = (await repo.countSeats(session.id)) || 0;
	const course = session.course_id ? (await repo.getCourses([session.course_id]))[0] : null;
	return { seat, entitled: paid, seats, course };
}

// Open sessions students may discover. A booked one-to-one is private.
const discoverable = (s, seats) => s.status === "scheduled" && s.enrollment_mode !== "assigned" && (s.session_type === "group" || seats < s.capacity);

// ---------------------------------------------------------- instructor API

async function assertNoInstructorOverlap(repo, instructorId, startAt, endAt, exceptId) {
	const busy = await repo.listActiveSessions(instructorId);
	const clash = busy.find((x) => x.id !== exceptId && overlaps(startAt, endAt, x.start_at, x.end_at));
	if (clash) fail(409, "overlap", `You already have "${clash.title}" at that time`);
}

// Students the instructor may assign: paid enrolment in this course (nobody else, no other courses).
async function resolveStudents(repo, ownerId, courseId, studentIds) {
	if (!studentIds.length) return [];
	const eligible = new Map((await repo.listEligibleStudents(courseId, { ids: studentIds })).map((u) => [u.id, u]));
	const missing = studentIds.filter((id) => !eligible.has(id) || id === ownerId);
	if (missing.length) fail(422, "ineligible", "Some selected students are not paid students of this course");
	return studentIds.map((id) => eligible.get(id));
}

async function assertStudentsFree(repo, students, startAt, endAt, exceptId) {
	for (const u of students) {
		const mine = await repo.listSessionsForParticipant(participantKey(u.id));
		const clash = mine.find((x) => x.id !== exceptId && (x.status === "scheduled" || x.status === "live") && overlaps(startAt, endAt, x.start_at, x.end_at));
		// Names the student, never the other session (it may belong to another instructor).
		if (clash) fail(409, "overlap", `${u.name || "A selected student"} already has a session at that time`);
	}
}

const lockKeys = (ownerId, studentIds) => [`instructor:${ownerId}`, ...studentIds.map((id) => `student:${id}`)];

// Eligible students for the course picker. Instructors only see learners of courses they own.
export async function listEligibleStudents(repo, actor, courseId, { q = "" } = {}) {
	requireTeacher(actor);
	const course = (await repo.getCourses([String(courseId || "")]))[0];
	if (!course) fail(404, "not_found", "Course not found");
	if (course.userId !== actor.userId && actor.role !== "admin") fail(403, "forbidden", "You can only list students of your own courses");
	const needle = String(q || "").trim().toLowerCase().slice(0, 80);
	const all = await repo.listEligibleStudents(course.id, {});
	const students = all
		.filter((u) => u.id !== course.userId)
		.filter((u) => !needle || String(u.name).toLowerCase().includes(needle) || String(u.email).toLowerCase().includes(needle))
		.slice(0, 200)
		.map((u) => ({ id: u.id, name: u.name, email: u.email }));
	return { course: { id: course.id, title: course.title }, students, total: all.length };
}

export async function createSession(repo, actor, input, now = new Date()) {
	requireTeacher(actor);
	const f = validateCreate(input || {}, now);
	const course = (await repo.getCourses([String(input.courseId)]))[0];
	if (!course) fail(404, "not_found", "Course not found");
	if (course.userId !== actor.userId && actor.role !== "admin") fail(403, "forbidden", "You can only schedule sessions for your own courses");
	const ownerId = course.userId; // the course owner / token, never a body field

	return repo.atomic(lockKeys(ownerId, f.studentIds), async (tx) => {
		const students = await resolveStudents(tx, ownerId, course.id, f.studentIds);
		await assertNoInstructorOverlap(tx, ownerId, f.startAt, f.endAt, null);
		await assertStudentsFree(tx, students, f.startAt, f.endAt, null);
		const s = await tx.insertSession({
			id: uuidv4(),
			instructor_id: ownerId,
			title: f.title,
			description: f.description,
			subject: String(course.title || "Live session").slice(0, 80),
			course_id: course.id,
			start_at: f.startAt,
			end_at: f.endAt,
			time_zone: f.timeZone,
			provider: "jitsi",
			// Random and unique per session: not derived from the course, title or id.
			room_name: `ss-${uuidv4().replace(/-/g, "")}`,
			status: "scheduled",
			session_type: f.sessionType,
			capacity: f.capacity,
			enrollment_mode: students.length ? "assigned" : "open",
		});
		for (const u of students) {
			await tx.insertSeat({ id: uuidv4(), class_id: s.id, participant_key: participantKey(u.id), user_id: u.id, display_name: String(u.name || "Student").slice(0, 120), added_by: actor.userId });
		}
		return instructorView(tx, s, now);
	});
}

export async function rescheduleSession(repo, actor, id, input, now = new Date()) {
	requireTeacher(actor);
	const { session } = await requireManager(repo, actor, id, now);
	const when = parseWhen(input || {}, now);
	const seatedIds = (await repo.listSeats(session.id)).map((p) => p.user_id).filter(Boolean);
	return repo.atomic(lockKeys(session.instructor_id, seatedIds), async (tx) => {
		const fresh = await tx.getSession(session.id);
		if (!fresh || fresh.status !== "scheduled") fail(409, "conflict", "Only scheduled sessions can be rescheduled");
		await assertNoInstructorOverlap(tx, fresh.instructor_id, when.startAt, when.endAt, fresh.id);
		await assertStudentsFree(tx, (await tx.listSeats(fresh.id)).map((p) => ({ id: p.user_id, name: p.display_name })), when.startAt, when.endAt, fresh.id);
		const updated = await tx.updateSession(fresh.id, { start_at: when.startAt, end_at: when.endAt, time_zone: when.timeZone }, { whereStatus: "scheduled" });
		if (!updated) fail(409, "conflict", "Only scheduled sessions can be rescheduled");
		return instructorView(tx, updated, now);
	});
}

export async function cancelSession(repo, actor, id, now = new Date()) {
	requireTeacher(actor);
	const { session } = await requireManager(repo, actor, id, now);
	if (session.status === "cancelled") return instructorView(repo, session, now);
	if (session.status !== "scheduled") fail(409, "conflict", session.status === "live" ? "A live session must be ended, not cancelled" : "A completed session cannot be cancelled");
	const updated = await repo.updateSession(session.id, { status: "cancelled", cancelled_at: now }, { whereStatus: "scheduled" });
	if (!updated) fail(409, "conflict", "The session changed; reload and try again");
	return instructorView(repo, updated, now);
}

export async function endSession(repo, actor, id, now = new Date()) {
	requireTeacher(actor);
	const { session } = await requireManager(repo, actor, id, now);
	if (session.status === "completed") return instructorView(repo, session, now);
	if (session.status !== "live") fail(409, "conflict", "Only a live session can be ended");
	const updated = await repo.updateSession(session.id, { status: "completed", ended_at: now }, { whereStatus: "live" });
	await closeStints(repo, session.id, now);
	return instructorView(repo, updated || { ...session, status: "completed", ended_at: now }, now);
}

export async function getSessionDetail(repo, actor, id, now = new Date()) {
	const { session, role } = await getSessionAccess(repo, actor, id, now);
	if (role === "instructor") return instructorView(repo, session, now);
	const ctx = await studentContext(repo, actor, session);
	// A session you hold no seat for and cannot book is the same as a missing one.
	if (!ctx.seat && !(ctx.entitled && discoverable(session, ctx.seats))) fail(404, "not_found", "Session not found");
	return studentView(repo, session, actor, now, ctx);
}

// -------------------------------------------------------------------- lists

export async function listSessions(repo, actor, { scope } = {}, now = new Date()) {
	if (!actor || !actor.userId) fail(401, "unauthorized", "Sign in first");
	if (scope === "teaching") {
		requireTeacher(actor);
		const rows = actor.role === "admin" ? await repo.listAllSessions() : await repo.listInstructorSessions(actor.userId);
		const out = [];
		for (const r of rows) out.push(await instructorView(repo, await settleSession(repo, r, now), now));
		return { sessions: out.sort((a, b) => ms(a.startAt) - ms(b.startAt)) };
	}
	// Student side: sessions I hold a seat in, plus open sessions of courses I have paid for.
	const mineRows = await repo.listSessionsForParticipant(participantKey(actor.userId));
	const courseIds = await repo.listPaidCourseIds(actor.userId);
	const openRows = await repo.listOpenSessionsForCourses(courseIds, now);
	const byId = new Map();
	for (const r of [...mineRows, ...openRows]) byId.set(r.id, r);
	const out = [];
	for (const r of byId.values()) {
		if (r.instructor_id === actor.userId) continue; // your own teaching shows in the teaching list
		const s = await settleSession(repo, r, now);
		const ctx = await studentContext(repo, actor, s);
		if (!ctx.seat && !(ctx.entitled && discoverable(s, ctx.seats))) continue;
		out.push(await studentView(repo, s, actor, now, ctx));
	}
	return { sessions: out.sort((a, b) => ms(a.startAt) - ms(b.startAt)) };
}

// ------------------------------------------------------------------- seats

export async function takeSeat(repo, actor, id, now = new Date()) {
	if (!actor || !actor.userId) fail(401, "unauthorized", "Sign in first");
	const first = await repo.getSession(String(id || ""));
	if (!first) fail(404, "not_found", "Session not found");
	if (first.instructor_id === actor.userId) fail(403, "forbidden", "You teach this session");
	const key = participantKey(actor.userId);

	// The session row is locked, so two students can never both take the last seat.
	await repo.atomic([`session:${first.id}`, `student:${actor.userId}`], async (tx) => {
		const s = await settleSession(tx, await tx.getSession(first.id), now);
		if (!s.course_id || !(await tx.hasPaidEnrolment(actor.userId, s.course_id))) fail(403, "not_enrolled", "Enrol in this course to book its live sessions");
		if (s.status === "cancelled") fail(409, "cancelled", "This session was cancelled");
		if (s.status === "completed") fail(409, "completed", "This session has finished");
		if (s.enrollment_mode === "assigned") fail(403, "assigned_only", "This session is for students your instructor assigned");
		const bookable = s.session_type === "one_to_one" ? s.status === "scheduled" && now.getTime() < ms(s.start_at) : ms(s.end_at) > now.getTime();
		if (!bookable) fail(409, "closed", "Booking for this session has closed");
		if (await tx.getSeat(s.id, key)) return; // already booked: idempotent
		if ((await tx.countSeats(s.id)) >= s.capacity) fail(409, "full", s.session_type === "one_to_one" ? "This slot has already been booked" : "This session is full");
		const mine = await tx.listSessionsForParticipant(key);
		const clash = mine.find((x) => x.id !== s.id && (x.status === "scheduled" || x.status === "live") && overlaps(s.start_at, s.end_at, x.start_at, x.end_at));
		if (clash) fail(409, "overlap", `You already have "${clash.title}" at that time`);
		try {
			await tx.insertSeat({ id: uuidv4(), class_id: s.id, participant_key: key, user_id: actor.userId, display_name: String(actor.name || "Student").slice(0, 120), added_by: actor.userId });
		} catch (e) {
			if (!(e && e.code === "duplicate_seat")) throw e; // a retry that raced itself: already booked
		}
	});
	return getSessionDetail(repo, actor, first.id, now);
}

export async function releaseSeat(repo, actor, id, now = new Date()) {
	if (!actor || !actor.userId) fail(401, "unauthorized", "Sign in first");
	const s = await settleSession(repo, await repo.getSession(String(id || "")), now);
	if (!s) fail(404, "not_found", "Session not found");
	const key = participantKey(actor.userId);
	if (!(await repo.getSeat(s.id, key))) fail(404, "not_found", "You have no booking for this session");
	if (s.enrollment_mode === "assigned") fail(403, "assigned_only", "Your instructor assigned you to this session; ask them to change it");
	if (s.status !== "scheduled" || now.getTime() >= ms(s.start_at)) fail(409, "closed", "A booking can only be cancelled before the session starts");
	await repo.deleteSeat(s.id, key);
	return { released: true };
}

// -------------------------------------------------------------- join / leave

// Validated on EVERY join: the room name is only ever returned here.
export async function joinSession(repo, actor, id, { domain = "meet.jit.si" } = {}, now = new Date()) {
	const { session: s0, role } = await getSessionAccess(repo, actor, id, now);
	let s = s0;
	const displayName = String(actor.name || (role === "instructor" ? "Instructor" : "Student")).slice(0, 120);
	if (role === "student") {
		const e = await studentEntitlement(repo, actor, s);
		// A stranger must not learn that a private session exists.
		if (!e.seat) {
			if (s.session_type === "one_to_one") fail(404, "not_found", "Session not found");
			fail(403, "forbidden", "Book a seat in this session first");
		}
		if (!e.paid) fail(403, "not_enrolled", "Your access to this course has ended");
	}
	if (s.status === "cancelled") fail(409, "cancelled", "This session was cancelled");
	if (s.status === "completed") fail(409, "completed", "This session has finished");
	const w = joinWindow(s, role, now);
	if (now < w.opensAt) fail(409, "too_early", `This session opens at ${iso(w.opensAt)}`);
	if (now > w.closesAt) fail(409, "closed", "The join window for this session has closed");

	if (role === "instructor") {
		if (s.status === "scheduled") s = (await repo.updateSession(s.id, { status: "live", started_at: now }, { whereStatus: "scheduled" })) || (await repo.getSession(s.id));
	} else {
		await recordJoin(repo, s, actor, displayName, now);
	}
	return { sessionId: s.id, status: s.status, role, roomName: s.room_name, domain, displayName };
}

async function recordJoin(repo, s, actor, displayName, now) {
	const key = participantKey(actor.userId);
	const existing = await repo.getAttendance(s.id, key);
	if (existing) {
		// Reconnect: one row per participant. A stint that never closed keeps running.
		if (existing.left_at) await repo.updateAttendance(existing.id, { left_at: null, last_seen_at: now, display_name: displayName });
		return;
	}
	try {
		await repo.insertAttendance({
			id: uuidv4(),
			class_id: s.id,
			participant_key: key,
			display_name: displayName,
			status: now.getTime() > ms(s.start_at) + WINDOW.lateAfterMs ? "late" : "present",
			source: "auto",
			first_joined_at: now,
			last_seen_at: now,
			left_at: null,
			total_seconds: 0,
		});
	} catch (e) {
		if (!(e && e.code === "duplicate_attendance")) throw e; // two tabs joined together: the other one recorded it
	}
}

export async function leaveSession(repo, actor, id, now = new Date()) {
	const { session, role } = await getSessionAccess(repo, actor, id, now);
	if (role === "student") {
		const a = await repo.getAttendance(session.id, participantKey(actor.userId));
		if (a && !a.left_at) await repo.updateAttendance(a.id, stintEnd(a, now));
	}
	return { left: true };
}

// ---------------------------------------------------------------- attendance

// Instructor: the whole roster. Student: only their own row.
export async function getAttendance(repo, actor, id, now = new Date()) {
	const { session, role } = await getSessionAccess(repo, actor, id, now);
	if (role === "instructor") {
		const v = await instructorView(repo, session, now);
		return { sessionId: session.id, status: session.status, participants: v.participants };
	}
	if (!(await repo.getSeat(session.id, participantKey(actor.userId)))) fail(404, "not_found", "Session not found");
	const a = await repo.getAttendance(session.id, participantKey(actor.userId));
	return { sessionId: session.id, status: session.status, mine: a ? attendanceView(a) : null };
}
