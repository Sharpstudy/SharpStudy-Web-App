import test from "node:test";
import assert from "node:assert/strict";
import * as ls from "../../lib/live-sessions/service.js";
import * as nt from "../../lib/live-sessions/notify.js";
import { createSessionRepo } from "./memoryRepo.mjs";

const actor = (userId, role = "student", name = userId) => ({ userId, role, name });
const NOW = new Date("2026-10-20T10:00:00Z");
const teacher = actor("t1", "instructor", "Tia Teacher");
const teacher2 = actor("t2", "instructor", "Tom Teacher");
const START = new Date("2026-10-21T12:00:00Z");

function setup() {
	const repo = createSessionRepo();
	repo._db.courses.push({ id: "c1", slug: "math", title: "Math <101>", userId: "t1" }, { id: "c2", slug: "art", title: "Art", userId: "t2" });
	for (const u of ["s1", "s2", "s3"]) repo._db.enrolments.push({ userId: u, courseId: "c1", status: "paid" });
	repo._db.enrolments.push({ userId: "s9", courseId: "c2", status: "paid" }, { userId: "unpaid", courseId: "c1", status: "unpaid" }, { userId: "s1", courseId: "c2", status: "paid" });
	repo._db.users.push(
		{ id: "s1", name: "Ann Lee", email: "ann@example.test" },
		{ id: "s2", name: "Bo Kim", email: "bo@example.test" },
		{ id: "s3", name: "Cy Fox", email: "cy@example.test", emailConfirmed: false },
		{ id: "s9", name: "Art Kid", email: "art@example.test" }
	);
	return repo;
}
const input = (extra = {}) => ({ title: "Algebra <b>", courseId: "c1", sessionType: "group", capacity: 5, date: "2026-10-21", time: "12:00", timeZone: "UTC", durationMin: 60, ...extra });
const create = (repo, extra, who = teacher) => ls.createSession(repo, who, input(extra), NOW);

// ------------------------------------------------------------ student selection

test("eligible students: paid students of the selected course only, searchable, owner-only", async () => {
	const repo = setup();
	const all = await ls.listEligibleStudents(repo, teacher, "c1");
	assert.deepEqual(all.students.map((s) => s.id).sort(), ["s1", "s2", "s3"], "no unpaid, no other course's students");
	assert.equal(all.total, 3);
	assert.deepEqual((await ls.listEligibleStudents(repo, teacher, "c1", { q: "bo" })).students.map((s) => s.id), ["s2"]);
	assert.deepEqual((await ls.listEligibleStudents(repo, teacher, "c1", { q: "CY@" })).students.map((s) => s.id), ["s3"], "searches e-mail too");
	await assert.rejects(ls.listEligibleStudents(repo, teacher2, "c1"), { status: 403 }, "another instructor's course");
	await assert.rejects(ls.listEligibleStudents(repo, actor("s1"), "c1"), { status: 403 });
	await assert.rejects(ls.listEligibleStudents(repo, null, "c1"), { status: 401 });
	await assert.rejects(ls.listEligibleStudents(repo, teacher, "nope"), { status: 404 });
	assert.ok((await ls.listEligibleStudents(repo, actor("root", "admin"), "c1")).students.length === 3);
});

test("one-to-one needs exactly one eligible student", async () => {
	const repo = setup();
	for (const ids of [[], undefined, ["s1", "s2"]]) {
		await assert.rejects(create(repo, { sessionType: "one_to_one", studentIds: ids }), { status: 422 }, JSON.stringify(ids));
	}
	const v = await create(repo, { sessionType: "one_to_one", studentIds: ["s2"] });
	assert.equal(v.capacity, 1);
	assert.equal(v.enrollmentMode, "assigned");
	assert.deepEqual(v.participants.map((p) => p.userId), ["s2"]);
	assert.equal(repo._db.seats[0].added_by, "t1");
});

test("group: several selected students; capacity must fit; none selected stays open to the course", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1", "s2", "s2"] });
	assert.deepEqual(v.participants.map((p) => p.userId).sort(), ["s1", "s2"], "duplicates collapse");
	assert.equal(v.enrollmentMode, "assigned");
	await assert.rejects(create(repo, { time: "15:00", capacity: 2, studentIds: ["s1", "s2", "s3"] }), { status: 422 });
	const open = await create(repo, { time: "16:00" });
	assert.equal(open.enrollmentMode, "open");
	assert.equal(open.participants.length, 0);
});

test("ineligible students cannot be assigned: unpaid, other course, the instructor, unknown, malformed", async () => {
	const repo = setup();
	for (const ids of [["unpaid"], ["s9"], ["t1"], ["ghost"], ["s1", "s9"], [""], [5], "s1", [{ id: "s1" }]]) {
		await assert.rejects(create(repo, { studentIds: ids }), (e) => e.status === 422, JSON.stringify(ids));
	}
	assert.equal(repo._db.sessions.length, 0, "no session or seat is created by a rejected request");
	assert.equal(repo._db.seats.length, 0);
	await assert.rejects(create(repo, { studentIds: ["s1"] }, teacher2), { status: 403 }, "other instructor's course");
});

test("assigned sessions are private: only assigned students see, book or join; the rest of the course cannot", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1"] });
	assert.deepEqual((await ls.listSessions(repo, actor("s1"), {}, NOW)).sessions.map((s) => s.id), [v.id]);
	assert.deepEqual((await ls.listSessions(repo, actor("s2"), {}, NOW)).sessions, [], "an enrolled classmate does not see it");
	await assert.rejects(ls.getSessionDetail(repo, actor("s2"), v.id, NOW), { status: 404 });
	await assert.rejects(ls.takeSeat(repo, actor("s2"), v.id, NOW), { status: 403, code: "assigned_only" });
	await assert.rejects(ls.releaseSeat(repo, actor("s1"), v.id, NOW), { status: 403 }, "assigned students are removed by the instructor");
	const early = new Date(START.getTime() - 5 * 60000);
	assert.ok((await ls.joinSession(repo, actor("s1"), v.id, {}, early)).roomName);
	await assert.rejects(ls.joinSession(repo, actor("s2"), v.id, {}, early), { status: 403 });
	await assert.rejects(ls.joinSession(repo, actor("s9"), v.id, {}, early), { status: 403 });
});

test("assigned students stay protected by payment: losing the enrolment ends access", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1"] });
	repo._db.enrolments = repo._db.enrolments.filter((e) => !(e.userId === "s1" && e.courseId === "c1"));
	await assert.rejects(ls.joinSession(repo, actor("s1"), v.id, {}, new Date(START.getTime() - 5 * 60000)), { status: 403, code: "not_enrolled" });
});

test("no double booking: a student cannot be assigned two overlapping sessions, even by two instructors at once", async () => {
	const repo = setup();
	repo._db.enrolments.push({ userId: "s2", courseId: "c2", status: "paid" });
	await create(repo, { studentIds: ["s1"] });
	await assert.rejects(create(repo, { time: "12:30", studentIds: ["s1"] }, teacher), (e) => e.status === 409);
	const e = await ls.createSession(repo, teacher2, input({ courseId: "c2", studentIds: ["s1"], time: "12:30" }), NOW).catch((x) => x);
	assert.equal(e.status, 409);
	assert.match(e.message, /Ann Lee/);
	assert.ok(!/Algebra/.test(e.message), "does not reveal the other instructor's session");
});

test("concurrent creations for the same student: exactly one wins (student locks)", async () => {
	const repo = setup();
	repo._db.enrolments.push({ userId: "s2", courseId: "c2", status: "paid" });
	const results = await Promise.allSettled([
		ls.createSession(repo, teacher, input({ studentIds: ["s2"] }), NOW),
		ls.createSession(repo, teacher2, input({ courseId: "c2", studentIds: ["s2"], time: "12:30" }), NOW),
	]);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(repo._db.seats.length, 1);
});

test("rescheduling checks the assigned students' other sessions", async () => {
	const repo = setup();
	const a = await create(repo, { studentIds: ["s1"] });
	repo._db.enrolments.push({ userId: "s1", courseId: "c2", status: "paid" });
	await ls.createSession(repo, teacher2, input({ courseId: "c2", studentIds: ["s1"], time: "15:00" }), NOW);
	await assert.rejects(ls.rescheduleSession(repo, teacher, a.id, input({ time: "15:30" }), NOW), { status: 409, code: "overlap" });
	assert.equal((await ls.rescheduleSession(repo, teacher, a.id, input({ time: "17:00" }), NOW)).startAt, "2026-10-21T17:00:00.000Z");
});

// ---------------------------------------------------------------- notifications

const mailbox = () => {
	const sent = [];
	return { sent, mailer: async (m) => (sent.push(m), { ok: true }) };
};
const ctx = (extra = {}) => ({ instructorName: "Tia Teacher", baseUrl: "https://app.example.test/", now: NOW, ...extra });

test("assigned students get an in-app notification and e-mail with course, instructor, time, zone and an authorised link", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1", "s2"], timeZone: "America/Toronto", time: "08:00" });
	const box = mailbox();
	const r = await nt.notifySession(repo, "assigned", v, v.participants, ctx({ mailer: box.mailer }));
	assert.deepEqual([r.created, r.email.sent], [2, 2]);
	const n = repo._db.notifications.find((x) => x.user_id === "s1");
	assert.equal(n.type, "live_session_assigned");
	assert.equal(n.link, `/learning/live/${v.id}/`);
	assert.match(n.title, /Algebra/);
	assert.match(n.body, /Math/);
	assert.match(n.body, /Tia Teacher/);
	assert.match(n.body, /America\/Toronto/);
	assert.equal(n.email_status, "sent");
	assert.equal(box.sent.length, 2);
	const mail = box.sent.find((m) => m.to === "ann@example.test");
	assert.ok(mail.html.includes(`https://app.example.test/learning/live/${v.id}/`));
	assert.ok(!mail.html.includes("<b>") && mail.html.includes("&lt;b&gt;"), "titles are HTML-escaped");
	assert.ok(!mail.html.includes(v.id + "?") && !JSON.stringify(mail).includes("ss-"), "the room name is never in a notification");
});

test("only the affected participants are notified", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1"] });
	await nt.notifySession(repo, "assigned", v, v.participants, ctx({ mailer: mailbox().mailer }));
	assert.deepEqual(repo._db.notifications.map((n) => n.user_id), ["s1"]);
	const mine = await nt.listNotifications(repo, actor("s2"), NOW);
	assert.deepEqual(mine.notifications, []);
	assert.equal((await nt.listNotifications(repo, actor("s1"), NOW)).notifications.length >= 1, true);
});

test("retrying never duplicates notifications or e-mails", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1", "s2"] });
	const box = mailbox();
	await nt.notifySession(repo, "assigned", v, v.participants, ctx({ mailer: box.mailer }));
	const again = await nt.notifySession(repo, "assigned", v, v.participants, ctx({ mailer: box.mailer }));
	const both = await Promise.all([1, 2, 3].map(() => nt.notifySession(repo, "assigned", v, v.participants, ctx({ mailer: box.mailer }))));
	assert.deepEqual([again.created, again.duplicates], [0, 2]);
	assert.ok(both.every((b) => b.created === 0));
	assert.equal(repo._db.notifications.length, 2);
	assert.equal(box.sent.length, 2);
});

test("rescheduling notifies the participants once per new time; cancelling once", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1", "s2"] });
	const box = mailbox();
	await nt.notifySession(repo, "assigned", v, v.participants, ctx({ mailer: box.mailer }));
	const moved = await ls.rescheduleSession(repo, teacher, v.id, input({ time: "14:00" }), NOW);
	const r1 = await nt.notifySession(repo, "rescheduled", moved, moved.participants, ctx({ mailer: box.mailer }));
	const r2 = await nt.notifySession(repo, "rescheduled", moved, moved.participants, ctx({ mailer: box.mailer }));
	assert.deepEqual([r1.created, r2.created], [2, 0]);
	assert.match(repo._db.notifications.find((n) => n.type === "live_session_rescheduled").body, /2:00/);
	const moved2 = await ls.rescheduleSession(repo, teacher, v.id, input({ time: "16:00" }), NOW);
	assert.equal((await nt.notifySession(repo, "rescheduled", moved2, moved2.participants, ctx({ mailer: box.mailer }))).created, 2, "another new time is news again");
	const cancelled = await ls.cancelSession(repo, teacher, v.id, NOW);
	const c1 = await nt.notifySession(repo, "cancelled", cancelled, cancelled.participants, ctx({ mailer: box.mailer }));
	const again = await ls.cancelSession(repo, teacher, v.id, NOW); // the instructor retries
	const c2 = await nt.notifySession(repo, "cancelled", again, again.participants, ctx({ mailer: box.mailer }));
	assert.deepEqual([c1.created, c2.created], [2, 0]);
	const sub = box.sent.filter((m) => /cancelled/i.test(m.subject));
	assert.equal(sub.length, 2);
	assert.ok(!sub[0].html.includes("Open session"), "a cancelled session has no join button");
});

test("a failing e-mail never undoes the saved session or the in-app notification", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1", "s2"] });
	const mailers = [
		async () => ({ ok: false, error: "smtp down" }),
		async () => {
			throw new Error("boom");
		},
		async () => ({ ok: false, skipped: true, error: "not configured" }),
	];
	for (const [i, mailer] of mailers.entries()) {
		const fresh = setup();
		const sv = await create(fresh, { studentIds: ["s1", "s2"] });
		const r = await nt.notifySession(fresh, "assigned", sv, sv.participants, ctx({ mailer }));
		assert.equal(r.created, 2, `mailer ${i}: in-app notifications are saved`);
		assert.equal(fresh._db.sessions.length, 1, "the session is still saved");
		assert.equal(fresh._db.seats.length, 2);
	}
	const r = await nt.notifySession(repo, "assigned", v, v.participants, ctx({ mailer: mailers[0] }));
	assert.equal(r.email.failed, 2);
	assert.ok(repo._db.notifications.every((n) => n.email_status === "failed"));
	assert.equal(repo._db.sessions.length, 1);
});

test("a broken repository cannot make notifying throw", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1"] });
	repo.insertNotification = async () => {
		throw new Error("db down");
	};
	const r = await nt.notifySession(repo, "assigned", v, v.participants, ctx({ mailer: mailbox().mailer }));
	assert.equal(r.errors, 1);
	assert.equal(repo._db.sessions.length, 1);
});

test("e-mail respects verification and configuration: unconfirmed addresses and no mailer are skipped, in-app still works", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1", "s3"] });
	const box = mailbox();
	const r = await nt.notifySession(repo, "assigned", v, v.participants, ctx({ mailer: box.mailer }));
	assert.deepEqual([r.created, r.email.sent, r.email.skipped], [2, 1, 1]);
	assert.deepEqual(box.sent.map((m) => m.to), ["ann@example.test"]);
	const repo2 = setup();
	const v2 = await create(repo2, { studentIds: ["s1"] });
	const r2 = await nt.notifySession(repo2, "assigned", v2, v2.participants, ctx({ mailer: null }));
	assert.deepEqual([r2.created, r2.email.skipped], [1, 1]);
});

test("students list only their own notifications; mark read; approaching sessions get one reminder", async () => {
	const repo = setup();
	const v = await create(repo, { studentIds: ["s1"] });
	await nt.notifySession(repo, "assigned", v, v.participants, ctx());
	const far = await nt.listNotifications(repo, actor("s1"), NOW);
	assert.deepEqual(far.notifications.map((n) => n.type), ["live_session_assigned"], "more than 24h away: no reminder yet");
	const soon = new Date(START.getTime() - 3 * 3600000);
	const l1 = await nt.listNotifications(repo, actor("s1"), soon);
	const l2 = await nt.listNotifications(repo, actor("s1"), new Date(soon.getTime() + 60000));
	assert.equal(l1.notifications.filter((n) => n.type === "live_session_reminder").length, 1);
	assert.equal(l2.notifications.filter((n) => n.type === "live_session_reminder").length, 1, "reminders do not repeat");
	assert.equal(l2.unread, 2);
	assert.deepEqual((await nt.listNotifications(repo, actor("s2"), soon)).notifications, [], "someone else's notices are never shown");
	await nt.markNotificationsRead(repo, actor("s2"), null);
	assert.equal((await nt.listNotifications(repo, actor("s1"), soon)).unread, 2, "another user cannot mark mine read");
	assert.equal((await nt.markNotificationsRead(repo, actor("s1"), null)).unread, 0);
	assert.equal((await nt.listNotifications(repo, null)).status, 401);
	// a cancelled session no longer produces reminders
	await ls.cancelSession(repo, teacher, v.id, NOW);
	repo._db.notifications = [];
	assert.equal((await nt.listNotifications(repo, actor("s1"), soon)).notifications.length, 0);
});
