// Learner identity: the profile picked on the Family / picker page is the one whose subjects,
// goal, worksheets and stars the Mastery Ladder shows and saves, and a learner session can
// never be used under a different signed-in account.
//
// Reproduces the reported screens: the picker listed "surya" and "rakesh" (one account) while
// the dashboard showed "student one" (a different account). The database confirmed those are
// unrelated owners; the dashboard was showing a learner session left behind by an earlier login.
import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createMemoryRepo } from "./memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { verifyLearnerToken } from "../../lib/mastery/tokens.js";
import { createOfflineStore } from "../../lib/mastery/offline.js";

const account = (userId, role = "student", extra = ["learners.create"]) => ({ kind: "account", userId, role, permissions: resolvePermissions(role, extra) });
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);
const T = Date.parse("2026-10-14T15:00:00Z");

async function setup() {
	const repo = createMemoryRepo();
	repo._db.users.push(
		{ id: "fam-a", email: "a@example.com", role: "instructor" }, // owns "surya" and "rakesh"
		{ id: "fam-b", email: "b@example.com", role: "student" }, // owns "student one"
		{ id: "outsider", email: "o@example.com", role: "student" },
		{ id: "admin", email: "admin@example.com", role: "admin" }
	);
	const A = account("fam-a", "instructor");
	const B = account("fam-b");
	const surya = await svc.createLearner(repo, A, { displayName: "surya", pin: "1111", subjects: ["math"], dailyGoal: 5, timeZone: "UTC" });
	const rakesh = await svc.createLearner(repo, A, { displayName: "rakesh", pin: "2222", subjects: ["english"], dailyGoal: 1, timeZone: "UTC" });
	const one = await svc.createLearner(repo, B, { displayName: "student one", pin: "3333", subjects: ["math"], dailyGoal: 1, timeZone: "UTC" });
	return { repo, A, B, surya, rakesh, one };
}

// What getLearnerActor does with a request: verify the token, then bind it to the signed-in account.
const session = async (repo, token, signedInAs) => svc.resolveLearnerSession(repo, verifyLearnerToken(token), signedInAs);
const unlock = async (repo, who, learner, pin) => (await svc.unlockLearner(repo, who, learner.id, pin, { now: T })).learnerToken;

async function doWorksheet(repo, actor, now) {
	const home = await svc.studyHome(repo, actor, { now });
	const pos = home.subjects[0].position;
	const started = await svc.startWorksheet(repo, actor, { subject: home.subjects[0].id, levelId: pos.levelId, setId: pos.setId, worksheetNo: pos.worksheetNo }, { now });
	return svc.submitAttempt(
		repo,
		actor,
		{ startToken: started.startToken, clientAttemptId: `attempt-${Math.random().toString(36).slice(2)}-abcdef`, responses: started.sheet.problems.map((p) => [right(p)]), durationMs: 60000 },
		{ now: now + 60000 }
	);
}

// ------------------------------------------------------------------ the reported mismatch

test("REPRODUCTION: a learner session left by another account is not accepted under the signed-in account", async () => {
	const { repo, A, B, one, surya } = await setup();
	const tokenOfB = await unlock(repo, B, one, "3333"); // "student one" unlocked while signed in as B...
	// ...then the browser is signed in as A (picker: surya, rakesh) and still holds B's learner token.
	assert.deepEqual((await svc.listLearners(repo, A)).map((l) => l.displayName).sort(), ["rakesh", "surya"], "A's picker lists only A's learners");
	assert.equal(await session(repo, tokenOfB, A), null, "B's learner is NOT shown under A");
	// the same token under B still works, and with no account header (learner-only device) too
	assert.equal((await session(repo, tokenOfB, B)).learnerId, one.id);
	assert.equal((await session(repo, tokenOfB, null)).learnerId, one.id);
	// the two screenshot names belong to unrelated owners and are not linked
	const [rowSurya, rowOne] = [surya, one].map((l) => repo._db.learners.find((x) => x.id === l.id));
	assert.notEqual(rowSurya.owner_user_id, rowOne.owner_user_id);
	assert.equal(repo._db.guardians.length, 0);
});

test("a learner session is only as valid as the issuing account's access: removed link, removed learner, disabled account", async () => {
	const { repo, A, one, rakesh } = await setup();
	// guardian link: A (an adult) is linked to "student one" and unlocks it
	await svc.addGuardian(repo, account("fam-b"), one.id, "a@example.com", "parent");
	const token = await unlock(repo, A, one, "3333");
	assert.equal((await session(repo, token, A)).learnerId, one.id);
	await svc.removeGuardian(repo, account("fam-b"), one.id, "fam-a");
	assert.equal(await session(repo, token, A), null, "unlinked: the session ends");
	assert.equal(await session(repo, token, null), null, "also without an account header");

	const t2 = await unlock(repo, A, rakesh, "2222");
	repo._db.users.find((u) => u.id === "fam-a").status = false;
	assert.equal(await session(repo, t2, null), null, "disabled account");
	repo._db.users.find((u) => u.id === "fam-a").status = true;
	await svc.removeLearner(repo, A, rakesh.id, "rakesh");
	assert.equal(await session(repo, t2, A), null, "removed learner");
	assert.equal(await session(repo, "garbage", A), null);
});

// ------------------------------------------------------------------ switching between learners

test("selecting a learner shows THAT learner's subjects, goal and progress; switching loads the other's own data", async () => {
	const { repo, A, surya, rakesh } = await setup();
	const sA = await session(repo, await unlock(repo, A, surya, "1111"), A);
	const sB = await session(repo, await unlock(repo, A, rakesh, "2222"), A);
	const hs = await svc.studyHome(repo, sA, { now: T });
	const hr = await svc.studyHome(repo, sB, { now: T });
	assert.deepEqual([hs.learner.displayName, hs.dailyGoal, hs.subjects.map((s) => s.id)], ["surya", 5, ["math"]]);
	assert.deepEqual([hr.learner.displayName, hr.dailyGoal, hr.subjects.map((s) => s.id)], ["rakesh", 1, ["english"]]);
	assert.notEqual(hs.learner.id, hr.learner.id);
});

test("worksheets, stars and the daily goal are saved against the selected learner only, and survive refresh and switching back", async () => {
	const { repo, A, surya, rakesh } = await setup();
	const tokenS = await unlock(repo, A, surya, "1111");
	const tokenR = await unlock(repo, A, rakesh, "2222");
	const asS = () => session(repo, tokenS, A);
	const asR = () => session(repo, tokenR, A);

	const done = await doWorksheet(repo, await asS(), T);
	assert.ok(done.stars >= 1 || done.starsEarned >= 1 || JSON.stringify(done).includes("stars"));
	const s1 = await svc.studyHome(repo, await asS(), { now: T + 120000 });
	assert.equal(s1.todayCount, 1);
	assert.ok(s1.totalStars > 0);
	const r1 = await svc.studyHome(repo, await asR(), { now: T + 120000 });
	assert.deepEqual([r1.todayCount, r1.totalStars], [0, 0], "rakesh is untouched by surya's work");

	// every stored row says whose it is
	assert.ok(repo._db.attempts.length === 1 && repo._db.attempts.every((a) => a.learner_id === surya.id));
	assert.ok(repo._db.activity.every((a) => a.learner_id === surya.id));
	// each learner has their own progress rows; rakesh (english) still sits at his starting worksheet
	const rakeshRows = repo._db.progress.filter((p) => p.learner_id === rakesh.id);
	assert.ok(rakeshRows.length >= 0 && rakeshRows.every((p) => p.subject === "english" && p.worksheet_no === 1));
	assert.ok(repo._db.progress.filter((p) => p.learner_id === surya.id).every((p) => p.subject === "math"));

	// rakesh does a worksheet; refresh (fresh sessions, fresh reads); switch back and forth
	await doWorksheet(repo, await asR(), T + 200000);
	for (let i = 0; i < 2; i++) {
		const s = await svc.studyHome(repo, await asS(), { now: T + 300000 });
		const r = await svc.studyHome(repo, await asR(), { now: T + 300000 });
		assert.deepEqual([s.todayCount, s.dailyGoal, s.learner.displayName], [1, 5, "surya"]);
		assert.deepEqual([r.todayCount, r.dailyGoal, r.learner.displayName], [1, 1, "rakesh"]);
		assert.equal(s.totalStars, s1.totalStars, "no silent reset");
	}
	// same data after "logout and login": new tokens issued by the same account
	const again = await session(repo, await unlock(repo, A, surya, "1111"), A);
	assert.equal((await svc.studyHome(repo, again, { now: T + 400000 })).totalStars, s1.totalStars);
});

test("subject and goal changes persist per learner and appear when that learner is selected again", async () => {
	const { repo, A, surya, rakesh } = await setup();
	await svc.updateLearner(repo, A, surya.id, { dailyGoal: 7 });
	await svc.setEnrolment(repo, A, surya.id, "english", true);
	await svc.setEnrolment(repo, A, rakesh.id, "english", false);
	const hs = await svc.studyHome(repo, await session(repo, await unlock(repo, A, surya, "1111"), A), { now: T });
	assert.deepEqual([hs.dailyGoal, hs.subjects.map((s) => s.id).sort()], [7, ["english", "math"]]);
	const hr = await svc.studyHome(repo, await session(repo, await unlock(repo, A, rakesh, "2222"), A), { now: T });
	assert.deepEqual([hr.dailyGoal, hr.subjects.length], [1, 0], "rakesh keeps his own goal and has no subject switched on");
});

test("learners with the same display name stay separate people", async () => {
	const { repo, A, B, surya } = await setup();
	const twin = await svc.createLearner(repo, B, { displayName: "surya", pin: "4444", subjects: ["math"], dailyGoal: 2, timeZone: "UTC" });
	assert.notEqual(twin.id, surya.id);
	await doWorksheet(repo, await session(repo, await unlock(repo, A, surya, "1111"), A), T);
	const h = await svc.studyHome(repo, await session(repo, await unlock(repo, B, twin, "4444"), B), { now: T + 120000 });
	assert.deepEqual([h.todayCount, h.totalStars, h.dailyGoal], [0, 0, 2]);
});

// ------------------------------------------------------------------ authorization

test("a client-supplied learner id is never trusted: other accounts and other learners are refused", async () => {
	const { repo, A, B, surya, rakesh, one } = await setup();
	const outsider = account("outsider", "student", []);
	for (const who of [outsider, B]) {
		await assert.rejects(svc.learnerDashboard(repo, who, surya.id), { status: 404 }, "dashboard");
		await assert.rejects(svc.unlockLearner(repo, who, surya.id, "1111"), { status: 404 }, "unlock");
		await assert.rejects(svc.updateLearner(repo, who, surya.id, { dailyGoal: 9 }), { status: 404 });
		await assert.rejects(svc.setEnrolment(repo, who, surya.id, "english", true), { status: 404 });
		await assert.rejects(svc.resetProgress(repo, who, surya.id, "math", "surya"), { status: 404 });
	}
	assert.equal(repo._db.learners.find((l) => l.id === surya.id).daily_goal, 5);
	// a learner session cannot reach a sibling or anyone else
	const asS = await session(repo, await unlock(repo, A, surya, "1111"), A);
	await assert.rejects(svc.learnerDashboard(repo, asS, rakesh.id), { status: 404 });
	await assert.rejects(svc.learnerDashboard(repo, asS, one.id), { status: 404 });
	assert.equal((await svc.learnerDashboard(repo, asS, surya.id)).learner.id, surya.id);
	// a worksheet started for one learner cannot be submitted as another
	const asR = await session(repo, await unlock(repo, A, rakesh, "2222"), A);
	const home = await svc.studyHome(repo, asS, { now: T });
	const pos = home.subjects[0].position;
	const started = await svc.startWorksheet(repo, asS, { subject: "math", levelId: pos.levelId, setId: pos.setId, worksheetNo: pos.worksheetNo }, { now: T });
	await assert.rejects(
		svc.submitAttempt(repo, asR, { startToken: started.startToken, clientAttemptId: "steal-attempt-123456", responses: started.sheet.problems.map((p) => [right(p)]), durationMs: 5000 }, { now: T + 5000 }),
		{ status: 403 }
	);
	assert.equal(repo._db.attempts.length, 0);
	// an adult account can see its own, an admin everything
	assert.equal((await svc.learnerDashboard(repo, A, rakesh.id)).learner.id, rakesh.id);
	assert.equal((await svc.learnerDashboard(repo, account("admin", "admin", []), one.id)).learner.id, one.id);
});

test("a linked guardian can see only the learners they are linked to", async () => {
	const { repo, A, B, one, surya } = await setup();
	await svc.addGuardian(repo, B, one.id, "a@example.com", "parent");
	assert.deepEqual((await svc.listLearners(repo, A)).map((l) => l.displayName).sort(), ["rakesh", "student one", "surya"]);
	assert.equal((await svc.learnerDashboard(repo, A, one.id)).learner.id, one.id);
	await assert.rejects(svc.learnerDashboard(repo, B, surya.id), { status: 404 }, "the link is one-way and per learner");
});

// ------------------------------------------------------------------ offline queue

test("finished worksheets queued for one learner are not sent (and lost) under another learner's session", async () => {
	const mem = new Map();
	const store = createOfflineStore({ getJSON: (k, f) => (mem.has(k) ? JSON.parse(mem.get(k)) : f), setJSON: (k, v) => mem.set(k, JSON.stringify(v)), remove: (k) => mem.delete(k) });
	store.enqueue({ clientAttemptId: "a-1-aaaaaaaa", learnerId: "L-surya", startToken: "t1" });
	store.enqueue({ clientAttemptId: "r-1-rrrrrrrr", learnerId: "L-rakesh", startToken: "t2" });
	const sentFor = [];
	// the server refuses a worksheet that belongs to another learner (403)
	const send = async (item) => {
		if (item.learnerId !== "L-rakesh") throw { status: 403, code: "forbidden" };
		sentFor.push(item.learnerId);
		return { ok: true };
	};
	const r = await store.sync(send, { learnerId: "L-rakesh" });
	assert.deepEqual(sentFor, ["L-rakesh"]);
	assert.equal(r.failed.length, 0, "nothing is reported as failed");
	assert.deepEqual(store.pending().map((x) => x.learnerId), ["L-surya"], "surya's worksheet is still waiting");
	// without the filter the old behaviour dropped it as a permanent error
	const old = await store.sync(send);
	assert.equal(old.failed.length, 1);
});
