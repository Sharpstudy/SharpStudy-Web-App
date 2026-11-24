// The instructor student directory and the safe account-student <-> learner-profile bridge.
import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createMemoryRepo } from "./memoryRepo.mjs";
import { createSessionRepo } from "../live-sessions/memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import * as asg from "../../lib/mastery/assignments.js";
import { studentDirectory, PAGE_SIZE } from "../../lib/mastery/directory.js";
import { createStudentProfile, linkStudentProfile, unlinkStudentProfile } from "../../lib/mastery/studentLinks.js";
import { notifyAssignment } from "../../lib/mastery/assignmentNotify.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { verifyLearnerToken } from "../../lib/mastery/tokens.js";

const account = (userId, role = "student", extra = []) => ({ kind: "account", userId, role, name: userId, permissions: resolvePermissions(role, extra) });
const T = Date.parse("2026-10-14T15:00:00Z");
const DAY = 86400000;
const WS = { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 };
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);

async function setup() {
	const repo = createMemoryRepo();
	const u = (id, first, last, role = "student") => ({ id, email: `${id}@example.com`, role, first_name: first, last_name: last });
	repo._db.users.push(
		u("inst-1", "Ines", "One", "instructor"),
		u("inst-2", "Ivo", "Two", "instructor"),
		u("stu-a", "Ann", "Lee"),
		u("stu-b", "Bo", "Kim"),
		u("stu-c", "Cy", "Fox"),
		u("stu-d", "Di", "Unpaid"),
		u("stu-twin", "Ann", "Lee") // same NAME as stu-a, different person
	);
	repo._db.courses = [
		{ id: "c1", title: "Maths A", userId: "inst-1" },
		{ id: "c2", title: "Maths B", userId: "inst-1" },
		{ id: "c3", title: "Art", userId: "inst-2" },
	];
	const e = (userId, courseId, status = "paid") => ({ userId, courseId, status, created_at: new Date(T).toISOString() });
	repo._db.courseEnrolments = [e("stu-a", "c1"), e("stu-a", "c2"), e("stu-b", "c1"), e("stu-c", "c3"), e("stu-d", "c1", "unpaid"), e("stu-twin", "c3")];
	repo._db.lessons = { c1: 4, c2: 2, c3: 3 };
	repo._db.lessonsDone = { "stu-a|c1": 3, "stu-b|c1": 1 };
	return { repo, inst1: account("inst-1", "instructor"), inst2: account("inst-2", "instructor"), student: (id) => account(id) };
}
const dir = (repo, who, f = {}) => studentDirectory(repo, who, f, { now: T });
const mkProfile = (repo, who, student, extra = {}) =>
	createStudentProfile(repo, who, { studentUserId: student, pin: "1234", subjects: ["math"], dailyGoal: 2, timeZone: "UTC", grade: "C3", age: 8, ...extra }, { now: T });

// ------------------------------------------------------------------ directory

test("a student in several courses appears once, with all their courses and lesson progress; unpaid enrolments are hidden", async () => {
	const { repo, inst1 } = await setup();
	const d = await dir(repo, inst1);
	assert.deepEqual(d.students.map((s) => s.name), ["Ann Lee", "Bo Kim"]);
	const ann = d.students.find((s) => s.userId === "stu-a");
	assert.deepEqual(ann.courses.map((c) => [c.title, c.lessons, c.completed]), [["Maths A", 4, 3], ["Maths B", 2, 0]]);
	assert.equal(ann.email, "stu-a@example.com");
	assert.equal(d.summary.total, 2);
	assert.ok(!d.students.some((s) => s.userId === "stu-d"), "unpaid");
	assert.ok(!JSON.stringify(d).match(/pin_hash|password/i));
});

test("course filter, search by name or e-mail, and pagination", async () => {
	const { repo, inst1 } = await setup();
	assert.deepEqual((await dir(repo, inst1, { courseId: "c2" })).students.map((s) => s.userId), ["stu-a"]);
	assert.deepEqual((await dir(repo, inst1, { courseId: "c1" })).students.map((s) => s.userId).sort(), ["stu-a", "stu-b"]);
	await assert.rejects(dir(repo, inst1, { courseId: "c3" }), { status: 403 }, "someone else's course");
	assert.deepEqual((await dir(repo, inst1, { q: "kim" })).students.map((s) => s.userId), ["stu-b"]);
	assert.deepEqual((await dir(repo, inst1, { q: "STU-A@" })).students.map((s) => s.userId), ["stu-a"]);
	assert.deepEqual((await dir(repo, inst1, { q: "nobody" })).students, []);
	// many students
	for (let i = 0; i < 45; i++) {
		repo._db.users.push({ id: `bulk-${i}`, email: `bulk${i}@example.com`, role: "student", first_name: "Bulk", last_name: String(100 + i) });
		repo._db.courseEnrolments.push({ userId: `bulk-${i}`, courseId: "c1", status: "paid", created_at: new Date(T).toISOString() });
	}
	const p1 = await dir(repo, inst1, { page: 1 });
	const p3 = await dir(repo, inst1, { page: 3 });
	assert.deepEqual([p1.students.length, p1.pages, p1.total, p1.pageSize], [PAGE_SIZE, 3, 47, PAGE_SIZE]);
	assert.equal(p3.students.length, 7);
	const all = [...(await dir(repo, inst1, { page: 1 })).students, ...(await dir(repo, inst1, { page: 2 })).students, ...p3.students].map((s) => s.key);
	assert.equal(new Set(all).size, 47, "no student repeats across pages");
	assert.equal((await dir(repo, inst1, { page: 99 })).page, 3, "an out-of-range page is clamped");
});

test("an instructor sees only their own students, never another instructor's", async () => {
	const { repo, inst1, inst2 } = await setup();
	assert.deepEqual((await dir(repo, inst2)).students.map((s) => s.userId).sort(), ["stu-c", "stu-twin"]);
	assert.ok(!(await dir(repo, inst1)).students.some((s) => ["stu-c", "stu-twin"].includes(s.userId)));
	await assert.rejects(dir(repo, account("stu-a")), { status: 403 });
	await assert.rejects(dir(repo, null), { status: 401 });
});

test("students without a profile are labelled, not given invented progress", async () => {
	const { repo, inst1 } = await setup();
	const d = await dir(repo, inst1);
	for (const s of d.students) {
		assert.equal(s.profileState, "needs_profile");
		assert.equal(s.canAssign, false);
		assert.deepEqual([s.status, s.grade, s.age, s.subjects, s.lastActivityAt], ["no_profile", null, null, [], null], "missing grade/age/progress stay empty");
		assert.deepEqual(s.counts, { assigned: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 });
	}
	assert.equal(d.summary.needProfile, 2);
	assert.deepEqual([d.summary.activeLearners, d.summary.openAssignments, d.summary.completedAssignments], [0, 0, 0]);
});

// ------------------------------------------------------------------ the bridge

test("creating a profile for a course student: only for students you teach, validated, once", async () => {
	const { repo, inst1, inst2 } = await setup();
	await assert.rejects(mkProfile(repo, inst1, "stu-c"), { status: 404 }, "a student of another instructor");
	await assert.rejects(mkProfile(repo, inst1, "stu-d"), { status: 404 }, "unpaid");
	await assert.rejects(mkProfile(repo, inst1, "ghost"), { status: 404 });
	await assert.rejects(mkProfile(repo, account("stu-a"), "stu-a"), { status: 403 });
	await assert.rejects(mkProfile(repo, null, "stu-a"), { status: 401 });
	await assert.rejects(mkProfile(repo, inst1, "stu-a", { pin: "12" }), { status: 422 });
	await assert.rejects(mkProfile(repo, inst1, "stu-a", { grade: "C9" }), { status: 422 });
	assert.equal(repo._db.learners.length, 0, "failed requests leave nothing behind");
	const made = await mkProfile(repo, inst1, "stu-a", { subjects: ["math"] });
	assert.equal(made.learner.displayName, "Ann Lee");
	assert.equal(repo._db.learners[0].student_user_id, "stu-a");
	assert.equal(repo._db.learners[0].owner_user_id, "inst-1", "owned and managed by the instructor");
	await assert.rejects(mkProfile(repo, inst1, "stu-a"), { status: 409 }, "one profile per student");
	assert.ok(inst2);
});

test("the directory then shows the linked profile (grade, age, subjects) on the SAME row; the same-named student stays separate", async () => {
	const { repo, inst1, inst2 } = await setup();
	await mkProfile(repo, inst1, "stu-a");
	await mkProfile(repo, inst2, "stu-twin", { grade: "C5", age: 10 });
	const ann = (await dir(repo, inst1)).students.find((s) => s.userId === "stu-a");
	assert.deepEqual([ann.profileState, ann.gradeLabel, ann.age, ann.subjects, ann.canAssign, ann.type], ["linked", "Class 3", 8, ["math"], true, "account"]);
	assert.equal((await dir(repo, inst1)).students.filter((s) => s.name === "Ann Lee").length, 1, "still one Ann Lee");
	const twin = (await dir(repo, inst2)).students.find((s) => s.userId === "stu-twin");
	assert.equal(twin.gradeLabel, "Class 5", "the twin's own profile, not Ann's");
	assert.notEqual(twin.learnerId, ann.learnerId);
	assert.ok(!(await dir(repo, inst2)).students.some((s) => s.learnerId === ann.learnerId));
});

test("linking an existing profile needs explicit confirmation and authority over BOTH sides; nothing links by name", async () => {
	const { repo, inst1, inst2 } = await setup();
	const mia = await svc.createLearner(repo, inst1, { displayName: "Ann Lee", pin: "1234", subjects: ["math"], timeZone: "UTC" }); // same name as the student
	const other = await svc.createLearner(repo, inst2, { displayName: "Theirs", pin: "1234", subjects: ["math"], timeZone: "UTC" });
	assert.equal((await dir(repo, inst1)).students.find((s) => s.userId === "stu-a").profileState, "needs_profile", "a matching name links nothing");
	await assert.rejects(linkStudentProfile(repo, inst1, { studentUserId: "stu-a", learnerId: mia.id }), { code: "confirm_required" });
	await assert.rejects(linkStudentProfile(repo, inst1, { studentUserId: "stu-a", learnerId: mia.id, confirm: "yes" }), { code: "confirm_required" });
	await assert.rejects(linkStudentProfile(repo, inst1, { studentUserId: "stu-a", learnerId: other.id, confirm: true }), { status: 404 }, "a learner you do not manage");
	await assert.rejects(linkStudentProfile(repo, inst1, { studentUserId: "stu-c", learnerId: mia.id, confirm: true }), { status: 404 }, "a student you do not teach");
	await assert.rejects(linkStudentProfile(repo, inst2, { studentUserId: "stu-a", learnerId: other.id, confirm: true }), { status: 404 });
	assert.ok(repo._db.learners.every((l) => !l.student_user_id));
	const ok = await linkStudentProfile(repo, inst1, { studentUserId: "stu-a", learnerId: mia.id, confirm: true });
	assert.equal(ok.learnerId, mia.id);
	await assert.rejects(linkStudentProfile(repo, inst1, { studentUserId: "stu-b", learnerId: mia.id, confirm: true }), { status: 409 }, "profile already linked");
	const bProfile = await svc.createLearner(repo, inst1, { displayName: "Spare", pin: "1234", subjects: ["math"], timeZone: "UTC" });
	await assert.rejects(linkStudentProfile(repo, inst1, { studentUserId: "stu-a", learnerId: bProfile.id, confirm: true }), { status: 409 }, "student already has a profile");
	assert.equal((await dir(repo, inst1)).students.find((s) => s.userId === "stu-a").learnerId, mia.id);
});

test("a profile managed by another instructor is not exposed; unlink keeps the profile and its progress", async () => {
	const { repo, inst1, inst2 } = await setup();
	// stu-a takes classes with both instructors; inst-2 already made the profile
	repo._db.courseEnrolments.push({ userId: "stu-a", courseId: "c3", status: "paid", created_at: new Date(T).toISOString() });
	const theirs = await mkProfile(repo, inst2, "stu-a");
	const row = (await dir(repo, inst1)).students.find((s) => s.userId === "stu-a");
	assert.deepEqual([row.profileState, row.learnerId, row.canAssign, row.gradeLabel], ["managed_elsewhere", null, false, null], "nothing about the other instructor's profile leaks");
	await assert.rejects(unlinkStudentProfile(repo, inst1, { learnerId: theirs.learnerId }), { status: 404 });
	// the owner can unlink; the profile (and anything done on it) stays
	await unlinkStudentProfile(repo, inst2, { learnerId: theirs.learnerId });
	assert.equal(repo._db.learners.length, 1);
	assert.equal(repo._db.learners[0].student_user_id, null);
});

// ------------------------------------------------------------------ the student's own side

test("a linked student unlocks only their own profile with its PIN, sees their assignments and cannot assign or edit", async () => {
	const { repo, inst1, student } = await setup();
	const made = await mkProfile(repo, inst1, "stu-a");
	const stuA = student("stu-a");
	const picker = await svc.listLearners(repo, stuA);
	assert.deepEqual(picker.map((l) => [l.id, l.relation]), [[made.learnerId, "self"]], "only their own profile");
	assert.deepEqual(await svc.listLearners(repo, student("stu-b")), []);
	await assert.rejects(svc.unlockLearner(repo, student("stu-b"), made.learnerId, "1234"), { status: 404 });
	await assert.rejects(svc.unlockLearner(repo, stuA, made.learnerId, "0000"), { code: "wrong_pin" });
	const token = (await svc.unlockLearner(repo, stuA, made.learnerId, "1234", { now: T })).learnerToken;
	const session = await svc.resolveLearnerSession(repo, verifyLearnerToken(token), stuA);
	assert.equal(session.learnerId, made.learnerId);
	assert.equal(await svc.resolveLearnerSession(repo, verifyLearnerToken(token), account("stu-b")), null, "not under another account");

	const work = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [made.learnerId], title: "For Ann" }, { now: T });
	const home = await svc.studyHome(repo, session, { now: T });
	assert.deepEqual(home.assignments.map((a) => a.title), ["For Ann"]);
	assert.equal(home.learner.gradeLabel, "Class 3");

	// not allowed: assigning, editing grade / profile, reading the profile's private data
	await assert.rejects(asg.createAssignment(repo, stuA, { ...WS, learnerIds: [made.learnerId] }, { now: T }), { status: 403 });
	await assert.rejects(svc.updateLearner(repo, stuA, made.learnerId, { grade: "C7" }), { status: 403 });
	await assert.rejects(asg.updateAssignment(repo, stuA, work.assignmentId, { cancel: true }), { status: 403 });
	assert.equal((await svc.learnerDashboard(repo, stuA, made.learnerId, { now: T })).profile, null, "no date of birth or contact for the student view");

	// unlinking ends the student's access at once
	await unlinkStudentProfile(repo, inst1, { learnerId: made.learnerId });
	assert.equal(await svc.resolveLearnerSession(repo, verifyLearnerToken(token), stuA), null);
	assert.deepEqual(await svc.listLearners(repo, stuA), []);
});

// ------------------------------------------------------------------ assigning from the directory + consistency

test("assigning from the directory: eligible rows only, one or many, retries do not duplicate; ids of account students are rejected", async () => {
	const { repo, inst1 } = await setup();
	const a = await mkProfile(repo, inst1, "stu-a");
	const b = await mkProfile(repo, inst1, "stu-b", { grade: "C4", age: 9 });
	const rows = (await dir(repo, inst1)).students;
	assert.deepEqual(rows.filter((r) => r.canAssign).map((r) => r.userId).sort(), ["stu-a", "stu-b"]);
	// raw account-student ids (not learner ids) never work, however they are sent
	await assert.rejects(asg.createAssignment(repo, inst1, { ...WS, learnerIds: ["stu-a"] }, { now: T }), { status: 403 });
	await assert.rejects(asg.createAssignment(repo, inst1, { ...WS, learnerIds: ["stu-c"] }, { now: T }), { status: 403 });
	const one = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [a.learnerId] }, { now: T });
	const many = await asg.createAssignment(repo, inst1, { ...WS, worksheetNo: 2, learnerIds: [a.learnerId, b.learnerId], dueAt: new Date(T + DAY).toISOString() }, { now: T });
	const retry = await asg.createAssignment(repo, inst1, { ...WS, worksheetNo: 2, learnerIds: [b.learnerId, a.learnerId], dueAt: new Date(T + DAY).toISOString() }, { now: T + 3000 });
	assert.equal(retry.duplicate, true);
	assert.equal(repo._db.assignments.length, 2);
	assert.equal(repo._db.targets.length, 3);
	const d = await dir(repo, inst1);
	assert.deepEqual(d.students.find((s) => s.userId === "stu-a").counts, { assigned: 2, pending: 2, inProgress: 0, completed: 0, overdue: 0 });
	assert.deepEqual(d.students.find((s) => s.userId === "stu-b").counts.assigned, 1);
	assert.equal(d.summary.openAssignments, 3);
	assert.ok(one.assignmentId && many.assignmentId);
});

test("start and complete: directory, student page and Family dashboard agree on status and score", async () => {
	const { repo, inst1, student } = await setup();
	const a = await mkProfile(repo, inst1, "stu-a");
	const b = await mkProfile(repo, inst1, "stu-b");
	const work = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [a.learnerId, b.learnerId], courseId: "c1" }, { now: T });
	const sessionOf = async (uid, lid) => svc.resolveLearnerSession(repo, verifyLearnerToken((await svc.unlockLearner(repo, student(uid), lid, "1234", { now: T })).learnerToken), student(uid));
	const sa = await sessionOf("stu-a", a.learnerId);
	const row = async (uid, now) => (await studentDirectory(repo, inst1, {}, { now })).students.find((s) => s.userId === uid);

	assert.equal((await row("stu-a", T)).status, "not_started");
	const st = await svc.startWorksheet(repo, sa, { assignmentId: work.assignmentId }, { now: T + 1000 });
	assert.equal((await row("stu-a", T + 2000)).status, "in_progress");
	assert.equal((await svc.studyHome(repo, sa, { now: T + 2000 })).assignments[0].status, "in_progress");
	await svc.submitAttempt(repo, sa, { startToken: st.startToken, clientAttemptId: "dir-attempt-0001", responses: st.sheet.problems.map((p) => [right(p)]), durationMs: 70000 }, { now: T + 80000 });

	const stored = repo._db.attempts[0];
	const viaDir = await row("stu-a", T + 90000);
	const viaStudent = (await svc.studyHome(repo, sa, { now: T + 90000 })).assignments[0];
	const viaFamily = (await svc.learnerDashboard(repo, inst1, a.learnerId, { now: T + 90000 })).assignments[0];
	assert.equal(viaDir.status, "all_done");
	for (const x of [viaStudent, viaFamily]) {
		assert.equal(x.status, "completed");
		assert.equal(x.result.attemptId, stored.id);
		assert.equal(x.result.correctFirst, stored.correct_first);
	}
	assert.equal(viaDir.lastActivityAt, new Date(stored.completed_at).toISOString());
	assert.equal(viaDir.counts.completed, 1);
	// the other student is untouched
	const rb = await row("stu-b", T + 90000);
	assert.deepEqual([rb.counts.completed, rb.status, rb.lastActivityAt], [0, "not_started", null]);
	const sum = (await dir(repo, inst1)).summary;
	assert.deepEqual([sum.completedAssignments, sum.openAssignments], [1, 1]);
	// course filter also matches by the course an assignment was given in
	assert.deepEqual((await studentDirectory(repo, inst1, { courseId: "c1" }, { now: T })).students.map((s) => s.userId).sort(), ["stu-a", "stu-b"]);
});

test("summary 'active learners' counts recent practice only; grade and subject and status filters work", async () => {
	const { repo, inst1, student } = await setup();
	const a = await mkProfile(repo, inst1, "stu-a", { grade: "C3" });
	await mkProfile(repo, inst1, "stu-b", { grade: "C4", subjects: ["math", "english"] });
	const work = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [a.learnerId], dueAt: new Date(T + DAY).toISOString() }, { now: T });
	const sa = await svc.resolveLearnerSession(repo, verifyLearnerToken((await svc.unlockLearner(repo, student("stu-a"), a.learnerId, "1234", { now: T })).learnerToken), student("stu-a"));
	const st = await svc.startWorksheet(repo, sa, { assignmentId: work.assignmentId }, { now: T });
	await svc.submitAttempt(repo, sa, { startToken: st.startToken, clientAttemptId: "dir-attempt-0002", responses: st.sheet.problems.map((p) => [right(p)]), durationMs: 70000 }, { now: T + 80000 });
	const ids = async (f, now = T + 90000) => (await studentDirectory(repo, inst1, f, { now })).students.map((s) => s.userId);
	assert.equal((await studentDirectory(repo, inst1, {}, { now: T + 90000 })).summary.activeLearners, 1);
	assert.equal((await studentDirectory(repo, inst1, {}, { now: T + 30 * DAY })).summary.activeLearners, 0, "a month later nobody is 'active'");
	assert.deepEqual(await ids({ grade: "C4" }), ["stu-b"]);
	assert.deepEqual(await ids({ subject: "english" }), ["stu-b"]);
	assert.deepEqual(await ids({ status: "all_done" }), ["stu-a"]);
	assert.deepEqual(await ids({ status: "no_work" }), ["stu-b"]);
	assert.deepEqual(await ids({ status: "no_profile" }), []);
});

test("a profile-only learner (no account) still appears once; learners of other instructors do not", async () => {
	const { repo, inst1, inst2 } = await setup();
	await svc.createLearner(repo, inst1, { displayName: "Walk-in", pin: "1234", subjects: ["math"], timeZone: "UTC", grade: "LKG", age: 4 });
	await svc.createLearner(repo, inst2, { displayName: "Other", pin: "1234", subjects: ["math"], timeZone: "UTC" });
	const d = await dir(repo, inst1);
	const w = d.students.find((s) => s.name === "Walk-in");
	assert.deepEqual([w.type, w.gradeLabel, w.age, w.email, w.canAssign], ["profile", "LKG", 4, "", true]);
	assert.ok(!d.students.some((s) => s.name === "Other"));
});

test("assignment notifications reach the linked student account too, with a link to their own study page", async () => {
	const { repo, inst1 } = await setup();
	const a = await mkProfile(repo, inst1, "stu-a");
	const notif = createSessionRepo();
	notif._db.users.push({ id: "stu-a", name: "Ann", email: "stu-a@example.com" });
	const work = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [a.learnerId] }, { now: T });
	const info = { assignment: repo._db.assignments[0], learnerIds: [a.learnerId], actor: { userId: "inst-1", name: "Ines" } };
	const deps = { mastery: repo, notif, mailer: null, baseUrl: "https://x.test" };
	assert.equal((await notifyAssignment(deps, "assigned", info)).created, 1);
	assert.equal(notif._db.notifications[0].user_id, "stu-a");
	assert.equal(notif._db.notifications[0].link, "/study/");
	assert.equal((await notifyAssignment(deps, "assigned", info)).created, 0, "a retry does not repeat it");
	assert.ok(work.assignmentId);
});
