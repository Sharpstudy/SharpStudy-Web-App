// Regression: notifications must follow the session's CURRENT state. An instructor who
// ends a session early must not leave students with "Starting soon" / "You have a live session".
import test from "node:test";
import assert from "node:assert/strict";
import * as ls from "../../lib/live-sessions/service.js";
import * as nt from "../../lib/live-sessions/notify.js";
import * as lq from "../../lib/live-questions/service.js";
import { createSessionRepo } from "./memoryRepo.mjs";

const actor = (userId, role = "student", name = userId) => ({ userId, role, name });
const NOW = new Date("2026-10-20T10:00:00Z");
const START = new Date("2026-10-21T12:00:00Z");
const teacher = actor("t1", "instructor", "Tia Teacher");
const min = (m) => new Date(START.getTime() + m * 60000);

function setup() {
	const repo = createSessionRepo();
	repo._db.courses.push({ id: "c1", slug: "math", title: "Math", userId: "t1" });
	for (const u of ["s1", "s2"]) repo._db.enrolments.push({ userId: u, courseId: "c1", status: "paid" });
	repo._db.users.push({ id: "t1", name: "Tia Teacher", email: "t@example.test" }, { id: "s1", name: "Ann", email: "a@example.test" }, { id: "s2", name: "Bo", email: "b@example.test" });
	return repo;
}
const input = (extra = {}) => ({ title: "Algebra", courseId: "c1", sessionType: "group", capacity: 5, date: "2026-10-21", time: "12:00", timeZone: "UTC", durationMin: 60, ...extra });
const ctx = { instructorName: "Tia Teacher", baseUrl: "https://app.test", now: NOW };
const mk = async (repo, extra) => {
	const v = await ls.createSession(repo, teacher, input(extra), NOW);
	await nt.notifySession(repo, "assigned", v, v.participants, ctx);
	return v;
};
const list = async (repo, who, now) => (await nt.listNotifications(repo, actor(who), now)).notifications;

test("REPRODUCTION: end a session early -> the student's notifications no longer say it is upcoming", async () => {
	const repo = setup();
	const v = await mk(repo, { studentIds: ["s1", "s2"] });
	const soon = min(-180); // 3 h before: reminder is created
	const before = await list(repo, "s1", soon);
	assert.deepEqual(before.map((n) => n.type).sort(), ["live_session_assigned", "live_session_reminder"]);
	assert.ok(before.every((n) => n.state === "upcoming"));

	await ls.joinSession(repo, teacher, v.id, {}, min(-5));
	await ls.joinSession(repo, actor("s1"), v.id, {}, min(0));
	const ended = await ls.endSession(repo, teacher, v.id, min(10)); // 50 minutes before the planned end
	assert.equal(ended.status, "completed");

	const row = repo._db.sessions.find((s) => s.id === v.id);
	assert.equal(row.status, "completed", "status persisted");
	assert.equal(new Date(row.ended_at).toISOString(), min(10).toISOString(), "actual end time persisted, not the scheduled end");

	const after = await list(repo, "s1", min(12)); // well before the scheduled end
	assert.ok(!after.some((n) => n.type === "live_session_reminder"), "no 'Starting soon' for a finished session");
	const assigned = after.find((n) => n.type === "live_session_assigned");
	assert.equal(assigned.state, "completed");
	assert.doesNotMatch(assigned.title, /You have a live session|Starting soon/);
	assert.match(assigned.title, /completed/i);
	assert.equal(assigned.link, `/learning/live/${v.id}/`, "history stays reachable");
	assert.equal((await nt.listNotifications(repo, actor("s1"), min(12))).unread, after.filter((n) => !n.read).length);
	// the stored rows are untouched: nothing was deleted
	assert.equal(repo._db.notifications.filter((n) => n.user_id === "s1").length, 2);
});

test("no new 'starting soon' is created for a session that has been completed, even with its scheduled end in the future", async () => {
	const repo = setup();
	const v = await mk(repo, { studentIds: ["s1"] });
	await ls.joinSession(repo, teacher, v.id, {}, min(-5));
	await ls.endSession(repo, teacher, v.id, min(-2)); // ended before it even began
	await nt.listNotifications(repo, actor("s1"), min(-60));
	assert.equal(repo._db.notifications.filter((n) => n.type === "live_session_reminder").length, 0);
});

test("opening an old notification shows the session's current state; the session page agrees", async () => {
	const repo = setup();
	const v = await mk(repo, { studentIds: ["s1"] });
	await ls.joinSession(repo, teacher, v.id, {}, min(-5));
	await ls.endSession(repo, teacher, v.id, min(10));
	const n = (await list(repo, "s1", min(11))).find((x) => x.type === "live_session_assigned");
	const id = n.link.split("/").filter(Boolean).pop();
	const detail = await ls.getSessionDetail(repo, actor("s1"), id, min(11));
	assert.equal(detail.status, n.state);
	assert.equal(detail.windowOpen, false);
	assert.equal(detail.canJoin, false);
	await assert.rejects(ls.joinSession(repo, actor("s1"), id, {}, min(11)), { status: 409, code: "completed" });
	await assert.rejects(ls.joinSession(repo, actor("s2"), id, {}, min(11)), { status: 403 }, "non-participants still cannot");
});

test("ending is idempotent and keeps attendance, answers and results", async () => {
	const repo = setup();
	const v = await mk(repo, { studentIds: ["s1", "s2"] });
	await ls.joinSession(repo, teacher, v.id, {}, min(-5));
	await ls.joinSession(repo, actor("s1"), v.id, {}, min(1));
	// live question inside the session, answered before the early end
	const lrepo = lqRepo(repo, v.id);
	const q = await lq.createQuestion(lrepo, teacher, v.id, { text: "2+2", options: ["3", "4"], correctIndex: 1, publish: true }, min(2));
	await lq.submitAnswer(lrepo, actor("s1"), v.id, q.id, "o2", min(3));
	const e1 = await ls.endSession(repo, teacher, v.id, min(10));
	const endedAt = repo._db.sessions[0].ended_at;
	const e2 = await ls.endSession(repo, teacher, v.id, min(20)); // retry
	const e3 = await ls.endSession(repo, teacher, v.id, min(30));
	assert.deepEqual([e1.status, e2.status, e3.status], ["completed", "completed", "completed"]);
	assert.equal(new Date(repo._db.sessions[0].ended_at).getTime(), new Date(endedAt).getTime(), "the first end time is kept");

	const att = (await ls.getAttendance(repo, actor("s1"), v.id, min(40))).mine;
	assert.equal(att.status, "present");
	assert.equal(att.totalSeconds, 9 * 60, "time counted up to the early end");
	assert.equal(repo._db.attendance.length, 1);
	const roster = (await ls.getAttendance(repo, teacher, v.id, min(40))).participants;
	assert.deepEqual(roster.map((p) => [p.name, p.attendance.status]).sort(), [["Ann", "present"], ["Bo", "absent"]]);

	// answers and results survive; no new answers after the end
	assert.equal(lrepo._db.responses.length, 1);
	assert.equal((await lq.listResults(lrepo, teacher, v.id, min(40))).questions[0].totals.answered, 1);
	assert.equal((await lq.getState(lrepo, actor("s1"), v.id, min(40))).current.id, q.id);
	await assert.rejects(lq.submitAnswer(lrepo, actor("s2"), v.id, q.id, "o2", min(41)), { status: 409 });
	// a notification retry after the end creates nothing new
	const again = await nt.notifySession(repo, "assigned", e1, e1.participants, ctx);
	assert.equal(again.created, 0);
});

// The live-questions memory repo only needs the session, seats, course and enrolments of this fixture.
function lqRepo(repo, sessionId) {
	const db = repo._db;
	const qs = { questions: [], responses: [], images: [] };
	const clone = (x) => (x ? structuredClone(x) : null);
	return {
		_db: qs,
		getSession: async (id) => clone(db.sessions.find((s) => s.id === id)),
		getCourseById: async (id) => clone(db.courses.find((c) => c.id === id)),
		getSeat: (c, k) => repo.getSeat(c, k),
		hasPaidEnrolment: (u, c) => repo.hasPaidEnrolment(u, c),
		listSessionParticipants: async (c) => db.seats.filter((s) => s.class_id === c).map((s) => ({ id: s.user_id, name: s.display_name })),
		getQuestion: async (id) => clone(qs.questions.find((q) => q.id === id)),
		listQuestions: async (c, cl = null) => qs.questions.filter((q) => q.course_id === c && (q.class_id || null) === cl).map(clone),
		maxSeq: async (c, cl = null) => Math.max(0, ...qs.questions.filter((q) => q.course_id === c && (q.class_id || null) === cl).map((q) => q.seq)),
		insertQuestion: async (row) => (qs.questions.push({ closed_at: null, opened_at: null, deadline_at: null, revealed_at: null, ...clone(row) }), clone(row)),
		updateQuestion: async (id, patch, { whereStatus } = {}) => {
			const q = qs.questions.find((x) => x.id === id);
			if (!q || (whereStatus && q.status !== whereStatus)) return null;
			return Object.assign(q, patch), clone(q);
		},
		closeOpenQuestions: async () => {},
		getResponse: async (q, u) => clone(qs.responses.find((r) => r.live_question_id === q && r.user_id === u)),
		listResponses: async (q) => qs.responses.filter((r) => r.live_question_id === q).map(clone),
		insertResponse: async (row) => (qs.responses.push(clone(row)), clone(row)),
		updateResponse: async () => {},
		getImage: async () => null,
	};
}

test("cancelled sessions are never presented as upcoming", async () => {
	const repo = setup();
	const v = await mk(repo, { studentIds: ["s1"] });
	await list(repo, "s1", min(-180)); // reminder exists
	const c = await ls.cancelSession(repo, teacher, v.id, min(-170));
	await nt.notifySession(repo, "cancelled", c, c.participants, ctx);
	const after = await list(repo, "s1", min(-160));
	assert.ok(!after.some((n) => n.type === "live_session_reminder"), "reminder hidden");
	const assigned = after.find((n) => n.type === "live_session_assigned");
	assert.equal(assigned.state, "cancelled");
	assert.match(assigned.title, /cancelled/i);
	assert.ok(after.some((n) => n.type === "live_session_cancelled"));
	assert.ok(after.every((n) => n.state === "cancelled"));
	// no reminder is created afterwards either
	assert.equal(repo._db.notifications.filter((n) => n.type === "live_session_reminder" && n.created_at > min(-170)).length, 0);
});

test("rescheduled sessions show the CURRENT time everywhere, with one reminder and one 'rescheduled' notice", async () => {
	const repo = setup();
	const v = await mk(repo, { studentIds: ["s1"], timeZone: "America/Toronto", time: "08:00" });
	await list(repo, "s1", new Date(v.startAt) - 0 > 0 ? new Date(new Date(v.startAt).getTime() - 3 * 3600000) : NOW); // old reminder
	const moved = await ls.rescheduleSession(repo, teacher, v.id, input({ timeZone: "America/Toronto", time: "10:00", date: "2026-10-21" }), NOW);
	await nt.notifySession(repo, "rescheduled", moved, moved.participants, ctx);
	const soon = new Date(new Date(moved.startAt).getTime() - 2 * 3600000);
	const items = await list(repo, "s1", soon);
	const reminders = items.filter((n) => n.type === "live_session_reminder");
	assert.equal(reminders.length, 1, "the reminder for the old time is superseded");
	for (const n of items) {
		assert.match(n.body, /10:00 AM/, `${n.type} shows the new local time`);
		assert.doesNotMatch(n.body, /8:00 AM/);
		assert.match(n.body, /America\/Toronto/);
	}
	// a second reschedule keeps only the latest notice visible
	const moved2 = await ls.rescheduleSession(repo, teacher, v.id, input({ timeZone: "America/Toronto", time: "11:00", date: "2026-10-21" }), NOW);
	await nt.notifySession(repo, "rescheduled", moved2, moved2.participants, ctx);
	const items2 = await list(repo, "s1", soon);
	assert.equal(items2.filter((n) => n.type === "live_session_rescheduled").length, 1);
	assert.equal(repo._db.notifications.filter((n) => n.type === "live_session_rescheduled").length, 2, "history rows are kept");
	assert.ok(items2.every((n) => /11:00 AM/.test(n.body)));
});

test("a single assignment never produces two notifications, however often it is retried or listed", async () => {
	const repo = setup();
	const v = await mk(repo, { studentIds: ["s1"] });
	for (let i = 0; i < 3; i++) await nt.notifySession(repo, "assigned", v, v.participants, ctx);
	const soon = min(-100);
	await Promise.all([1, 2, 3, 4].map(() => list(repo, "s1", soon)));
	const mine = await list(repo, "s1", soon);
	assert.deepEqual(mine.map((n) => n.type).sort(), ["live_session_assigned", "live_session_reminder"]);
});

test("other sessions' notifications and states are unaffected, and read/unread is kept", async () => {
	const repo = setup();
	const a = await mk(repo, { studentIds: ["s1"] });
	const b = await mk(repo, { studentIds: ["s1"], time: "16:00", title: "Geometry" });
	await list(repo, "s1", min(-100));
	await nt.markNotificationsRead(repo, actor("s1"), [repo._db.notifications.find((n) => n.ref_id === a.id && n.type === "live_session_assigned").id]);
	await ls.joinSession(repo, teacher, a.id, {}, min(-5));
	await ls.endSession(repo, teacher, a.id, min(5));
	const items = await list(repo, "s1", min(10));
	const ofB = items.filter((n) => n.link.includes(b.id));
	assert.deepEqual(ofB.map((n) => [n.type, n.state]).sort(), [["live_session_assigned", "upcoming"], ["live_session_reminder", "upcoming"]]);
	assert.match(ofB.find((n) => n.type === "live_session_assigned").title, /You have a live session: Geometry/);
	const aAssigned = items.find((n) => n.type === "live_session_assigned" && n.link.includes(a.id));
	assert.equal(aAssigned.read, true, "read state survives");
	const r = await nt.listNotifications(repo, actor("s1"), min(10));
	assert.equal(r.unread, r.notifications.filter((n) => !n.read).length, "the unread count only counts what is shown");
	// another student sees nothing of this
	assert.deepEqual(await list(repo, "s2", min(10)), []);
});
