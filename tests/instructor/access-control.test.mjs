// Instructor <-> student access control (tests A-J of the access audit).
// All fixtures are in-memory repositories: nothing here touches a real database.
//
// Relationship rules under test (pre-existing, plus the gaps closed by the audit):
//   an instructor reaches a student only through (1) a PAID enrolment in a course they OWN,
//   (2) a learner profile they own, or (3) an explicit instructor link on the profile.
//   A parent/guardian link is family access, never a teaching relationship.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createMemoryRepo } from "../mastery/memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import * as asg from "../../lib/mastery/assignments.js";
import { studentDirectory } from "../../lib/mastery/directory.js";
import { createStudentProfile, linkStudentProfile, unlinkStudentProfile } from "../../lib/mastery/studentLinks.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import * as ls from "../../lib/live-sessions/service.js";
import * as lq from "../../lib/live-questions/service.js";
import { createSessionRepo } from "../live-sessions/memoryRepo.mjs";
import { createLiveRepo } from "../live-questions/memoryRepo.mjs";

const T = Date.parse("2026-10-14T15:00:00Z");
const WS = { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 };
const acct = (userId, role = "student", extra = []) => ({ kind: "account", userId, role, name: userId, permissions: resolvePermissions(role, extra) });
const dir = (repo, who, f = {}) => studentDirectory(repo, who, f, { now: T });
const enrol = (repo, userId, courseId, status = "paid") => repo._db.courseEnrolments.push({ userId, courseId, status, created_at: new Date(T).toISOString() });
const rawLearner = (repo, id) => repo._db.learners.find((l) => l.id === id);

// Instructor A teaches Student 1 and 2, instructor B teaches Student 3.
async function world() {
	const repo = createMemoryRepo();
	const u = (id, role = "student") => ({ id, email: `${id}@example.com`, role, first_name: id, last_name: "X" });
	repo._db.users.push(u("inst-a", "instructor"), u("inst-b", "instructor"), u("s1"), u("s2"), u("s3"), u("s-unpaid"), u("fam"));
	repo._db.courses = [
		{ id: "course-a", title: "A maths", userId: "inst-a" },
		{ id: "course-b", title: "B maths", userId: "inst-b" },
	];
	repo._db.courseEnrolments = [];
	repo._db.lessons = {};
	repo._db.lessonsDone = {};
	enrol(repo, "s1", "course-a");
	enrol(repo, "s2", "course-a");
	enrol(repo, "s3", "course-b");
	enrol(repo, "s-unpaid", "course-a", "unpaid");
	const A = acct("inst-a", "instructor");
	const B = acct("inst-b", "instructor");
	const base = { pin: "1234", subjects: ["math"], timeZone: "UTC", grade: "C4" };
	const p1 = (await createStudentProfile(repo, A, { ...base, studentUserId: "s1" })).learnerId;
	const p2 = (await createStudentProfile(repo, A, { ...base, studentUserId: "s2" })).learnerId;
	const p3 = (await createStudentProfile(repo, B, { ...base, studentUserId: "s3" })).learnerId;
	return { repo, A, B, p1, p2, p3, S1: acct("s1"), S2: acct("s2"), fam: acct("fam", "student", ["learners.create"]) };
}
const familyKid = (repo, fam, name = "Kid") => svc.createLearner(repo, fam, { displayName: name, pin: "1234", subjects: ["math"], timeZone: "UTC" });

// ---------------------------------------------------------------- A, B

test("A: an instructor reaches exactly the students they teach and can teach them", async () => {
	const { repo, A, p1, p2 } = await world();
	assert.deepEqual((await dir(repo, A)).students.map((s) => s.userId).sort(), ["s1", "s2"]);
	assert.equal((await svc.learnerDashboard(repo, A, p1, { now: T })).learner.id, p1);
	const r = await asg.createAssignment(repo, A, { ...WS, learnerIds: [p1, p2] }, { now: T });
	assert.equal(r.students.length, 2);
});

test("B: an unrelated student (Student 3) is invisible and unreachable for instructor A", async () => {
	const { repo, A, p3 } = await world();
	const d = await dir(repo, A);
	assert.ok(!d.students.some((s) => s.userId === "s3" || s.learnerId === p3), "not listed");
	assert.equal(d.summary.total, 2, "not counted");
	assert.ok(!JSON.stringify(d).includes("s3@example.com"), "not leaked in the payload");
	await assert.rejects(svc.learnerDashboard(repo, A, p3, { now: T }), { status: 404 });
	await assert.rejects(asg.createAssignment(repo, A, { ...WS, learnerIds: [p3] }, { now: T }), { status: 403 });
	await assert.rejects(asg.createAssignment(repo, A, { ...WS, learnerIds: [p3, "no-such-learner"] }, { now: T }), { status: 403 });
	await assert.rejects(svc.setEnrolment(repo, A, p3, "math", false, {}), { status: 404 });
	assert.equal(repo._db.assignments.length, 0);
});

// ---------------------------------------------------------------- C, D, H

test("C/H: cross-instructor isolation of students, learners, assignments and grading data", async () => {
	const { repo, A, B, p1, p3 } = await world();
	const mine = await asg.createAssignment(repo, A, { ...WS, learnerIds: [p1] }, { now: T });
	// B cannot read, change or cancel A's assignment: it is indistinguishable from a missing one.
	await assert.rejects(asg.updateAssignment(repo, B, mine.assignmentId, { cancel: true }, { now: T }), { status: 404 });
	await assert.rejects(asg.updateAssignment(repo, B, mine.assignmentId, { instructions: "x" }, { now: T }), { status: 404 });
	assert.equal(repo._db.assignments.find((a) => a.id === mine.assignmentId).status, "active");
	// ... nor see it through their own learner views.
	assert.ok(!JSON.stringify(await asg.learnerOverview(repo, B, {}, { now: T })).includes(p1));
	await assert.rejects(svc.learnerDashboard(repo, B, p1, { now: T }), { status: 404 });
	// B cannot use A's course as a filter or as an assignment course link.
	await assert.rejects(dir(repo, B, { courseId: "course-a" }), { status: 403 });
	await assert.rejects(asg.createAssignment(repo, B, { ...WS, learnerIds: [p3], courseId: "course-a" }, { now: T }), { status: 403 });
});

test("D: swapping student, learner, assignment, course or session ids never widens access", async () => {
	const { repo, A, p1, p3 } = await world();
	for (const bad of [p3, "s3", "../" + p3, p3.toUpperCase(), " " + p3, "", null, 42, { id: p3 }]) {
		await assert.rejects(svc.learnerDashboard(repo, A, bad, { now: T }), (e) => [400, 404].includes(e.status), String(bad));
	}
	// a learner id is not a student user id, and a student the instructor does not teach cannot be profiled
	await assert.rejects(createStudentProfile(repo, A, { studentUserId: p1, pin: "1234" }), { status: 404 });
	await assert.rejects(createStudentProfile(repo, A, { studentUserId: "s3", pin: "1234", subjects: ["math"] }), { status: 404 });
	await assert.rejects(asg.updateAssignment(repo, A, "not-an-assignment", { cancel: true }, { now: T }), { status: 404 });
	// the instructor id in a body is ignored: the assignment is always created by the caller
	const r = await asg.createAssignment(repo, A, { ...WS, learnerIds: [p1], created_by: "inst-b", instructorId: "inst-b" }, { now: T });
	assert.equal(repo._db.assignments.find((a) => a.id === r.assignmentId).created_by, "inst-a");
});

// ---------------------------------------------------------------- E

test("E: a student sees only their own linked profile, read-only, never another student's", async () => {
	const { repo, S1, S2, p1, p2 } = await world();
	assert.deepEqual((await svc.listLearners(repo, S1)).map((l) => l.id), [p1]);
	assert.equal((await svc.learnerDashboard(repo, S1, p1, { now: T })).learner.id, p1);
	await assert.rejects(svc.learnerDashboard(repo, S1, p2, { now: T }), { status: 404 });
	await assert.rejects(svc.updateLearner(repo, S1, p2, { displayName: "hacked" }), { status: 404 });
	await assert.rejects(svc.resetPin(repo, S1, p2, "9999", {}), { status: 404 });
	// even their own profile is read-only for an account student
	await assert.rejects(svc.updateLearner(repo, S1, p1, { displayName: "renamed" }), { status: 403 });
	await assert.rejects(svc.resetPin(repo, S1, p1, "9999", {}), { status: 403 });
	assert.deepEqual((await svc.listLearners(repo, S2)).map((l) => l.id), [p2]);
});

// ---------------------------------------------------------------- F

test("F: enrolment grants access only when it is PAID and in a course the instructor owns", async () => {
	const { repo, A, B } = await world();
	assert.ok(!(await dir(repo, A)).students.some((s) => s.userId === "s-unpaid"), "unpaid enrolment");
	await assert.rejects(createStudentProfile(repo, A, { studentUserId: "s-unpaid", pin: "1234", subjects: ["math"] }), { status: 404 });
	// enrolling in the OTHER instructor's course gives A nothing
	await assert.rejects(createStudentProfile(repo, A, { studentUserId: "s3", pin: "1234", subjects: ["math"] }), { status: 404 });
	enrol(repo, "s3", "course-a"); // now genuinely a paid student of A as well
	assert.ok((await dir(repo, A)).students.some((s) => s.userId === "s3"));
	assert.ok((await dir(repo, B)).students.some((s) => s.userId === "s3"));
	// ... and the access ends with the enrolment
	repo._db.courseEnrolments = repo._db.courseEnrolments.filter((e) => !(e.userId === "s3" && e.courseId === "course-a"));
	assert.ok(!(await dir(repo, A)).students.some((s) => s.userId === "s3"));
});

test("F: one instructor cannot link or unlink another instructor's student relationship", async () => {
	const { repo, A, B, p1, p3, fam } = await world();
	// B cannot unlink A's student, nor link their own student to A's profile
	await assert.rejects(unlinkStudentProfile(repo, B, { learnerId: p1 }), { status: 404 });
	await assert.rejects(linkStudentProfile(repo, B, { studentUserId: "s3", learnerId: p1, confirm: true }), { status: 404 });
	assert.equal(rawLearner(repo, p1).student_user_id, "s1");
	// A cannot link their student to B's profile
	await assert.rejects(linkStudentProfile(repo, A, { studentUserId: "s1", learnerId: p3, confirm: true }), { status: 404 });

	// A family child that A is only LINKED to as an instructor
	const kid = await familyKid(repo, fam);
	await svc.addGuardian(repo, fam, kid.id, "inst-a@example.com", "instructor");
	// ... linked to a student A teaches: A may remove that link
	rawLearner(repo, kid.id).student_user_id = "s2";
	assert.equal((await unlinkStudentProfile(repo, A, { learnerId: kid.id })).unlinked, true);
	// ... linked to a student A does NOT teach: A may not remove it
	rawLearner(repo, kid.id).student_user_id = "s3";
	await assert.rejects(unlinkStudentProfile(repo, A, { learnerId: kid.id }), { status: 403 });
	assert.equal(rawLearner(repo, kid.id).student_user_id, "s3");
	// ... and a merely linked instructor cannot hand the family's child to a student they teach
	rawLearner(repo, kid.id).student_user_id = null;
	await assert.rejects(linkStudentProfile(repo, A, { studentUserId: "s-unpaid", learnerId: kid.id, confirm: true }), { status: 404 });
	enrol(repo, "s-unpaid", "course-a"); // a second paid row makes them A's student
	await assert.rejects(linkStudentProfile(repo, A, { studentUserId: "s-unpaid", learnerId: kid.id, confirm: true }), { status: 403 });
	assert.equal(rawLearner(repo, kid.id).student_user_id, null);
	// the family (owner) can still do it
	assert.equal(rawLearner(repo, kid.id).owner_user_id, "fam");
});

test("F: a parent/guardian link is family access, not a teaching relationship", async () => {
	const { repo, A, fam } = await world();
	const kid = await familyKid(repo, fam);
	// an instructor account that is the child's PARENT may not assign teacher work to it
	await svc.addGuardian(repo, fam, kid.id, "inst-a@example.com", "parent");
	await assert.rejects(asg.createAssignment(repo, A, { ...WS, learnerIds: [kid.id] }, { now: T }), { status: 403 });
	// the explicit instructor link is what authorises teaching
	await svc.removeGuardian(repo, fam, kid.id, "inst-a");
	await svc.addGuardian(repo, fam, kid.id, "inst-a@example.com", "instructor");
	assert.equal((await asg.createAssignment(repo, A, { ...WS, learnerIds: [kid.id] }, { now: T })).students.length, 1);
});

// ---------------------------------------------------------------- G

test("G: directory, dashboard and live-question rosters apply the same PAID, owned-course rule", async () => {
	const { repo, A } = await world();
	const d = await dir(repo, A);
	assert.equal(d.total, d.summary.total);
	const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
	const dashboard = read("../../pages/api/instructor/dashboard.js");
	assert.match(dashboard, /Enrolment\.count\(\{ where: \{ courseId: ids, status: "paid" \}/, "dashboard count is paid-only");
	assert.match(dashboard, /Enrolment\.findAll\(\{ where: \{ courseId: ids, status: "paid" \}/, "recent enrolments are paid-only");
	const lqRepo = read("../../lib/live-questions/repo.js");
	assert.match(lqRepo, /userId, courseId, status: "paid"/, "course-class membership is paid-only");
	assert.match(lqRepo, /where: \{ courseId, status: "paid" \}/, "course-class roster is paid-only");
	// the React directory only calls the API: it does no relationship filtering of its own
	assert.ok(!/enrolments\.filter|learners\.filter\(/.test(read("../../components/Instructor/StudentDirectory.js")));
});

// ---------------------------------------------------------------- I (live sessions)

function liveWorld() {
	const repo = createSessionRepo();
	repo._db.courses.push({ id: "c1", slug: "math", title: "Math", userId: "ta" }, { id: "c2", slug: "art", title: "Art", userId: "tb" });
	for (const u of ["s1", "s2"]) repo._db.enrolments.push({ userId: u, courseId: "c1", status: "paid" });
	repo._db.enrolments.push({ userId: "s3", courseId: "c2", status: "paid" }, { userId: "unpaid", courseId: "c1", status: "unpaid" });
	return repo;
}
const who = (userId, role = "student") => ({ userId, role, name: userId });
const NOW = new Date("2026-10-20T10:00:00Z");
const form = (extra = {}) => ({ title: "Algebra", courseId: "c1", sessionType: "group", capacity: 5, date: "2026-10-21", time: "12:00", timeZone: "UTC", durationMin: 60, ...extra });
const DURING = new Date("2026-10-21T12:05:00Z");

test("I: instructors manage only their own sessions and assign only paid students of their own course", async () => {
	const repo = liveWorld();
	const ta = who("ta", "instructor");
	const tb = who("tb", "instructor");
	await assert.rejects(ls.createSession(repo, tb, form(), NOW), { status: 403 }, "B cannot schedule in A's course");
	await assert.rejects(ls.createSession(repo, ta, form({ studentIds: ["s3"] }), NOW), { status: 422 }, "another course's student");
	await assert.rejects(ls.createSession(repo, ta, form({ studentIds: ["unpaid"] }), NOW), { status: 422 }, "unpaid student");
	await assert.rejects(ls.listEligibleStudents(repo, tb, "c1"), { status: 403 });
	const s = await ls.createSession(repo, ta, form({ studentIds: ["s1"] }), NOW);
	for (const fn of [() => ls.cancelSession(repo, tb, s.id, NOW), () => ls.endSession(repo, tb, s.id, NOW), () => ls.rescheduleSession(repo, tb, s.id, form({ time: "15:00" }), NOW)]) {
		await assert.rejects(fn(), { status: 404 });
	}
	assert.equal((await ls.listSessions(repo, tb, { scope: "teaching" }, NOW)).sessions.length, 0);
});

test("I: students cannot join, list or read a session by guessing its id", async () => {
	const repo = liveWorld();
	const ta = who("ta", "instructor");
	const s = await ls.createSession(repo, ta, form({ sessionType: "one_to_one", capacity: 1, studentIds: ["s1"] }), NOW);
	// s2 is paid in the course but was not assigned; s3 and unpaid have no business here
	for (const id of ["s2", "s3", "unpaid", "nobody"]) {
		await assert.rejects(ls.joinSession(repo, who(id), s.id, {}, DURING), (e) => [403, 404].includes(e.status), id);
		await assert.rejects(ls.getSessionDetail(repo, who(id), s.id, DURING), { status: 404 }, id);
		await assert.rejects(ls.getAttendance(repo, who(id), s.id, DURING), { status: 404 }, id);
		await assert.rejects(ls.takeSeat(repo, who(id), s.id, DURING), (e) => [403, 409].includes(e.status), id);
		assert.ok(!(await ls.listSessions(repo, who(id), {}, DURING)).sessions.some((x) => x.id === s.id), `${id} list`);
	}
	await assert.rejects(ls.joinSession(repo, who("s2"), "0000-not-a-session", {}, DURING), { status: 404 });
	assert.ok((await ls.joinSession(repo, who("s1"), s.id, {}, DURING)).roomName);
	// a student can never run the session, and the other instructor cannot enter it
	await assert.rejects(ls.endSession(repo, who("s1"), s.id, DURING), { status: 403 });
	await assert.rejects(ls.cancelSession(repo, who("s1"), s.id, NOW), { status: 403 });
	await assert.rejects(ls.getAttendance(repo, who("tb", "instructor"), s.id, DURING), { status: 404 });
	await assert.rejects(ls.joinSession(repo, who("tb", "instructor"), s.id, {}, DURING), (e) => [403, 404].includes(e.status));
});

function liveQuestionWorld() {
	const repo = createLiveRepo();
	repo._db.courses.push({ id: "c1", slug: "math-live", title: "Math", userId: "ta" });
	repo._db.users.push({ id: "s1", name: "Ann" }, { id: "s2", name: "Bo" }, { id: "un", name: "Unpaid" });
	repo._db.enrolments.push({ userId: "s1", courseId: "c1", status: "paid" }, { userId: "s2", courseId: "c1", status: "paid" }, { userId: "un", courseId: "c1", status: "unpaid" });
	const SA = "11111111-1111-4111-8111-111111111111";
	repo._db.sessions.push({ id: SA, course_id: "c1", instructor_id: "ta", status: "live" });
	repo._db.seats.push({ class_id: SA, participant_key: "u:s1", user_id: "s1", display_name: "Ann" });
	return { repo, SA };
}
const T0 = new Date("2026-10-21T12:00:00Z");

test("I: live questions are limited to the owning instructor and seat-holding paid students", async () => {
	const { repo, SA } = liveQuestionWorld();
	const ta = who("ta", "instructor");
	const tb = who("tb", "instructor");
	const q = await lq.createQuestion(repo, ta, SA, { text: "2+2?", options: ["3", "4"], correctIndex: 1, publish: true }, T0);
	await assert.rejects(lq.createQuestion(repo, tb, SA, { text: "x", options: ["a", "b"], correctIndex: 0 }, T0), { status: 404 });
	await assert.rejects(lq.getState(repo, tb, SA, T0), { status: 404 });
	await assert.rejects(lq.listResults(repo, tb, SA, T0), { status: 404 });
	// s2 is paid in the course but holds no seat in this session
	await assert.rejects(lq.getState(repo, who("s2"), SA, T0), { status: 404 });
	await assert.rejects(lq.submitAnswer(repo, who("s2"), SA, q.id, "o2", T0), { status: 404 });
	await assert.rejects(lq.myResults(repo, who("s2"), SA), { status: 404 });
	assert.equal((await lq.getState(repo, who("s1"), SA, T0)).current.id, q.id);
	await assert.rejects(lq.closeQuestion(repo, who("s1"), SA, q.id, T0), { status: 403 });
	await assert.rejects(lq.revealQuestion(repo, who("s1"), SA, q.id, T0), { status: 403 });
});

test("F/I: an unpaid enrolment gives no access to a course-level class or its roster", async () => {
	const { repo } = liveQuestionWorld();
	const ta = who("ta", "instructor");
	await assert.rejects(lq.getState(repo, who("un"), "math-live", T0), { status: 403 });
	assert.equal((await lq.getState(repo, who("s1"), "math-live", T0)).role, "student");
	const q = await lq.createQuestion(repo, ta, "math-live", { text: "2+2?", options: ["3", "4"], correctIndex: 1, publish: true }, T0);
	assert.equal(q.totals.enrolled, 2, "the roster counts paid students only");
});

// ---------------------------------------------------------------- J

test("J: students, families and signed-out callers cannot use instructor-only operations", async () => {
	const { repo, S1, fam, p1 } = await world();
	for (const caller of [S1, fam, null]) {
		const status = caller ? 403 : 401;
		await assert.rejects(dir(repo, caller), { status });
		await assert.rejects(asg.createAssignment(repo, caller, { ...WS, learnerIds: [p1] }, { now: T }), { status });
		await assert.rejects(asg.updateAssignment(repo, caller, "x", { cancel: true }, { now: T }), { status });
		await assert.rejects(createStudentProfile(repo, caller, { studentUserId: "s2", pin: "1234" }), { status });
		await assert.rejects(unlinkStudentProfile(repo, caller, { learnerId: p1 }), { status });
	}
	const live = liveWorld();
	for (const caller of [who("s1"), null]) {
		const status = caller ? 403 : 401;
		await assert.rejects(ls.createSession(live, caller, form(), NOW), { status });
		await assert.rejects(ls.listSessions(live, caller, { scope: "teaching" }, NOW), { status });
		await assert.rejects(ls.listEligibleStudents(live, caller, "c1"), { status });
	}
});

test("J: the instructor API routes verify the role on the server and ignore client-supplied identities", () => {
	const read = (f) => fs.readFileSync(new URL(`../../pages/api/${f}`, import.meta.url), "utf8");
	for (const f of ["instructor/students.js", "instructor/students/link.js", "instructor/dashboard.js"]) {
		assert.match(read(f), /requireRole\(req, res, \["instructor", "admin"\]\)/, f);
	}
	assert.match(read("students/index.js"), /actor\.role !== "admin"/);
	for (const f of ["instructor/students.js", "instructor/students/link.js", "mastery/assignments/index.js", "live-sessions/index.js"]) {
		assert.ok(!/req\.(query|body)\.(instructorId|userId)/.test(read(f)), f);
	}
});
