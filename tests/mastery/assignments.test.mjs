// Learner profiles (grade, age), instructor assignments, and the three views (instructor, learner,
// Family/guardian) that read the SAME records.
import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createMemoryRepo } from "./memoryRepo.mjs";
import { createSessionRepo } from "../live-sessions/memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import * as asg from "../../lib/mastery/assignments.js";
import { notifyAssignment } from "../../lib/mastery/assignmentNotify.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { verifyLearnerToken } from "../../lib/mastery/tokens.js";
import { listNotifications } from "../../lib/live-sessions/notify.js";
import { ageOf } from "../../lib/mastery/profile.js";

const account = (userId, role = "student", extra = []) => ({ kind: "account", userId, role, name: userId, permissions: resolvePermissions(role, extra) });
const T = Date.parse("2026-10-14T15:00:00Z");
const DAY = 86400000;
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);

const WS = { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 }; // the first worksheet of the ladder
const WS_AHEAD = { subject: "math", levelId: "6A", setId: "6A-2", worksheetNo: 3 };

async function setup() {
	const repo = createMemoryRepo();
	repo._db.users.push(
		{ id: "inst-1", email: "inst1@example.com", role: "instructor", first_name: "Ines", last_name: "One" },
		{ id: "inst-2", email: "inst2@example.com", role: "instructor", first_name: "Ivo", last_name: "Two" },
		{ id: "parent-1", email: "parent1@example.com", role: "student" },
		{ id: "parent-2", email: "parent2@example.com", role: "student" },
		{ id: "outsider", email: "o@example.com", role: "student" },
		{ id: "admin", email: "admin@example.com", role: "admin" }
	);
	repo._db.courses = [{ id: "course-1", userId: "inst-1" }, { id: "course-2", userId: "inst-2" }];
	const inst1 = account("inst-1", "instructor");
	const inst2 = account("inst-2", "instructor");
	const parent1 = account("parent-1", "student", ["learners.create"]);
	const parent2 = account("parent-2", "student", ["learners.create"]);
	const mk = (who, name, extra = {}) => svc.createLearner(repo, who, { displayName: name, pin: "1234", subjects: ["math"], dailyGoal: 2, timeZone: "UTC", ...extra });
	const mia = await mk(inst1, "Mia", { grade: "C3", birthDate: "2017-05-20" });
	const leo = await mk(inst1, "Leo", { grade: "C3", age: 8 });
	const kai = await mk(parent1, "Kai", { grade: "UKG" }); // a family child; inst-1 teaches Kai via an explicit link
	await svc.addGuardian(repo, parent1, kai.id, "inst1@example.com", "instructor");
	const zed = await mk(inst2, "Zed", { grade: "C5" }); // inst-2's learner
	const miaTwin = await mk(parent2, "Mia", { grade: "C3" }); // same name, different account
	const actor = (l) => ({ kind: "learner", learnerId: l.id, accountUserId: l.owner || undefined });
	const as = async (l) => svc.resolveLearnerSession(repo, verifyLearnerToken((await svc.unlockLearner(repo, l.__owner, l.id, "1234", { now: T })).learnerToken), null);
	mia.__owner = inst1;
	leo.__owner = inst1;
	kai.__owner = parent1;
	zed.__owner = inst2;
	miaTwin.__owner = parent2;
	return { repo, inst1, inst2, parent1, parent2, mia, leo, kai, zed, miaTwin, as, actor };
}

async function complete(repo, learnerActor, assignmentId, now, { wrongFirst = 0, clientAttemptId } = {}) {
	const started = await svc.startWorksheet(repo, learnerActor, { assignmentId }, { now });
	const responses = started.sheet.problems.map((p, i) => (i < wrongFirst ? [(p.answer.kind === "multi" ? p.answer.parts.map(() => "x") : "x"), right(p)] : [right(p)]));
	const result = await svc.submitAttempt(
		repo,
		learnerActor,
		{ startToken: started.startToken, clientAttemptId: clientAttemptId || `att-${Math.random().toString(36).slice(2)}-abcdef`, responses, durationMs: 60000 },
		{ now: now + 60000 }
	);
	return { started, result };
}

// ------------------------------------------------------------------ 1. profile

test("profile: grade LKG-Class 7, age from date of birth, consistent and validated", async () => {
	const { repo, inst1, mia, leo } = await setup();
	assert.deepEqual([mia.grade, mia.gradeLabel], ["C3", "Class 3"]);
	assert.equal(mia.age, ageOf({ birth_date: "2017-05-20" }), "age is derived from the date of birth");
	assert.equal(leo.age, 8, "an age alone is kept as a birth year");
	assert.equal(leo.gradeLabel, "Class 3");
	for (const g of ["LKG", "UKG", "C1", "C2", "C3", "C4", "C5", "C6", "C7"]) {
		assert.equal((await svc.updateLearner(repo, inst1, mia.id, { grade: g })).grade, g);
	}
	assert.equal((await svc.updateLearner(repo, inst1, mia.id, { grade: "UKG" })).gradeLabel, "UKG");
	for (const bad of ["C8", "Class 3", "PreK", "c3", "9"]) await assert.rejects(svc.updateLearner(repo, inst1, mia.id, { grade: bad }), { status: 422 }, bad);
	for (const bad of [{ birthDate: "2999-01-01" }, { birthDate: "2017-02-30" }, { birthDate: "yesterday" }, { birthDate: "1900-01-01" }, { age: 1 }, { age: 40 }, { age: "x" }, { age: 7.5 }]) {
		await assert.rejects(svc.updateLearner(repo, inst1, mia.id, bad), { status: 422 }, JSON.stringify(bad));
	}
	// date of birth and age never disagree: the date wins, and switching to an age drops the date
	const withDob = await svc.updateLearner(repo, inst1, mia.id, { birthDate: "2016-01-01", age: 3 });
	assert.equal(withDob.age, ageOf({ birth_date: "2016-01-01" }));
	const ageOnly = await svc.updateLearner(repo, inst1, mia.id, { age: 6 });
	assert.equal(ageOnly.age, 6);
	assert.equal(repo._db.learners.find((l) => l.id === mia.id).birth_date, null);
	// contact is optional and validated
	const c = await svc.updateLearner(repo, inst1, mia.id, { contactName: "Rao", contactPhone: "+91 98765 43210", contactEmail: "rao@example.com" });
	assert.ok(c);
	for (const bad of [{ contactEmail: "not-an-email" }, { contactPhone: "call me" }, { contactName: "x".repeat(81) }]) await assert.rejects(svc.updateLearner(repo, inst1, mia.id, bad), { status: 422 });
});

test("profile privacy: date of birth and contact never reach learners, pickers or view-only adults; students cannot change their grade", async () => {
	const { repo, inst1, parent1, mia, kai, as } = await setup();
	await svc.updateLearner(repo, inst1, mia.id, { contactName: "Rao", contactEmail: "rao@example.com" });
	const pub = JSON.stringify(await svc.listLearners(repo, inst1));
	assert.ok(!/birth_date|birthDate|2017-05-20|contact|rao@example/i.test(pub), "the picker list has grade and age only");
	const sessionActor = await as(mia);
	const home = JSON.stringify(await svc.studyHome(repo, sessionActor, { now: T }));
	assert.ok(!/birth_date|birthDate|2017-05-20|rao@example|pin_hash|"pin"/i.test(home), "the learner's own page has no date of birth, contact or PIN");
	assert.equal((await svc.studyHome(repo, sessionActor, { now: T })).learner.age, mia.age);
	const dash = await svc.learnerDashboard(repo, inst1, mia.id);
	assert.equal(dash.profile.birthDate, "2017-05-20");
	assert.equal(dash.profile.contactEmail, "rao@example.com");
	assert.ok(!JSON.stringify(dash).includes("pin_hash"));
	// a view-only owner (plain student account that owns a profile) sees age but not the date of birth
	repo._db.users.push({ id: "plain", email: "plain@example.com", role: "student" });
	const plain = account("plain");
	repo._db.learners.push({ ...repo._db.learners.find((l) => l.id === kai.id), id: "viewonly-1", owner_user_id: "plain", display_name: "View", birth_date: "2018-01-01" });
	assert.equal((await svc.learnerDashboard(repo, plain, "viewonly-1")).profile, null);
	// a learner session (even adult mode) cannot edit grade, age or contact
	await svc.setAdultMode(repo, inst1, mia.id, true);
	await assert.rejects(svc.updateLearner(repo, sessionActor, mia.id, { grade: "C7" }), { status: 403 });
	await assert.rejects(svc.updateLearner(repo, sessionActor, mia.id, { age: 12 }), { status: 403 });
	assert.equal(repo._db.learners.find((l) => l.id === mia.id).grade, "C3");
	// another account cannot edit
	await assert.rejects(svc.updateLearner(repo, account("outsider"), mia.id, { grade: "C7" }), { status: 404 });
	await assert.rejects(svc.updateLearner(repo, parent1, mia.id, { grade: "C7" }), { status: 404 });
});

test("existing profiles and worksheet progress are preserved when grade/age are added", async () => {
	const { repo, parent2, miaTwin, as } = await setup();
	// an old profile: no grade, no birth date
	const old = await svc.createLearner(repo, parent2, { displayName: "Old", pin: "1234", subjects: ["math"], timeZone: "UTC" });
	assert.deepEqual([old.grade, old.gradeLabel, old.age], [null, null, null]);
	old.__owner = parent2;
	const a = await as(old);
	const first = await svc.startWorksheet(repo, a, { subject: "math", ...WS }, { now: T });
	await svc.submitAttempt(repo, a, { startToken: first.startToken, clientAttemptId: "old-attempt-1234", responses: first.sheet.problems.map((p) => [right(p)]), durationMs: 60000 }, { now: T + 60000 });
	const before = await svc.studyHome(repo, a, { now: T + 120000 });
	await svc.updateLearner(repo, parent2, old.id, { grade: "C1", age: 6 });
	const after = await svc.studyHome(repo, a, { now: T + 120000 });
	assert.deepEqual([after.totalStars, after.todayCount, after.subjects[0].position.worksheetNo], [before.totalStars, before.todayCount, before.subjects[0].position.worksheetNo]);
	assert.equal(after.learner.gradeLabel, "Class 1");
	assert.ok(miaTwin);
});

// ------------------------------------------------------------------ 2. scope + filters

test("an instructor sees only learners they own or are linked to - never everyone", async () => {
	const { repo, inst1, inst2, parent1, zed, kai, mia, leo, miaTwin } = await setup();
	const names = async (who, f) => (await asg.learnerOverview(repo, who, f, { now: T })).learners.map((l) => l.id).sort();
	assert.deepEqual(await names(inst1), [kai.id, leo.id, mia.id].sort(), "owned (Mia, Leo) + linked (Kai); not Zed or the other Mia");
	assert.deepEqual(await names(inst2), [zed.id]);
	assert.ok(!(await names(inst1)).includes(miaTwin.id) && !(await names(inst1)).includes(zed.id));
	assert.deepEqual(await names(parent1), [kai.id], "a parent sees their own child only");
	await assert.rejects(asg.learnerOverview(repo, null), { status: 401 });
	assert.deepEqual(await names(account("outsider")), []);
});

test("filters: name, grade, subject, learning status and course", async () => {
	const { repo, inst1, mia, leo, kai } = await setup();
	await svc.setEnrolment(repo, inst1, leo.id, "english", true);
	const f = async (x) => (await asg.learnerOverview(repo, inst1, x, { now: T })).learners.map((l) => l.displayName).sort();
	assert.deepEqual(await f({ q: "mi" }), ["Mia"]);
	assert.deepEqual(await f({ grade: "C3" }), ["Leo", "Mia"]);
	assert.deepEqual(await f({ grade: "UKG" }), ["Kai"]);
	assert.deepEqual(await f({ subject: "english" }), ["Leo"]);
	assert.deepEqual(await f({ status: "no_work" }), ["Kai", "Leo", "Mia"]);
	const a1 = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [mia.id], courseId: "course-1", dueAt: new Date(T + DAY).toISOString() }, { now: T });
	await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [leo.id] }, { now: T });
	assert.deepEqual(await f({ status: "not_started" }), ["Leo", "Mia"]);
	assert.deepEqual(await f({ course: "course-1" }), ["Mia"]);
	assert.deepEqual(await f({ status: "no_work" }), ["Kai"]);
	const later = (await asg.learnerOverview(repo, inst1, { status: "overdue" }, { now: T + 3 * DAY })).learners.map((l) => l.displayName);
	assert.deepEqual(later, ["Mia"], "only the one with a past due date is overdue");
	assert.ok(a1.assignmentId && kai);
});

// ------------------------------------------------------------------ 3. assigning

test("assign to one student and to a group; review step writes nothing; retries do not duplicate", async () => {
	const { repo, inst1, mia, leo } = await setup();
	const due = new Date(T + 2 * DAY).toISOString();
	const preview = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [mia.id, leo.id], dueAt: due, instructions: "Take your time", preview: true }, { now: T });
	assert.equal(preview.preview, true);
	assert.deepEqual(preview.students.map((s) => s.name).sort(), ["Leo", "Mia"]);
	assert.equal(repo._db.assignments.length, 0, "nothing is written by a preview");

	const one = await asg.createAssignment(repo, inst1, { ...WS_AHEAD, learnerIds: [mia.id] }, { now: T });
	assert.equal(one.duplicate, false);
	const group = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [mia.id, leo.id], dueAt: due, instructions: "Take your time", groupLabel: "Class 3 maths" }, { now: T });
	const retry = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [leo.id, mia.id], dueAt: due, instructions: "Take your time" }, { now: T + 5000 });
	assert.deepEqual([retry.duplicate, retry.assignmentId], [true, group.assignmentId]);
	assert.equal(repo._db.assignments.length, 2);
	assert.equal(repo._db.targets.length, 3, "1 + 2 targets");
	assert.equal(repo._db.assignments.find((a) => a.id === group.assignmentId).created_by, "inst-1");
});

test("assignment authorization and validation", async () => {
	const { repo, inst1, inst2, parent1, mia, zed, kai } = await setup();
	const call = (who, body) => asg.createAssignment(repo, who, { ...WS, ...body }, { now: T });
	await assert.rejects(call(null, { learnerIds: [mia.id] }), { status: 401 });
	await assert.rejects(call(parent1, { learnerIds: [kai.id] }), { status: 403 }, "a parent cannot assign");
	await assert.rejects(call(account("outsider"), { learnerIds: [mia.id] }), { status: 403 });
	await assert.rejects(call(inst2, { learnerIds: [mia.id] }), { status: 403 }, "another instructor's learner");
	await assert.rejects(call(inst1, { learnerIds: [mia.id, zed.id] }), { status: 403 }, "one out-of-scope learner refuses the whole group");
	assert.equal(repo._db.assignments.length, 0, "no partial assignment");
	await assert.rejects(call(inst1, { learnerIds: [] }), { status: 422 });
	await assert.rejects(call(inst1, { learnerIds: ["ghost"] }), { status: 403 });
	await assert.rejects(call(inst1, { learnerIds: [mia.id], levelId: "ZZ" }), { status: 422 });
	await assert.rejects(call(inst1, { learnerIds: [mia.id], worksheetNo: 99 }), { status: 422 });
	await assert.rejects(call(inst1, { learnerIds: [mia.id], subject: "english" }), { status: 422 }, "level does not belong to the subject");
	await assert.rejects(call(inst1, { learnerIds: [mia.id], dueAt: new Date(T - DAY).toISOString() }), { status: 422 });
	await assert.rejects(call(inst1, { learnerIds: [mia.id], dueAt: "soon" }), { status: 422 });
	await assert.rejects(call(inst1, { learnerIds: [mia.id], courseId: "course-2" }), { status: 403 }, "someone else's course");
	await assert.rejects(call(inst1, { learnerIds: [mia.id], grade: "C9" }), { status: 422 });
	await svc.setEnrolment(repo, inst1, mia.id, "math", false);
	await assert.rejects(call(inst1, { learnerIds: [mia.id] }), { status: 422, code: "subject_off" });
	// an admin may assign to anyone
	await svc.setEnrolment(repo, inst1, mia.id, "math", true);
	assert.ok((await call(account("admin", "admin"), { learnerIds: [mia.id] })).assignmentId);
});

// ------------------------------------------------------------------ 4-6. student view and the workflow

test("a learner sees only their own assignments; similar names stay separate", async () => {
	const { repo, inst1, inst2, mia, leo, miaTwin, as } = await setup();
	await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [mia.id, leo.id], title: "Group sheet" }, { now: T });
	await asg.createAssignment(repo, inst1, { ...WS_AHEAD, learnerIds: [mia.id], title: "Only Mia" }, { now: T });
	await asg.createAssignment(repo, account("parent-2", "instructor"), { ...WS, learnerIds: [miaTwin.id], title: "Twin only" }, { now: T }).catch(() => null);
	const titles = async (l) => (await svc.studyHome(repo, await as(l), { now: T })).assignments.map((a) => a.title).sort();
	assert.deepEqual(await titles(mia), ["Group sheet", "Only Mia"]);
	assert.deepEqual(await titles(leo), ["Group sheet"]);
	assert.deepEqual(await titles(miaTwin), ["Twin only"], "the other 'Mia' has her own work and none of Mia's");
	assert.ok(!(await svc.studyHome(repo, await as(mia), { now: T })).assignments.some((a) => a.title === "Twin only"));
	assert.ok(inst2);
	// a learner cannot start an assignment that is not theirs, nor create/cancel any
	const miaOnly = repo._db.assignments.find((a) => a.title === "Only Mia");
	await assert.rejects(svc.startWorksheet(repo, await as(leo), { assignmentId: miaOnly.id }, { now: T }), { status: 404 });
	await assert.rejects(svc.startWorksheet(repo, await as(miaTwin), { assignmentId: miaOnly.id }, { now: T }), { status: 404 });
	await assert.rejects(asg.createAssignment(repo, await as(mia), { ...WS, learnerIds: [mia.id] }, { now: T }), { status: 401 }, "a learner session is not an account");
	await assert.rejects(asg.updateAssignment(repo, await as(mia), miaOnly.id, { cancel: true }), { status: 401 });
});

test("start -> in progress, submit -> completed with the authoritative score; all three views agree", async () => {
	const { repo, inst1, parent1, mia, kai, as } = await setup();
	const due = new Date(T + 3 * DAY).toISOString();
	const kaiWork = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [kai.id], dueAt: due, instructions: "Slowly" }, { now: T });
	const view = async (now) => ({
		learner: (await svc.studyHome(repo, await as(kai), { now })).assignments.find((a) => a.id === kaiWork.assignmentId),
		family: (await svc.learnerDashboard(repo, parent1, kai.id, { now })).assignments.find((a) => a.id === kaiWork.assignmentId),
		instructor: (await svc.learnerDashboard(repo, inst1, kai.id, { now })).assignments.find((a) => a.id === kaiWork.assignmentId),
		counts: {
			learner: (await svc.studyHome(repo, await as(kai), { now })).assignmentCounts,
			family: (await svc.learnerDashboard(repo, parent1, kai.id, { now })).assignmentCounts,
			instructor: (await asg.learnerOverview(repo, inst1, {}, { now })).learners.find((l) => l.id === kai.id).counts,
		},
	});

	// 2/3. assigned: pending in all three; the guardian sees it too
	let v = await view(T + 1000);
	for (const k of ["learner", "family", "instructor"]) {
		assert.equal(v[k].status, "pending", k);
		assert.equal(v[k].instructions, "Slowly");
		assert.equal(v[k].dueAt, due);
		assert.equal(v[k].result, null);
	}
	assert.deepEqual(v.counts.learner, { assigned: 1, pending: 1, inProgress: 0, completed: 0, overdue: 0 });
	assert.deepEqual(v.counts.family, v.counts.learner);
	assert.deepEqual(v.counts.instructor, v.counts.learner);

	// 4. start: in progress everywhere, NOT completed
	const kidActor = await as(kai);
	const started = await svc.startWorksheet(repo, kidActor, { assignmentId: kaiWork.assignmentId }, { now: T + 2000 });
	assert.equal(started.assignmentId, kaiWork.assignmentId);
	v = await view(T + 3000);
	for (const k of ["learner", "family", "instructor"]) assert.equal(v[k].status, "in_progress", k);
	assert.equal(v.learner.completedAt, null);
	assert.deepEqual([v.counts.family.inProgress, v.counts.family.completed], [1, 0]);
	// opening it again does not move the start time or complete anything
	await svc.startWorksheet(repo, kidActor, { assignmentId: kaiWork.assignmentId }, { now: T + 4000 });
	assert.equal(repo._db.targets[0].started_at, new Date(T + 2000).toISOString());

	// complete with 2 first-try mistakes
	const attempt = await (async () => {
		const st = await svc.startWorksheet(repo, kidActor, { assignmentId: kaiWork.assignmentId }, { now: T + 5000 });
		const responses = st.sheet.problems.map((p, i) => (i < 2 ? [p.answer.kind === "multi" ? p.answer.parts.map(() => "x") : "x", right(p)] : [right(p)]));
		return svc.submitAttempt(repo, kidActor, { startToken: st.startToken, clientAttemptId: "kai-attempt-0001", responses, durationMs: 90000 }, { now: T + 95000 });
	})();
	assert.equal(attempt.correctFirst, attempt.total - 2);

	// 5. completed with the stored submission's numbers, identically in all three views
	v = await view(T + 100000);
	const stored = repo._db.attempts.find((a) => a.client_attempt_id === "kai-attempt-0001");
	for (const k of ["learner", "family", "instructor"]) {
		assert.equal(v[k].status, "completed", k);
		assert.equal(v[k].result.attemptId, stored.id, "points at the graded attempt");
		assert.equal(v[k].result.correctFirst, stored.correct_first);
		assert.equal(v[k].result.total, stored.total);
		assert.equal(v[k].result.stars, stored.stars);
		assert.equal(v[k].result.accuracy, Number(stored.accuracy));
		assert.ok(v[k].result.feedback);
	}
	assert.deepEqual(v.counts.family, { assigned: 1, pending: 0, inProgress: 0, completed: 1, overdue: 0 });
	assert.deepEqual(v.counts.learner, v.counts.family);
	assert.deepEqual(v.counts.instructor, v.counts.family);

	// a retried sync of the same submission completes nothing twice
	const again = await svc.submitAttempt(repo, kidActor, { startToken: started.startToken, clientAttemptId: "kai-attempt-0001", responses: [], durationMs: 1 }, { now: T + 200000 });
	assert.equal(again.duplicate, true);
	assert.equal(repo._db.attempts.filter((a) => a.learner_id === kai.id).length, 1);
	assert.equal((await view(T + 300000)).counts.family.completed, 1);

	// Mastery Ladder numbers come from the same attempt: stars, daily goal, activity
	const home = await svc.studyHome(repo, kidActor, { now: T + 100000 });
	assert.equal(home.totalStars, stored.stars);
	assert.equal(home.todayCount, 1);
	const fam = await svc.learnerDashboard(repo, parent1, kai.id, { now: T + 100000 });
	assert.equal(fam.todayCount, home.todayCount);
	assert.equal(fam.lastUpdateAt, new Date(stored.completed_at).toISOString());
	// Mia (unrelated) is untouched
	assert.equal((await svc.studyHome(repo, await as(mia), { now: T + 100000 })).totalStars, 0);
});

test("completing the assignment updates only that learner; the ladder is not double counted or silently changed", async () => {
	const { repo, inst1, mia, leo, as } = await setup();
	const a = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [mia.id, leo.id] }, { now: T });
	const miaA = await as(mia);
	const done = await complete(repo, miaA, a.assignmentId, T + 1000);
	const sMia = await svc.studyHome(repo, miaA, { now: T + 100000 });
	const sLeo = await svc.studyHome(repo, await as(leo), { now: T + 100000 });
	assert.equal(sMia.assignmentCounts.completed, 1);
	assert.equal(sLeo.assignmentCounts.completed, 0, "Leo has not done it");
	assert.equal(sLeo.assignmentCounts.pending, 1);
	assert.equal(sLeo.todayCount, 0);
	assert.equal(sMia.todayCount, 1, "one worksheet counted once for the daily goal");
	assert.equal(repo._db.activity.filter((x) => x.learner_id === mia.id).reduce((n, x) => n + x.worksheets, 0), 1);
	// it was Mia's CURRENT ladder worksheet, so the ladder moved exactly as for any worksheet
	assert.equal(done.result.counted, true);
	// instructor overview: Mia all done, Leo not started
	const ov = (await asg.learnerOverview(repo, inst1, {}, { now: T + 100000 })).learners;
	assert.equal(ov.find((l) => l.id === mia.id).status, "all_done");
	assert.equal(ov.find((l) => l.id === leo.id).status, "not_started");
});

test("a worksheet ahead of the ladder is practice: it completes the assignment but does not move the ladder", async () => {
	const { repo, inst1, mia, as } = await setup();
	const a = await asg.createAssignment(repo, inst1, { ...WS_AHEAD, learnerIds: [mia.id] }, { now: T });
	const miaA = await as(mia);
	const before = (await svc.studyHome(repo, miaA, { now: T })).subjects[0].position;
	// without the assignment the same worksheet is locked
	await assert.rejects(svc.startWorksheet(repo, miaA, { subject: "math", ...WS_AHEAD }, { now: T }), { status: 403, code: "locked" });
	const { result } = await complete(repo, miaA, a.assignmentId, T + 1000);
	assert.equal(result.counted, false);
	const after = (await svc.studyHome(repo, miaA, { now: T + 100000 })).subjects[0].position;
	assert.deepEqual([after.setId, after.worksheetNo], [before.setId, before.worksheetNo]);
	assert.equal((await svc.studyHome(repo, miaA, { now: T + 100000 })).assignmentCounts.completed, 1);
});

test("overdue, due-date changes and cancelling follow the stored records", async () => {
	const { repo, inst1, inst2, mia, as } = await setup();
	const a = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [mia.id], dueAt: new Date(T + DAY).toISOString() }, { now: T });
	const counts = async (now) => (await svc.studyHome(repo, await as(mia), { now })).assignmentCounts;
	assert.equal((await counts(T + 100)).overdue, 0);
	assert.deepEqual(await counts(T + 2 * DAY), { assigned: 1, pending: 1, inProgress: 0, completed: 0, overdue: 1 });
	const moved = await asg.updateAssignment(repo, inst1, a.assignmentId, { dueAt: new Date(T + 5 * DAY).toISOString() }, { now: T + 2 * DAY });
	assert.deepEqual(moved.changed, ["due"]);
	assert.equal((await counts(T + 2 * DAY)).overdue, 0);
	assert.deepEqual((await asg.updateAssignment(repo, inst1, a.assignmentId, { dueAt: new Date(T + 5 * DAY).toISOString() }, { now: T + 2 * DAY })).changed, [], "no change, nothing to announce");
	// a finished worksheet is never overdue
	await complete(repo, await as(mia), a.assignmentId, T + 2 * DAY);
	assert.equal((await counts(T + 9 * DAY)).overdue, 0);
	// other instructors and learners cannot change it
	await assert.rejects(asg.updateAssignment(repo, inst2, a.assignmentId, { cancel: true }), { status: 404 });
	await assert.rejects(asg.updateAssignment(repo, account("outsider"), a.assignmentId, { cancel: true }), { status: 403 });
	// cancel: gone from the learner, shown as cancelled to adults, cannot be started, results kept
	const b = await asg.createAssignment(repo, inst1, { ...WS_AHEAD, learnerIds: [mia.id] }, { now: T + 3 * DAY });
	assert.deepEqual((await asg.updateAssignment(repo, inst1, b.assignmentId, { cancel: true })).changed, ["cancelled"]);
	assert.deepEqual((await asg.updateAssignment(repo, inst1, b.assignmentId, { cancel: true })).changed, [], "idempotent");
	await assert.rejects(svc.startWorksheet(repo, await as(mia), { assignmentId: b.assignmentId }, { now: T }), { status: 409 });
	assert.ok(!(await svc.studyHome(repo, await as(mia), { now: T })).assignments.some((x) => x.id === b.assignmentId));
	const adult = (await svc.learnerDashboard(repo, inst1, mia.id, { now: T })).assignments;
	assert.equal(adult.find((x) => x.id === b.assignmentId).status, "cancelled");
	assert.equal(adult.find((x) => x.id === a.assignmentId).status, "completed", "earlier results remain");
	assert.equal((await counts(T)).assigned, 1, "cancelled work is not counted");
});

test("an offline-queued submission carries the assignment: a parent's device can sync it", async () => {
	const { repo, inst1, parent1, kai, as } = await setup();
	const a = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [kai.id] }, { now: T });
	const kid = await as(kai);
	const st = await svc.startWorksheet(repo, kid, { assignmentId: a.assignmentId }, { now: T });
	// flushed later by the guardian account instead of the learner session
	const r = await svc.submitAttempt(repo, parent1, { startToken: st.startToken, clientAttemptId: "offline-kai-0001", responses: st.sheet.problems.map((p) => [right(p)]), durationMs: 80000 }, { now: T + 90000 });
	assert.equal(r.duplicate, false);
	assert.equal((await svc.learnerDashboard(repo, parent1, kai.id, { now: T + 100000 })).assignments[0].status, "completed");
	// and an unrelated account cannot flush it
	const st2 = await svc.startWorksheet(repo, kid, { assignmentId: a.assignmentId }, { now: T + 1 });
	await assert.rejects(svc.submitAttempt(repo, account("outsider"), { startToken: st2.startToken, clientAttemptId: "offline-kai-0002", responses: [], durationMs: 1 }, { now: T + 2 }), { status: 404 });
});

// ------------------------------------------------------------------ 7-8. family + instructor isolation

test("guardians and instructors see only what they are linked to", async () => {
	const { repo, inst1, inst2, parent1, parent2, kai, mia, zed } = await setup();
	// two instructors teach Kai; each only sees their own assignments, the parent sees both
	await svc.addGuardian(repo, parent1, kai.id, "inst2@example.com", "instructor");
	const a1 = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [kai.id], title: "From Ines" }, { now: T });
	const a2 = await asg.createAssignment(repo, inst2, { ...WS, learnerIds: [kai.id], title: "From Ivo" }, { now: T });
	const titles = async (who) => (await svc.learnerDashboard(repo, who, kai.id, { now: T })).assignments.map((a) => a.title).sort();
	assert.deepEqual(await titles(parent1), ["From Ines", "From Ivo"]);
	assert.deepEqual(await titles(inst1), ["From Ines"]);
	assert.deepEqual(await titles(inst2), ["From Ivo"]);
	assert.deepEqual((await asg.learnerOverview(repo, inst1, {}, { now: T })).learners.find((l) => l.id === kai.id).counts.assigned, 1);
	// not linked => no access at all (404, existence not revealed)
	for (const who of [parent2, account("outsider")]) await assert.rejects(svc.learnerDashboard(repo, who, kai.id, { now: T }), { status: 404 });
	await assert.rejects(svc.learnerDashboard(repo, inst2, mia.id, { now: T }), { status: 404 });
	await assert.rejects(svc.learnerDashboard(repo, inst1, zed.id, { now: T }), { status: 404 });
	// a guardian cannot change or cancel an instructor's assignment, or submit as the student
	await assert.rejects(asg.updateAssignment(repo, parent1, a1.assignmentId, { cancel: true }), { status: 403 });
	await assert.rejects(asg.updateAssignment(repo, inst2, a1.assignmentId, { cancel: true }), { status: 404 });
	await assert.rejects(svc.startWorksheet(repo, parent1, { assignmentId: a1.assignmentId }, { now: T }), { status: 401 });
	assert.ok(a2.assignmentId);
});

test("switching between two learners loads each learner's own assignments and progress", async () => {
	const { repo, inst1, mia, leo, as } = await setup();
	const a = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [mia.id, leo.id] }, { now: T });
	await complete(repo, await as(mia), a.assignmentId, T + 1000);
	for (let i = 0; i < 2; i++) {
		const m = await svc.studyHome(repo, await as(mia), { now: T + 100000 });
		const l = await svc.studyHome(repo, await as(leo), { now: T + 100000 });
		assert.deepEqual([m.learner.displayName, m.assignmentCounts.completed, m.todayCount], ["Mia", 1, 1]);
		assert.deepEqual([l.learner.displayName, l.assignmentCounts.completed, l.todayCount], ["Leo", 0, 0]);
	}
});

// ------------------------------------------------------------------ 9. notifications

const mail = () => {
	const sent = [];
	return { sent, mailer: async (m) => (sent.push(m), { ok: true }) };
};

test("assignment notifications: owner and guardians (not the assigning instructor), deduplicated, e-mail status recorded", async () => {
	const { repo, inst1, parent1, kai, mia } = await setup();
	const notif = createSessionRepo();
	notif._db.users.push({ id: "inst-1", name: "Ines One", email: "inst1@example.com" }, { id: "parent-1", name: "Pat", email: "parent1@example.com" });
	const box = mail();
	const deps = { mastery: repo, notif, mailer: box.mailer, baseUrl: "https://app.example.test" };
	const a = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [kai.id, mia.id], dueAt: new Date(T + DAY).toISOString(), instructions: "Slowly" }, { now: T });
	const info = { assignment: repo._db.assignments.find((x) => x.id === a.assignmentId), learnerIds: [kai.id, mia.id], actor: { userId: "inst-1", name: "Ines One" } };
	const r1 = await notifyAssignment(deps, "assigned", info);
	assert.deepEqual([r1.created, r1.email.sent], [1, 1], "only Kai's parent: Mia is owned by the instructor, who made the assignment");
	const n = notif._db.notifications[0];
	assert.equal(n.user_id, "parent-1");
	assert.equal(n.type, "worksheet_assigned");
	assert.equal(n.link, `/family/?learner=${kai.id}`);
	assert.match(n.body, /Kai/);
	assert.match(n.body, /Ines One/);
	assert.match(n.body, /Slowly/);
	assert.equal(n.email_status, "sent");
	assert.ok(!/pin|birth/i.test(n.body));
	assert.ok(box.sent[0].html.includes("https://app.example.test/family/?learner="));
	// retries do not duplicate or re-send
	const r2 = await notifyAssignment(deps, "assigned", info);
	assert.deepEqual([r2.created, r2.duplicates], [0, 1]);
	assert.equal(box.sent.length, 1);
	// a changed due date is news once; the same date again is not
	const moved = await asg.updateAssignment(repo, inst1, a.assignmentId, { dueAt: new Date(T + 4 * DAY).toISOString() }, { now: T });
	const dueInfo = { assignment: moved.assignment, learnerIds: moved.learnerIds, actor: info.actor };
	assert.equal((await notifyAssignment(deps, "due", dueInfo)).created, 1);
	assert.equal((await notifyAssignment(deps, "due", dueInfo)).created, 0);
	const cancelled = await asg.updateAssignment(repo, inst1, a.assignmentId, { cancel: true });
	assert.equal((await notifyAssignment(deps, "cancelled", { assignment: cancelled.assignment, learnerIds: cancelled.learnerIds, actor: info.actor })).created, 1);
	assert.deepEqual(notif._db.notifications.map((x) => x.type).sort(), ["worksheet_assigned", "worksheet_cancelled", "worksheet_due_changed"]);
	// the guardian sees them in the existing notification list
	const list = await listNotifications(notif, { userId: "parent-1" }, new Date(T));
	assert.equal(list.notifications.length, 3);
	assert.deepEqual((await listNotifications(notif, { userId: "outsider" }, new Date(T))).notifications, []);
});

test("a failing or unconfigured e-mail never undoes the assignment and the status is reported honestly", async () => {
	const { repo, inst1, kai } = await setup();
	const a = await asg.createAssignment(repo, inst1, { ...WS, learnerIds: [kai.id] }, { now: T });
	const info = { assignment: repo._db.assignments[0], learnerIds: [kai.id], actor: { userId: "inst-1", name: "Ines" } };
	for (const [mailer, expect] of [
		[async () => ({ ok: false, error: "smtp down" }), "failed"],
		[async () => { throw new Error("boom"); }, "none"],
		[async () => ({ ok: false, skipped: true }), "skipped"],
		[null, "skipped"],
	]) {
		const notif = createSessionRepo();
		notif._db.users.push({ id: "parent-1", name: "Pat", email: "parent1@example.com" });
		const r = await notifyAssignment({ mastery: repo, notif, mailer, baseUrl: "x" }, "assigned", info);
		assert.equal(r.created, 1);
		assert.equal(notif._db.notifications[0].email_status, expect);
	}
	const unconfirmed = createSessionRepo();
	unconfirmed._db.users.push({ id: "parent-1", name: "Pat", email: "p@example.com", emailConfirmed: false });
	const box = mail();
	await notifyAssignment({ mastery: repo, notif: unconfirmed, mailer: box.mailer, baseUrl: "x" }, "assigned", info);
	assert.equal(box.sent.length, 0, "unconfirmed addresses are not e-mailed");
	assert.equal(repo._db.assignments.length, 1, "the assignment is still saved");
	assert.ok(a.assignmentId);
});
