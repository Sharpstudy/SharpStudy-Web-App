import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createMemoryRepo } from "./memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { verifyLearnerToken, signStartToken, verifyAccountToken } from "../../lib/mastery/tokens.js";
import { OUTCOME } from "../../lib/mastery/rules.js";

// Accounts named parent* model family accounts that hold the "Family" role (learners.create).
const account = (userId, role = "student", extra = /^(parent|p[0-9])/.test(userId) ? ["learners.create"] : []) => ({ kind: "account", userId, role, permissions: resolvePermissions(role, extra) });
const learnerActor = (learnerId, accountUserId) => ({ kind: "learner", learnerId, accountUserId });
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);
const wrong = (p) => (p.answer.kind === "multi" ? p.answer.parts.map(() => "wrong") : "wrong");

async function setup() {
	const repo = createMemoryRepo();
	repo._db.users.push(
		{ id: "parent-1", email: "parent@example.com", role: "student" },
		{ id: "stranger", email: "stranger@example.com", role: "student" },
		{ id: "teacher", email: "teacher@example.com", role: "instructor" },
		{ id: "admin", email: "admin@example.com", role: "admin" }
	);
	const parent = account("parent-1");
	const kid = await svc.createLearner(repo, parent, { displayName: "Ava", pin: "1234", subjects: ["math", "english"], timeZone: "America/Vancouver" });
	return { repo, parent, kid, kidActor: learnerActor(kid.id, "parent-1") };
}

let attemptSeq = 0;
async function doWorksheet(repo, actor, pos, { wrongFirst = 0, durationMs = 60000, now, clientAttemptId } = {}) {
	const started = await svc.startWorksheet(repo, actor, { subject: "math", ...pos }, { now });
	const responses = started.sheet.problems.map((p, i) => (i < wrongFirst ? [wrong(p), right(p)] : [right(p)]));
	const result = await svc.submitAttempt(
		repo,
		actor,
		{ startToken: started.startToken, clientAttemptId: clientAttemptId || `attempt-${++attemptSeq}-abcdef`, responses, durationMs },
		{ now: (now || Date.now()) + durationMs }
	);
	return { started, result };
}

test("learner PINs are hashed and verified; lockout after repeated failures", async () => {
	const { repo, parent, kid } = await setup();
	const stored = repo._db.learners[0];
	assert.ok(stored.pin_hash && stored.pin_hash !== "1234" && stored.pin_hash.startsWith("$2"), "PIN must be bcrypt-hashed");
	const ok = await svc.unlockLearner(repo, parent, kid.id, "1234");
	assert.equal(verifyLearnerToken(ok.learnerToken).learnerId, kid.id);
	assert.equal(verifyAccountToken(ok.learnerToken), null, "learner tokens are not account tokens");
	for (let i = 0; i < 4; i++) await assert.rejects(svc.unlockLearner(repo, parent, kid.id, "0000"), { code: "wrong_pin" });
	await assert.rejects(svc.unlockLearner(repo, parent, kid.id, "0000"), { code: "wrong_pin" }); // 5th locks
	await assert.rejects(svc.unlockLearner(repo, parent, kid.id, "1234"), { code: "locked" });
	assert.ok(repo._db.audit.some((a) => a.action === "learner.login_failed"));
	// Authorised PIN reset clears the lock
	await svc.resetPin(repo, parent, kid.id, "4321");
	await svc.unlockLearner(repo, parent, kid.id, "4321");
	assert.ok(repo._db.audit.some((a) => a.action === "learner.pin_reset"));
});

test("only authorised adults can reset PINs or see learners", async () => {
	const { repo, kid, kidActor } = await setup();
	await assert.rejects(svc.resetPin(repo, account("stranger"), kid.id, "1111"), { status: 404 });
	await assert.rejects(svc.unlockLearner(repo, account("stranger"), kid.id, "1234"), { status: 404 });
	await assert.rejects(svc.resetPin(repo, kidActor, kid.id, "1111"), { status: 403 });
	await assert.rejects(svc.createLearner(repo, account("parent-1"), { displayName: "X", pin: "12a4" }), { code: "invalid" });
});

test("locked worksheets cannot be opened by URL/API", async () => {
	const { repo, kidActor } = await setup();
	const home = await svc.studyHome(repo, kidActor);
	assert.deepEqual(home.subjects.map((s) => s.id).sort(), ["english", "math"]);
	assert.equal(home.subjects.find((s) => s.id === "math").position.setId, "7A-1");
	await svc.startWorksheet(repo, kidActor, { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 });
	await assert.rejects(svc.startWorksheet(repo, kidActor, { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 2 }), { code: "locked" });
	await assert.rejects(svc.startWorksheet(repo, kidActor, { subject: "math", levelId: "C", setId: "C-1", worksheetNo: 1 }), { code: "locked" });
	await assert.rejects(svc.startWorksheet(repo, kidActor, { subject: "physics", levelId: "PH1", setId: "PH1-1", worksheetNo: 1 }), { code: "locked" });
	await assert.rejects(svc.startWorksheet(repo, kidActor, { subject: "math", levelId: "ZZ", setId: "ZZ-1", worksheetNo: 1 }), { status: 404 });
	await assert.rejects(svc.startWorksheet(repo, account("parent-1"), { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 }), { status: 401 });
});

test("passing advances, 7/8 repeats, last-sheet 7/8 restarts the set, last-sheet 8/8 advances set", async () => {
	const { repo, kidActor, kid } = await setup();
	const r1 = await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 1 }, { durationMs: 80000 });
	assert.equal(r1.result.stars, 3);
	assert.equal(r1.result.outcome, OUTCOME.NEXT_WORKSHEET);
	const r2 = await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 2 }, { wrongFirst: 1 });
	assert.equal(r2.result.correctFirst, 7);
	assert.equal(r2.result.outcome, OUTCOME.REPEAT_WORKSHEET);
	// Repeat gets a fresh variant (new numbers)
	const again = await svc.startWorksheet(repo, kidActor, { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 2 });
	assert.equal(again.sheet.variant, 1);
	for (const ws of [2, 3, 4, 5, 6, 7, 8, 9]) await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: ws });
	const last = await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 10 }, { wrongFirst: 1 });
	assert.equal(last.result.outcome, OUTCOME.RESTART_SET);
	assert.equal((await repo.getProgress(kid.id, "math")).worksheet_no, 1);
	for (const ws of [1, 2, 3, 4, 5, 6, 7, 8, 9]) await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: ws });
	const exit = await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 10 }, { durationMs: 200000 });
	assert.equal(exit.result.status, "practice-speed");
	assert.equal(exit.result.outcome, OUTCOME.REPEAT_WORKSHEET, "slow but perfect stays on the same worksheet");
	assert.equal((await repo.getProgress(kid.id, "math")).worksheet_no, 10);
	const exit2 = await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 10 }, { durationMs: 100000 });
	assert.equal(exit2.result.outcome, OUTCOME.NEXT_SET);
	exit.result.next = exit2.result.next;
	assert.equal(exit.result.next.setId, "7A-2");
	// Earlier worksheets stay open for review but do not move placement
	const review = await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 3 });
	assert.equal(review.result.outcome, OUTCOME.REVIEW);
	assert.equal((await repo.getProgress(kid.id, "math")).set_id, "7A-2");
});

test("submissions are idempotent and cannot be forged", async () => {
	const { repo, kidActor, kid } = await setup();
	const started = await svc.startWorksheet(repo, kidActor, { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 });
	const responses = started.sheet.problems.map((p) => [right(p)]);
	const body = { startToken: started.startToken, clientAttemptId: "dup-test-123456", responses, durationMs: 30000 };
	const a = await svc.submitAttempt(repo, kidActor, body);
	const b = await svc.submitAttempt(repo, kidActor, body);
	assert.equal(a.duplicate, false);
	assert.equal(b.duplicate, true);
	assert.equal(b.attemptId, a.attemptId);
	assert.equal(repo._db.attempts.length, 1);
	assert.equal(repo._db.activity[0].worksheets, 1, "duplicate must not double count activity");
	assert.equal((await repo.getProgress(kid.id, "math")).worksheet_no, 2, "advanced exactly once");

	// Tampered/forged tokens
	await assert.rejects(svc.submitAttempt(repo, kidActor, { ...body, clientAttemptId: "forged-0000001", startToken: "abc" }), { code: "invalid_token" });
	const forged = signStartToken({ sessionId: "s", learnerId: kid.id, subject: "math", levelId: "C", setId: "C-1", worksheetNo: 1, variant: 0, startedAt: Date.now() }).replace(/.$/, "x");
	await assert.rejects(svc.submitAttempt(repo, kidActor, { ...body, clientAttemptId: "forged-0000002", startToken: forged }), { code: "invalid_token" });
	// Claiming answers were right does not help: the server re-grades
	const s2 = await svc.startWorksheet(repo, kidActor, { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 2 });
	const bad = s2.sheet.problems.map((p) => [wrong(p)]);
	await assert.rejects(
		svc.submitAttempt(repo, kidActor, { startToken: s2.startToken, clientAttemptId: "bad-answers-0001", responses: bad, correctFirst: 8, stars: 3 }),
		{ code: "incomplete" }
	);
	// Another learner cannot submit this learner's sheet
	const other = await svc.createLearner(repo, account("parent-1"), { displayName: "Ben", pin: "5555" });
	await assert.rejects(
		svc.submitAttempt(repo, learnerActor(other.id, "parent-1"), { ...body, clientAttemptId: "cross-learner-01" }),
		{ status: 403 }
	);
});

test("implausible durations are bounded by server time", async () => {
	const { repo, kidActor } = await setup();
	const t0 = Date.UTC(2026, 3, 1, 10, 0, 0);
	const started = await svc.startWorksheet(repo, kidActor, { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 }, { now: t0 });
	const responses = started.sheet.problems.map((p) => [right(p)]);
	const r = await svc.submitAttempt(repo, kidActor, { startToken: started.startToken, clientAttemptId: "too-fast-000001", responses, durationMs: 1 }, { now: t0 + 90000 });
	assert.equal(r.durationMs, 8 * svc.LIMITS.minMsPerQuestion);
	const s2 = await svc.startWorksheet(repo, kidActor, { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 2 }, { now: t0 });
	const r2 = await svc.submitAttempt(
		repo,
		kidActor,
		{ startToken: s2.startToken, clientAttemptId: "too-slow-000001", responses: s2.sheet.problems.map((p) => [right(p)]), durationMs: 10 * 3600 * 1000 },
		{ now: t0 + 60000 }
	);
	assert.ok(r2.durationMs <= 60000 + svc.LIMITS.clockSlackMs);
});

test("two devices finishing the same worksheet advance placement only once", async () => {
	const { repo, kidActor, kid } = await setup();
	const pos = { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 };
	const a = await svc.startWorksheet(repo, kidActor, pos);
	const b = await svc.startWorksheet(repo, kidActor, pos);
	const ra = await svc.submitAttempt(repo, kidActor, { startToken: a.startToken, clientAttemptId: "device-a-000001", responses: a.sheet.problems.map((p) => [right(p)]) });
	const rb = await svc.submitAttempt(repo, kidActor, { startToken: b.startToken, clientAttemptId: "device-b-000001", responses: b.sheet.problems.map((p) => [right(p)]) });
	assert.equal(ra.outcome, OUTCOME.NEXT_WORKSHEET);
	assert.equal(rb.outcome, OUTCOME.REVIEW);
	assert.equal((await repo.getProgress(kid.id, "math")).worksheet_no, 2);
	assert.equal(repo._db.attempts.length, 2, "both attempts are kept");
});

test("placement: only authorised adults; adult learners only in adult mode; confirmation required", async () => {
	const { repo, parent, kid, kidActor } = await setup();
	const target = { levelId: "C", setId: "C-1", worksheetNo: 1 };
	await assert.rejects(svc.setPlacement(repo, parent, kid.id, "math", target, false), { code: "confirm_required" });
	await assert.rejects(svc.setPlacement(repo, account("stranger"), kid.id, "math", target, true), { status: 404 });
	await assert.rejects(svc.setPlacement(repo, kidActor, kid.id, "math", target, true), { status: 403 });
	await assert.rejects(svc.setPlacement(repo, parent, kid.id, "math", { levelId: "ZZ", setId: "ZZ-1", worksheetNo: 1 }, true), { code: "invalid" });
	await svc.setPlacement(repo, parent, kid.id, "math", target, true);
	assert.equal((await repo.getProgress(kid.id, "math")).level_id, "C");
	assert.ok(repo._db.audit.some((a) => a.action === "placement.change" && a.details.to.levelId === "C"));

	// Instructor linked by the parent may place, but not administer
	await svc.addGuardian(repo, parent, kid.id, "teacher@example.com", "instructor");
	await svc.setPlacement(repo, account("teacher", "instructor"), kid.id, "math", { levelId: "B", setId: "B-1", worksheetNo: 1 }, true);
	await assert.rejects(svc.resetPin(repo, account("teacher", "instructor"), kid.id, "9999"), { status: 403 });
	await assert.rejects(svc.setAdultMode(repo, account("teacher", "instructor"), kid.id, true), { status: 403 });

	// Learner cannot grant themself adult mode; once a parent does, self-placement works
	await assert.rejects(svc.setAdultMode(repo, kidActor, kid.id, true), { status: 403 });
	await svc.setAdultMode(repo, parent, kid.id, true);
	await svc.setPlacement(repo, kidActor, kid.id, "math", { levelId: "D", setId: "D-1", worksheetNo: 1 }, true);
	assert.equal((await repo.getProgress(kid.id, "math")).level_id, "D");
	// ...but never for another learner
	const other = await svc.createLearner(repo, parent, { displayName: "Ben", pin: "5555" });
	await assert.rejects(svc.setPlacement(repo, kidActor, other.id, "math", target, true), { status: 404 });

	// Admin with learners.manage_all can place any learner
	await svc.setPlacement(repo, account("admin", "admin"), kid.id, "math", target, true);
});

test("dashboard metrics come from persisted attempts", async () => {
	const { repo, parent, kid, kidActor } = await setup();
	await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 1 }, { durationMs: 60000 });
	await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 2 }, { wrongFirst: 2, durationMs: 90000 });
	const dash = await svc.learnerDashboard(repo, parent, kid.id);
	assert.equal(dash.stats.worksheets, 2);
	assert.equal(dash.recent.length, 2);
	assert.equal(dash.todayCount, 2);
	assert.equal(dash.habit.length, 21);
	assert.equal(dash.charts.day.at(-1).worksheets, 2);
	assert.ok(Math.abs(dash.stats.avgAccuracy - (1 + 6 / 8) / 2) < 1e-9);
	assert.equal(dash.streak.current, 1);
	await assert.rejects(svc.learnerDashboard(repo, account("stranger"), kid.id), { status: 404 });
});

test("removal and progress reset need typed confirmation", async () => {
	const { repo, parent, kid, kidActor } = await setup();
	await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 1 });
	await assert.rejects(svc.resetProgress(repo, parent, kid.id, null, "ava"), { code: "confirm_required" });
	await svc.resetProgress(repo, parent, kid.id, null, "Ava");
	assert.equal(repo._db.attempts.length, 0);
	assert.equal((await repo.getProgress(kid.id, "math")).worksheet_no, 1);
	await assert.rejects(svc.removeLearner(repo, parent, kid.id, "wrong"), { code: "confirm_required" });
	await assert.rejects(svc.removeLearner(repo, account("stranger"), kid.id, "Ava"), { status: 404 });
	await svc.removeLearner(repo, parent, kid.id, "Ava");
	assert.equal(await repo.getLearner(kid.id), null);
});

test("global reset needs permission, phrase and password", async () => {
	const { repo, kidActor } = await setup();
	await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 1 });
	await assert.rejects(svc.globalReset(repo, account("teacher", "instructor"), { phrase: svc.GLOBAL_RESET_PHRASE, passwordOk: true }), { status: 403 });
	await assert.rejects(svc.globalReset(repo, account("admin", "admin"), { phrase: "reset", passwordOk: true }), { code: "confirm_required" });
	await assert.rejects(svc.globalReset(repo, account("admin", "admin"), { phrase: svc.GLOBAL_RESET_PHRASE, passwordOk: false }), { code: "reauth_failed" });
	const r = await svc.globalReset(repo, account("admin", "admin"), { phrase: svc.GLOBAL_RESET_PHRASE, passwordOk: true });
	assert.equal(r.attempts, 1);
	assert.equal(repo._db.attempts.length, 0);
	assert.ok(repo._db.audit.some((a) => a.action === "system.global_reset"));
});

test("students without the Family role cannot create learners; learner actors never can", async () => {
	const repo = createMemoryRepo();
	await assert.rejects(svc.createLearner(repo, account("stranger"), { displayName: "Eve", pin: "1234" }), { status: 403 });
	await assert.rejects(svc.createLearner(repo, null, { displayName: "Eve", pin: "1234" }), { status: 401 });
	await assert.rejects(
		svc.createLearner(repo, { kind: "learner", learnerId: "x", accountUserId: "parent-1" }, { displayName: "Eve", pin: "1234" }),
		{ status: 403 }
	);
	const ok = await svc.createLearner(repo, account("teacher", "instructor"), { displayName: "Sam", pin: "1234" });
	assert.ok(ok.id);
	const viaRole = await svc.createLearner(repo, account("stranger", "student", ["learners.create"]), { displayName: "Kay", pin: "1234" });
	assert.ok(viaRole.id);
});

test("dashboard flags areas that need more practice", async () => {
	const { repo, parent, kid, kidActor } = await setup();
	let d = await svc.learnerDashboard(repo, parent, kid.id);
	assert.deepEqual(d.needsSupport, []);
	// Two imperfect attempts on the same worksheet
	await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 1 }, { wrongFirst: 2 });
	await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 1 }, { wrongFirst: 1 });
	d = await svc.learnerDashboard(repo, parent, kid.id);
	assert.equal(d.needsSupport.length, 1);
	assert.equal(d.needsSupport[0].setId, "7A-1");
	assert.equal(d.needsSupport[0].worksheetNo, 1);
	assert.ok(d.needsSupport[0].reasons.length >= 1);
	assert.ok(d.needsSupport[0].setTitle);
	// Strangers still cannot see it
	await assert.rejects(svc.learnerDashboard(repo, account("stranger"), kid.id), { status: 404 });
});

test("a student who merely owns a profile can view it but cannot manage, place, reset or remove", async () => {
	const { repo, kid, kidActor } = await setup();
	// Same owner id, but without the Family / learners.create standing.
	const student = account("parent-1", "student", []);
	const dash = await svc.learnerDashboard(repo, student, kid.id);
	assert.deepEqual([dash.access.place, dash.access.admin], [false, false]);
	assert.ok(dash.subjects.length > 0, "can still see subjects and placement");
	const target = { levelId: "7A", setId: "7A-1", worksheetNo: 3 };
	const denied = { status: 403 };
	await assert.rejects(svc.setPlacement(repo, student, kid.id, "math", target, true), denied);
	await assert.rejects(svc.setEnrolment(repo, student, kid.id, "english", false), denied);
	await assert.rejects(svc.updateLearner(repo, student, kid.id, { dailyGoal: 5 }), denied);
	await assert.rejects(svc.setAdultMode(repo, student, kid.id, true), denied);
	await assert.rejects(svc.resetPin(repo, student, kid.id, "9999"), denied);
	await assert.rejects(svc.resetProgress(repo, student, kid.id, null, "Ava"), denied);
	await assert.rejects(svc.removeLearner(repo, student, kid.id, "Ava"), denied);
	await assert.rejects(svc.addGuardian(repo, student, kid.id, "stranger@example.com", "parent"), denied);
	// Nothing changed
	assert.ok(await repo.getLearner(kid.id));
	assert.equal((await repo.getProgress(kid.id, "math")).worksheet_no, 1);
	// The learner themself (PIN session, not adult mode) cannot manage either
	await assert.rejects(svc.setPlacement(repo, kidActor, kid.id, "math", target, true), denied);
	await assert.rejects(svc.removeLearner(repo, kidActor, kid.id, "Ava"), { status: 403 });
	// Family/authorised owner keeps everything
	const family = account("parent-1", "student", ["learners.create"]);
	assert.equal((await svc.learnerDashboard(repo, family, kid.id)).access.admin, true);
	// Unrelated accounts cannot even see the learner
	await assert.rejects(svc.learnerDashboard(repo, account("stranger"), kid.id), { status: 404 });
});

test("dashboard insights come from persisted attempts and never mix learners", async () => {
	const { repo, parent, kid, kidActor } = await setup();
	let d = await svc.learnerDashboard(repo, parent, kid.id);
	assert.equal(d.attemptsConsidered, 0);
	assert.deepEqual(d.needsSupport, []);
	await doWorksheet(repo, kidActor, { levelId: "7A", setId: "7A-1", worksheetNo: 1 }); // success
	d = await svc.learnerDashboard(repo, parent, kid.id);
	assert.deepEqual(d.needsSupport, []);
	const other = await svc.createLearner(repo, parent, { displayName: "Ben", pin: "5555" });
	await doWorksheet(repo, { kind: "learner", learnerId: other.id, accountUserId: "parent-1" }, { levelId: "7A", setId: "7A-1", worksheetNo: 1 }, { wrongFirst: 3 });
	await doWorksheet(repo, { kind: "learner", learnerId: other.id, accountUserId: "parent-1" }, { levelId: "7A", setId: "7A-1", worksheetNo: 1 }, { wrongFirst: 2 });
	assert.equal((await svc.learnerDashboard(repo, parent, other.id)).needsSupport.length, 1);
	assert.deepEqual((await svc.learnerDashboard(repo, parent, kid.id)).needsSupport, [], "Ava is unaffected by Ben's attempts");
});
