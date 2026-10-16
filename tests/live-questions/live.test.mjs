import test from "node:test";
import assert from "node:assert/strict";
import * as lq from "../../lib/live-questions/service.js";
import { createLiveRepo } from "./memoryRepo.mjs";

const actor = (userId, role = "student") => ({ userId, role });
const T0 = new Date("2026-10-14T10:00:00Z");
const at = (sec) => new Date(T0.getTime() + sec * 1000);

function setup() {
	const repo = createLiveRepo();
	repo._db.courses.push(
		{ id: "c1", slug: "math-live", title: "Math", userId: "teacher" },
		{ id: "c2", slug: "art-live", title: "Art", userId: "teacher2" }
	);
	repo._db.users.push(
		{ id: "s1", name: "Ann A" },
		{ id: "s2", name: "Bo B" },
		{ id: "s3", name: "Cy C" },
		{ id: "outsider", name: "Zed" },
		{ id: "s9", name: "Art Kid" }
	);
	for (const id of ["s1", "s2", "s3"]) repo._db.enrolments.push({ userId: id, courseId: "c1" });
	repo._db.enrolments.push({ userId: "s9", courseId: "c2" });
	return repo;
}
const input = (extra = {}) => ({ text: "2 + 2 = ?", options: ["3", "4", "5"], correctIndex: 1, explanation: "Two plus two is four.", ...extra });
const teacher = actor("teacher", "instructor");

async function openQ(repo, extra = {}, now = T0) {
	return lq.createQuestion(repo, teacher, "math-live", input({ publish: true, ...extra }), now);
}

test("only the course instructor (or an admin) can create and control questions", async () => {
	const repo = setup();
	for (const who of [actor("s1"), actor("outsider"), actor("teacher2", "instructor")]) {
		await assert.rejects(lq.createQuestion(repo, who, "math-live", input()), { status: 403 }, `create as ${who.userId}`);
	}
	await assert.rejects(lq.createQuestion(repo, null, "math-live", input()), { status: 401 });
	await assert.rejects(lq.createQuestion(repo, teacher, "nope", input()), { status: 404 });
	const q = await lq.createQuestion(repo, teacher, "math-live", input());
	assert.equal(q.status, "draft");
	for (const fn of [lq.publishQuestion, lq.closeQuestion, lq.revealQuestion, lq.publishResults]) {
		await assert.rejects(fn(repo, actor("s1"), "math-live", q.id), { status: 403 });
	}
	await assert.rejects(lq.listResults(repo, actor("s1"), "math-live"), { status: 403 });
	const admin = await lq.createQuestion(repo, actor("root", "admin"), "math-live", input());
	assert.equal(admin.seq, 2);
});

test("validation: options, correct answer, countdown", async () => {
	const repo = setup();
	const bad = [
		{ text: "" },
		{ options: ["only one"] },
		{ options: ["a", "a"] },
		{ options: ["a", " "] },
		{ correctIndex: 9 },
		{ durationSec: 1 },
		{ durationSec: 99999 },
		{ options: ["1", "2", "3", "4", "5", "6", "7"] },
	];
	for (const b of bad) await assert.rejects(lq.createQuestion(repo, teacher, "math-live", input(b)), { status: 422 }, JSON.stringify(b));
});

test("students receive the question without the correct answer", async () => {
	const repo = setup();
	await openQ(repo);
	const s = await lq.getState(repo, actor("s1"), "math-live", at(1));
	assert.equal(s.role, "student");
	assert.equal(s.current.status, "open");
	assert.equal(s.current.text, "2 + 2 = ?");
	const json = JSON.stringify(s);
	assert.ok(!/correct/i.test(json), "no correctOptionId / isCorrect while open");
	assert.ok(!json.includes("Two plus two"), "explanation hidden");
	assert.equal(s.current.myAnswer, null);
});

test("answers are stored per student; counts and pending update for the instructor", async () => {
	const repo = setup();
	const q = await openQ(repo);
	const r1 = await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(2));
	assert.deepEqual([r1.received, r1.duplicate, r1.optionId], [true, false, "o2"]);
	assert.equal(r1.isCorrect, undefined, "receipt never reveals correctness");
	await lq.submitAnswer(repo, actor("s2"), "math-live", q.id, "o1", at(3));
	const st = await lq.getState(repo, teacher, "math-live", at(4));
	assert.deepEqual(st.current.totals, { enrolled: 3, answered: 2, correct: 1 });
	assert.deepEqual(st.current.distribution, [
		{ optionId: "o1", count: 1 },
		{ optionId: "o2", count: 1 },
		{ optionId: "o3", count: 0 },
	]);
	assert.deepEqual(st.current.pending.map((p) => p.name), ["Cy C"]);
	assert.equal(st.current.correctOptionId, "o2");
	assert.equal(repo._db.responses.length, 2);
	const mine = await lq.getState(repo, actor("s1"), "math-live", at(5));
	assert.equal(mine.current.myAnswer.optionId, "o2");
});

test("duplicate submissions do not create duplicate rows; changing needs allowChange", async () => {
	const repo = setup();
	const q = await openQ(repo);
	await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(2));
	const again = await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(3));
	assert.equal(again.duplicate, true);
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o1", at(4)), { code: "already_answered" });
	assert.equal(repo._db.responses.length, 1);

	const q2 = await openQ(repo, { allowChange: true }, at(10));
	await lq.submitAnswer(repo, actor("s1"), "math-live", q2.id, "o1", at(11));
	const changed = await lq.submitAnswer(repo, actor("s1"), "math-live", q2.id, "o2", at(12));
	assert.equal(changed.duplicate, false);
	assert.equal(repo._db.responses.filter((r) => r.live_question_id === q2.id).length, 1);
	assert.equal(repo._db.responses.find((r) => r.live_question_id === q2.id).is_correct, true);
});

test("a lost insert race (unique index) is treated as a duplicate, not an error", async () => {
	const repo = setup();
	const q = await openQ(repo);
	await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(2));
	// Simulate the other tab's insert landing between our read and our write.
	const real = repo.getResponse.bind(repo);
	let calls = 0;
	repo.getResponse = async (...a) => (calls++ === 0 ? null : real(...a));
	const r = await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(3));
	assert.equal(r.duplicate, true);
	assert.equal(repo._db.responses.length, 1);
	calls = 0;
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o1", at(3)), { code: "already_answered" });
});

test("late and closed submissions are rejected using the server clock", async () => {
	const repo = setup();
	const q = await openQ(repo, { durationSec: 30 });
	await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(29));
	await assert.rejects(lq.submitAnswer(repo, actor("s2"), "math-live", q.id, "o2", at(31)), { code: "closed" });
	const st = await lq.getState(repo, teacher, "math-live", at(32));
	assert.equal(st.current.status, "closed", "deadline closes the question server-side");
	assert.equal(repo._db.responses.length, 1);

	const q2 = await openQ(repo, {}, at(100));
	await lq.closeQuestion(repo, teacher, "math-live", q2.id, at(101));
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), "math-live", q2.id, "o2", at(102)), { code: "closed" });
});

test("correct answer stays hidden until reveal; distribution only after publishing results", async () => {
	const repo = setup();
	const q = await openQ(repo);
	await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(2));
	await lq.submitAnswer(repo, actor("s2"), "math-live", q.id, "o3", at(3));
	await lq.closeQuestion(repo, teacher, "math-live", q.id, at(4));
	let s = (await lq.getState(repo, actor("s2"), "math-live", at(5))).current;
	assert.equal(s.status, "closed");
	assert.equal(s.correctOptionId, undefined);
	assert.equal(s.results, undefined);
	assert.equal(s.myAnswer.isCorrect, undefined);

	await lq.publishResults(repo, teacher, "math-live", q.id, at(6));
	s = (await lq.getState(repo, actor("s2"), "math-live", at(7))).current;
	assert.deepEqual(s.results.distribution, [
		{ optionId: "o1", count: 0 },
		{ optionId: "o2", count: 1 },
		{ optionId: "o3", count: 1 },
	]);
	assert.equal(s.correctOptionId, undefined, "results do not reveal the answer");
	assert.equal(JSON.stringify(s).includes("Ann"), false, "no names in student results");

	await lq.revealQuestion(repo, teacher, "math-live", q.id, at(8));
	s = (await lq.getState(repo, actor("s2"), "math-live", at(9))).current;
	assert.equal(s.status, "revealed");
	assert.equal(s.correctOptionId, "o2");
	assert.equal(s.explanation, "Two plus two is four.");
	assert.equal(s.myAnswer.isCorrect, false);
	const s1 = (await lq.getState(repo, actor("s1"), "math-live", at(9))).current;
	assert.equal(s1.myAnswer.isCorrect, true);
});

test("revealing an open question closes it first", async () => {
	const repo = setup();
	const q = await openQ(repo, { durationSec: 600 });
	await lq.revealQuestion(repo, teacher, "math-live", q.id, at(5));
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(6)), { code: "closed" });
	assert.equal(repo._db.questions[0].status, "revealed");
});

test("launching the next question closes the previous one and keeps history", async () => {
	const repo = setup();
	const q1 = await openQ(repo);
	await lq.submitAnswer(repo, actor("s1"), "math-live", q1.id, "o2", at(1));
	const q2 = await openQ(repo, { text: "3 + 3 = ?", options: ["5", "6"], correctIndex: 1 }, at(20));
	assert.equal(repo._db.questions.find((q) => q.id === q1.id).status, "closed");
	await assert.rejects(lq.submitAnswer(repo, actor("s2"), "math-live", q1.id, "o2", at(21)), { code: "closed" });
	const s = await lq.getState(repo, actor("s2"), "math-live", at(22));
	assert.equal(s.current.id, q2.id);
	const st = await lq.getState(repo, teacher, "math-live", at(22));
	assert.deepEqual(st.history.map((h) => h.seq), [1, 2]);
	await assert.rejects(lq.publishQuestion(repo, teacher, "math-live", q2.id, at(23)), { status: 409 }, "cannot publish twice");
});

test("drafts are invisible to students and can be deleted", async () => {
	const repo = setup();
	const d = await lq.createQuestion(repo, teacher, "math-live", input());
	assert.equal((await lq.getState(repo, actor("s1"), "math-live", at(1))).current, null);
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), "math-live", d.id, "o2", at(1)), { status: 404 });
	assert.equal((await lq.getState(repo, teacher, "math-live", at(1))).drafts.length, 1);
	await lq.deleteDraft(repo, teacher, "math-live", d.id);
	assert.equal(repo._db.questions.length, 0);
	const open = await openQ(repo);
	await assert.rejects(lq.deleteDraft(repo, teacher, "math-live", open.id), { status: 409 });
});

test("classes are isolated: no cross-class state, answers or control", async () => {
	const repo = setup();
	const q = await openQ(repo);
	await assert.rejects(lq.getState(repo, actor("s9"), "math-live", at(1)), { status: 403 });
	await assert.rejects(lq.submitAnswer(repo, actor("s9"), "math-live", q.id, "o2", at(1)), { status: 403 });
	// Using this class's question id through another class is a 404, not a leak.
	repo._db.enrolments.push({ userId: "s1", courseId: "c2" });
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), "art-live", q.id, "o2", at(1)), { status: 404 });
	await assert.rejects(lq.revealQuestion(repo, actor("teacher2", "instructor"), "art-live", q.id, at(1)), { status: 404 });
	await assert.rejects(lq.revealQuestion(repo, actor("teacher2", "instructor"), "math-live", q.id, at(1)), { status: 403 });
	assert.equal((await lq.getState(repo, actor("s1"), "art-live", at(2))).current, null);
	assert.equal(repo._db.responses.length, 0);
});

test("instructors and admins cannot answer; invalid options are rejected", async () => {
	const repo = setup();
	const q = await openQ(repo);
	await assert.rejects(lq.submitAnswer(repo, teacher, "math-live", q.id, "o2", at(1)), { status: 403 });
	await assert.rejects(lq.submitAnswer(repo, actor("root", "admin"), "math-live", q.id, "o2", at(1)), { status: 403 });
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o99", at(1)), { status: 422 });
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), "math-live", q.id, undefined, at(1)), { status: 422 });
	await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(1));
	assert.equal(repo._db.responses[0].user_id, "s1", "identity comes only from the authenticated actor");
});

test("reconnecting returns the same state and never duplicates responses", async () => {
	const repo = setup();
	const q = await openQ(repo, { durationSec: 60 });
	await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(2));
	for (let i = 0; i < 5; i++) {
		const s = (await lq.getState(repo, actor("s1"), "math-live", at(3 + i))).current;
		assert.equal(s.myAnswer.optionId, "o2");
		assert.equal(s.deadlineAt, new Date(T0.getTime() + 60000).toISOString());
	}
	await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(10)); // client retry after reconnect
	assert.equal(repo._db.responses.length, 1);
});

test("saved results: instructor review and a student's own results only", async () => {
	const repo = setup();
	const q = await openQ(repo);
	await lq.submitAnswer(repo, actor("s1"), "math-live", q.id, "o2", at(1));
	await lq.submitAnswer(repo, actor("s2"), "math-live", q.id, "o1", at(2));
	const before = await lq.myResults(repo, actor("s1"), "math-live");
	assert.equal(before.total, 0, "nothing is shown before the reveal");
	await lq.revealQuestion(repo, teacher, "math-live", q.id, at(3));
	const mine = await lq.myResults(repo, actor("s2"), "math-live");
	assert.deepEqual([mine.total, mine.correct], [1, 0]);
	assert.equal(JSON.stringify(mine).includes("Ann"), false);
	const review = await lq.listResults(repo, teacher, "math-live", at(4));
	assert.equal(review.questions[0].answered.length, 2);
	assert.equal(review.questions[0].answered.find((a) => a.name === "Ann A").isCorrect, true);
	await assert.rejects(lq.myResults(repo, teacher, "math-live"), { status: 403 });
});

test("existing quiz questions can be imported (single correct answer only)", async () => {
	const repo = setup();
	repo._db.quizQuestions.push(
		{ id: "x1", quizTitle: "Quiz 1", instructorId: "teacher", text: "Capital of France?", options: [{ text: "Paris", isCorrect: true }, { text: "Rome", isCorrect: false }] },
		{ id: "x2", quizTitle: "Quiz 1", instructorId: "teacher", text: "Multi", options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: true }] },
		{ id: "x3", quizTitle: "Other", instructorId: "teacher2", text: "Not mine", options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: false }] }
	);
	const r = await lq.importableQuestions(repo, teacher, "math-live");
	assert.deepEqual(r.questions.map((q) => q.id), ["x1"]);
	assert.equal(r.questions[0].correctIndex, 0);
	await assert.rejects(lq.importableQuestions(repo, actor("s1"), "math-live"), { status: 403 });
});
