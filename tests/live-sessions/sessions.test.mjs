import test from "node:test";
import assert from "node:assert/strict";
import * as ls from "../../lib/live-sessions/service.js";
import { createSessionRepo } from "./memoryRepo.mjs";

const actor = (userId, role = "student", name = userId) => ({ userId, role, name });
const NOW = new Date("2026-10-20T10:00:00Z");
const at = (min) => new Date(NOW.getTime() + min * 60000);
const teacher = actor("t1", "instructor", "Tia Teacher");
const teacher2 = actor("t2", "instructor");

function setup() {
	const repo = createSessionRepo();
	repo._db.courses.push({ id: "c1", slug: "math", title: "Math", userId: "t1" }, { id: "c2", slug: "art", title: "Art", userId: "t2" });
	for (const u of ["s1", "s2", "s3"]) repo._db.enrolments.push({ userId: u, courseId: "c1", status: "paid" });
	repo._db.enrolments.push({ userId: "s9", courseId: "c2", status: "paid" }, { userId: "unpaid", courseId: "c1", status: "unpaid" });
	return repo;
}
// 2026-10-21 12:00 UTC = 12:00 in the UTC zone
const input = (extra = {}) => ({ title: "Algebra", courseId: "c1", sessionType: "group", capacity: 2, date: "2026-10-21", time: "12:00", timeZone: "UTC", durationMin: 60, ...extra });
const START = new Date("2026-10-21T12:00:00Z");
// One-to-one sessions are now created with an assigned student. Open slots (the earlier self-booking
// flow) still exist in the database, so the booking tests seed one directly.
async function openSlot(repo, extra = {}) {
	const v = await create(repo, extra);
	Object.assign(repo._db.sessions.find((s) => s.id === v.id), { session_type: "one_to_one", capacity: 1, enrollment_mode: "open" });
	return { ...v, sessionType: "one_to_one", capacity: 1 };
}
const create = (repo, extra, who = teacher) => ls.createSession(repo, who, input(extra), NOW);

test("approved instructors create sessions with a stable id and a private random room", async () => {
	const repo = setup();
	const v = await create(repo, {});
	assert.equal(v.status, "scheduled");
	assert.equal(v.startAt, START.toISOString());
	assert.equal(v.endAt, new Date(START.getTime() + 3600000).toISOString());
	assert.equal(v.capacity, 2);
	assert.equal(v.role, "instructor");
	assert.ok(!("roomName" in v), "room names are only returned by join");
	const v2 = await create(repo, { time: "15:00" });
	const rooms = repo._db.sessions.map((s) => s.room_name);
	assert.equal(new Set(rooms).size, 2, "different sessions never share a room");
	assert.match(rooms[0], /^ss-[0-9a-f]{32}$/);
	assert.notEqual(v.id, v2.id);
	assert.ok(!rooms[0].includes("math"), "not derived from the course slug");
});

test("students, anonymous users and other instructors cannot create sessions; client instructor id is ignored", async () => {
	const repo = setup();
	await assert.rejects(ls.createSession(repo, actor("s1"), input(), NOW), { status: 403 });
	await assert.rejects(ls.createSession(repo, null, input(), NOW), { status: 401 });
	await assert.rejects(ls.createSession(repo, teacher2, input(), NOW), { status: 403 }, "course owned by someone else");
	await assert.rejects(ls.createSession(repo, teacher, input({ courseId: "nope" }), NOW), { status: 404 });
	const v = await ls.createSession(repo, teacher, input({ instructor_id: "t2", instructorId: "t2" }), NOW);
	assert.equal(repo._db.sessions.find((s) => s.id === v.id).instructor_id, "t1");
});

test("validation: type, capacity, time, duration, past", async () => {
	const repo = setup();
	const bad = [
		{ title: "x" },
		{ sessionType: "triple" },
		{ capacity: 1 },
		{ capacity: 99999 },
		{ date: "2026-02-30" },
		{ time: "25:00" },
		{ timeZone: "Mars/Base" },
		{ durationMin: 5 },
		{ durationMin: 9999 },
		{ date: "2026-10-19" },
		{ date: "2030-01-01" },
		{ courseId: "" },
	];
	for (const b of bad) await assert.rejects(create(repo, b), { status: 422 }, JSON.stringify(b));
	const oto = await create(repo, { sessionType: "one_to_one", capacity: 50, studentIds: ["s1"] });
	assert.equal(oto.capacity, 1, "a one-to-one session always has exactly one seat");
});

test("an instructor cannot hold overlapping sessions; back-to-back is fine", async () => {
	const repo = setup();
	await create(repo, {});
	await assert.rejects(create(repo, { time: "12:30" }), { status: 409, code: "overlap" });
	await assert.rejects(create(repo, { time: "11:30" }), { status: 409, code: "overlap" });
	await create(repo, { time: "13:00" });
	await create(repo, { time: "11:00" });
});

test("concurrent creates cannot overlap", async () => {
	const repo = setup();
	const results = await Promise.allSettled([create(repo, {}), create(repo, {}), create(repo, { time: "12:15" })]);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(repo._db.sessions.length, 1);
});

test("manage: only the owner (or an admin) can reschedule, cancel, end; strangers do not learn the session exists", async () => {
	const repo = setup();
	const v = await create(repo, {});
	await ls.takeSeat(repo, actor("s1"), v.id, NOW);
	for (const fn of [
		() => ls.cancelSession(repo, teacher2, v.id, NOW),
		() => ls.rescheduleSession(repo, teacher2, v.id, input({ time: "14:00" }), NOW),
		() => ls.endSession(repo, teacher2, v.id, NOW),
	]) await assert.rejects(fn(), { status: 404 });
	// students are refused by the role gate before ownership is even looked at
	await assert.rejects(ls.cancelSession(repo, actor("s1"), v.id, NOW), { status: 403 });
	await assert.rejects(ls.cancelSession(repo, actor("s2"), v.id, NOW), { status: 403 });
	const r = await ls.rescheduleSession(repo, teacher, v.id, input({ time: "14:00" }), NOW);
	assert.equal(r.startAt, "2026-10-21T14:00:00.000Z");
	assert.equal(r.seatsTaken, 1, "bookings survive a reschedule");
	const admin = await ls.cancelSession(repo, actor("root", "admin"), v.id, NOW);
	assert.equal(admin.status, "cancelled");
});

test("reschedule respects the instructor's other sessions and only applies while scheduled", async () => {
	const repo = setup();
	const a = await create(repo, {});
	await create(repo, { time: "15:00" });
	await assert.rejects(ls.rescheduleSession(repo, teacher, a.id, input({ time: "15:30" }), NOW), { status: 409, code: "overlap" });
	await ls.cancelSession(repo, teacher, a.id, NOW);
	await assert.rejects(ls.rescheduleSession(repo, teacher, a.id, input({ time: "18:00" }), NOW), { status: 409 });
});

test("stale or revoked instructor role is rejected", async () => {
	const repo = setup();
	const v = await create(repo, {});
	// getAccountActor re-reads the role from the database on every request; a demoted user arrives as a student.
	const demoted = actor("t1", "student");
	await assert.rejects(ls.createSession(repo, demoted, input({ time: "18:00" }), NOW), { status: 403 });
	await assert.rejects(ls.cancelSession(repo, demoted, v.id, NOW), { status: 403 });
	await assert.rejects(ls.listSessions(repo, demoted, { scope: "teaching" }, NOW), { status: 403 });
});

test("one-to-one: the slot is bookable once, privately", async () => {
	const repo = setup();
	const slot = await openSlot(repo);
	const before = await ls.listSessions(repo, actor("s2"), {}, NOW);
	assert.deepEqual(before.sessions.map((s) => s.id), [slot.id], "eligible students see open slots");
	const booked = await ls.takeSeat(repo, actor("s1"), slot.id, NOW);
	assert.equal(booked.booked, true);
	assert.equal(booked.full, true);
	await assert.rejects(ls.takeSeat(repo, actor("s2"), slot.id, NOW), { status: 409, code: "full" });
	// Idempotent for the same student
	assert.equal((await ls.takeSeat(repo, actor("s1"), slot.id, NOW)).booked, true);
	// Once booked, the slot disappears for everyone else and cannot be read or joined
	assert.deepEqual((await ls.listSessions(repo, actor("s2"), {}, NOW)).sessions, []);
	await assert.rejects(ls.getSessionDetail(repo, actor("s2"), slot.id, NOW), { status: 404 });
	await assert.rejects(ls.joinSession(repo, actor("s2"), slot.id, {}, at(1430)), { status: 404 });
	assert.equal((await ls.listSessions(repo, actor("s1"), {}, NOW)).sessions.length, 1);
	const mine = await ls.listSessions(repo, teacher, { scope: "teaching" }, NOW);
	assert.equal(mine.sessions[0].participants[0].name, "s1");
});

test("concurrent bookings cannot double-book an exclusive slot or exceed group capacity", async () => {
	const repo = setup();
	const slot = await openSlot(repo);
	const res = await Promise.allSettled(["s1", "s2", "s3"].map((u) => ls.takeSeat(repo, actor(u), slot.id, NOW)));
	assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(repo._db.seats.filter((s) => s.class_id === slot.id).length, 1);

	const grp = await create(repo, { time: "15:00", capacity: 2 });
	const res2 = await Promise.allSettled(["s1", "s2", "s3"].map((u) => ls.takeSeat(repo, actor(u), grp.id, NOW)));
	assert.equal(res2.filter((r) => r.status === "fulfilled").length, 2);
	assert.equal(res2.find((r) => r.status === "rejected").reason.code, "full");
	assert.equal(repo._db.seats.filter((s) => s.class_id === grp.id).length, 2);
});

test("group capacity is enforced and a released seat can be reused", async () => {
	const repo = setup();
	const g = await create(repo, { capacity: 2 });
	await ls.takeSeat(repo, actor("s1"), g.id, NOW);
	await ls.takeSeat(repo, actor("s2"), g.id, NOW);
	await assert.rejects(ls.takeSeat(repo, actor("s3"), g.id, NOW), { status: 409, code: "full" });
	const listed = (await ls.listSessions(repo, actor("s3"), {}, NOW)).sessions[0];
	assert.equal(listed.full, true);
	await ls.releaseSeat(repo, actor("s1"), g.id, NOW);
	await ls.takeSeat(repo, actor("s3"), g.id, NOW);
});

test("booking needs a PAID enrolment in the session's course; the instructor cannot book their own", async () => {
	const repo = setup();
	const g = await create(repo, {});
	for (const who of ["s9", "unpaid", "nobody"]) await assert.rejects(ls.takeSeat(repo, actor(who), g.id, NOW), { status: 403, code: "not_enrolled" }, who);
	await assert.rejects(ls.takeSeat(repo, teacher, g.id, NOW), { status: 403 });
	await assert.rejects(ls.takeSeat(repo, actor("s1"), "00000000-0000-0000-0000-000000000000", NOW), { status: 404 });
	// buying the course does not open every session of the instructor
	assert.deepEqual((await ls.listSessions(repo, actor("s9"), {}, NOW)).sessions, []);
	await assert.rejects(ls.getSessionDetail(repo, actor("s9"), g.id, NOW), { status: 404 });
});

test("a student cannot hold two overlapping sessions", async () => {
	const repo = setup();
	repo._db.courses.push({ id: "c3", slug: "bio", title: "Bio", userId: "t2" });
	repo._db.enrolments.push({ userId: "s1", courseId: "c3", status: "paid" });
	const a = await create(repo, {});
	const b = await ls.createSession(repo, teacher2, input({ courseId: "c3", time: "12:30" }), NOW);
	await ls.takeSeat(repo, actor("s1"), a.id, NOW);
	await assert.rejects(ls.takeSeat(repo, actor("s1"), b.id, NOW), { status: 409, code: "overlap" });
});

test("cancelled sessions cannot be booked or joined; completed ones neither", async () => {
	const repo = setup();
	const g = await create(repo, {});
	await ls.takeSeat(repo, actor("s1"), g.id, NOW);
	await ls.cancelSession(repo, teacher, g.id, NOW);
	await assert.rejects(ls.joinSession(repo, actor("s1"), g.id, {}, at(1430)), { status: 409, code: "cancelled" });
	await assert.rejects(ls.joinSession(repo, teacher, g.id, {}, at(1430)), { status: 409, code: "cancelled" });
	await assert.rejects(ls.takeSeat(repo, actor("s2"), g.id, NOW), { status: 409, code: "cancelled" });
	await assert.rejects(ls.releaseSeat(repo, actor("s1"), g.id, NOW), { status: 409 }, "cancelled bookings are not editable");
	const detail = await ls.getSessionDetail(repo, actor("s1"), g.id, NOW);
	assert.equal(detail.status, "cancelled");
	assert.equal(detail.canJoin, false);
});

test("join: same room for the instructor and every seat holder, window enforced, strangers refused", async () => {
	const repo = setup();
	const g = await create(repo, { capacity: 5 });
	const other = await create(repo, { time: "16:00" });
	await ls.takeSeat(repo, actor("s1"), g.id, NOW);
	await ls.takeSeat(repo, actor("s2"), g.id, NOW);
	const early = new Date(START.getTime() - 5 * 60000);

	await assert.rejects(ls.joinSession(repo, actor("s1"), g.id, {}, NOW), { status: 409, code: "too_early" });
	const t = await ls.joinSession(repo, teacher, g.id, {}, new Date(START.getTime() - 20 * 60000));
	assert.equal(t.status, "live");
	const a = await ls.joinSession(repo, actor("s1"), g.id, {}, early);
	const b = await ls.joinSession(repo, actor("s2"), g.id, {}, early);
	assert.equal(a.roomName, t.roomName);
	assert.equal(b.roomName, t.roomName);
	const o = await ls.joinSession(repo, teacher, other.id, {}, new Date(other && new Date("2026-10-21T15:45:00Z")));
	assert.notEqual(o.roomName, t.roomName, "different sessions resolve to different rooms");

	await assert.rejects(ls.joinSession(repo, actor("s3"), g.id, {}, early), { status: 403 }, "enrolled but no seat");
	await assert.rejects(ls.joinSession(repo, actor("s9"), g.id, {}, early), { status: 403 });
	await assert.rejects(ls.joinSession(repo, null, g.id, {}, early), { status: 401 });
	await assert.rejects(ls.joinSession(repo, teacher2, g.id, {}, early), { status: 403 }, "another instructor is not the owner");
	await assert.rejects(ls.joinSession(repo, actor("s1"), g.id, {}, new Date(START.getTime() + 95 * 60000)), { status: 409 });
	// Revoked access is re-checked on every join
	repo._db.enrolments = repo._db.enrolments.filter((e) => e.userId !== "s2");
	await assert.rejects(ls.joinSession(repo, actor("s2"), g.id, {}, early), { status: 403, code: "not_enrolled" });
});

test("private rooms: a student without the seat cannot join and cannot tell the session exists", async () => {
	const repo = setup();
	const slot = await openSlot(repo);
	await ls.takeSeat(repo, actor("s1"), slot.id, NOW);
	const early = new Date(START.getTime() - 5 * 60000);
	const ok = await ls.joinSession(repo, actor("s1"), slot.id, {}, early);
	assert.ok(ok.roomName);
	for (const who of ["s2", "s3", "s9"]) await assert.rejects(ls.joinSession(repo, actor(who), slot.id, {}, early), { status: 404 });
	await assert.rejects(ls.getAttendance(repo, actor("s2"), slot.id, NOW), { status: 404 });
});

test("attendance: reconnecting reuses one row, accumulates time, late vs present, absent after the class", async () => {
	const repo = setup();
	const g = await create(repo, { capacity: 5 });
	for (const u of ["s1", "s2", "s3"]) await ls.takeSeat(repo, actor(u), g.id, NOW);
	await ls.joinSession(repo, teacher, g.id, {}, START);
	const min = (m) => new Date(START.getTime() + m * 60000);
	await ls.joinSession(repo, actor("s1"), g.id, {}, min(1));
	await ls.joinSession(repo, actor("s1"), g.id, {}, min(1)); // two tabs
	await ls.joinSession(repo, actor("s2"), g.id, {}, min(20)); // late
	await ls.leaveSession(repo, actor("s1"), g.id, min(11));
	await ls.leaveSession(repo, actor("s1"), g.id, min(12)); // idempotent
	await ls.joinSession(repo, actor("s1"), g.id, {}, min(15)); // rejoin
	await ls.leaveSession(repo, actor("s1"), g.id, min(20));
	assert.equal(repo._db.attendance.filter((a) => a.participant_key === "u:s1").length, 1, "no duplicate attendance on reconnect");
	const mine = (await ls.getAttendance(repo, actor("s1"), g.id, min(21))).mine;
	assert.equal(mine.status, "present");
	assert.equal(mine.totalSeconds, 10 * 60 + 5 * 60);
	assert.equal((await ls.getAttendance(repo, actor("s2"), g.id, min(21))).mine.status, "late");

	const ended = await ls.endSession(repo, teacher, g.id, min(30));
	assert.equal(ended.status, "completed");
	const roster = (await ls.getAttendance(repo, teacher, g.id, min(31))).participants;
	assert.deepEqual(roster.map((p) => [p.name, p.attendance.status]).sort(), [["s1", "present"], ["s2", "late"], ["s3", "absent"]]);
	assert.ok(roster.find((p) => p.name === "s2").attendance.totalSeconds >= 10 * 60, "open stints are closed when the class ends");
	// A student sees only their own record
	assert.ok(!("participants" in (await ls.getAttendance(repo, actor("s1"), g.id, min(31)))));
	await assert.rejects(ls.getAttendance(repo, actor("s9"), g.id, min(31)), { status: 404 });
	// And the completed state is visible to them
	const d = await ls.getSessionDetail(repo, actor("s3"), g.id, min(31));
	assert.equal(d.status, "completed");
	assert.equal(d.myAttendance.status, "absent");
	await assert.rejects(ls.joinSession(repo, actor("s1"), g.id, {}, min(32)), { status: 409, code: "completed" });
});

test("status transitions are enforced on the server", async () => {
	const repo = setup();
	const g = await create(repo, {});
	await assert.rejects(ls.endSession(repo, teacher, g.id, NOW), { status: 409 }, "cannot end a session that is not live");
	await ls.joinSession(repo, teacher, g.id, {}, START);
	await assert.rejects(ls.cancelSession(repo, teacher, g.id, START), { status: 409 }, "live sessions are ended, not cancelled");
	await assert.rejects(ls.rescheduleSession(repo, teacher, g.id, input({ date: "2026-10-22" }), NOW), { status: 409 });
	await ls.endSession(repo, teacher, g.id, new Date(START.getTime() + 600000));
	await assert.rejects(ls.cancelSession(repo, teacher, g.id, START), { status: 409 });
});

test("a session nobody started completes after its window and is shown as not held", async () => {
	const repo = setup();
	const g = await create(repo, {});
	await ls.takeSeat(repo, actor("s1"), g.id, NOW);
	const later = new Date(START.getTime() + 3 * 3600000);
	const d = await ls.getSessionDetail(repo, actor("s1"), g.id, later);
	assert.equal(d.status, "completed");
	assert.equal(d.held, false);
	assert.equal(d.myAttendance, null);
});
