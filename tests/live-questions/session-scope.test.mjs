// Live questions linked to a scheduled live session (as opposed to the original
// course-level class, which live.test.mjs still covers).
import test from "node:test";
import assert from "node:assert/strict";
import * as lq from "../../lib/live-questions/service.js";
import { createLiveRepo } from "./memoryRepo.mjs";

const actor = (userId, role = "student") => ({ userId, role });
const T0 = new Date("2026-10-21T12:00:00Z");
const at = (sec) => new Date(T0.getTime() + sec * 1000);
const teacher = actor("t1", "instructor");
const SA = "11111111-1111-4111-8111-111111111111"; // session A (live)
const SB = "22222222-2222-4222-8222-222222222222"; // session B (live), same course
const SC = "33333333-3333-4333-8333-333333333333"; // session C (scheduled, not started)

function setup() {
	const repo = createLiveRepo();
	repo._db.courses.push({ id: "c1", slug: "math-live", title: "Math", userId: "t1" });
	repo._db.users.push({ id: "s1", name: "Ann" }, { id: "s2", name: "Bo" }, { id: "s3", name: "Cy" });
	for (const u of ["s1", "s2", "s3"]) repo._db.enrolments.push({ userId: u, courseId: "c1", status: "paid" });
	const mk = (id, status) => ({ id, course_id: "c1", instructor_id: "t1", status });
	repo._db.sessions.push(mk(SA, "live"), mk(SB, "live"), mk(SC, "scheduled"));
	const seat = (cls, u) => repo._db.seats.push({ class_id: cls, participant_key: `u:${u}`, user_id: u, display_name: u });
	seat(SA, "s1");
	seat(SA, "s2");
	seat(SB, "s3");
	return repo;
}
const q = (extra = {}) => ({ text: "2 + 2 = ?", options: ["3", "4", "5"], correctIndex: 1, publish: true, ...extra });

test("the instructor publishes into a session and only that session's participants see it", async () => {
	const repo = setup();
	const pub = await lq.createQuestion(repo, teacher, SA, q(), T0);
	assert.equal(pub.status, "open");
	assert.equal(repo._db.questions[0].class_id, SA, "linked to the session");
	assert.equal((await lq.getState(repo, actor("s1"), SA, at(1))).current.text, "2 + 2 = ?");
	assert.equal((await lq.getState(repo, actor("s2"), SA, at(1))).current.id, pub.id);
	// session B (same course) has no question, even though the course does
	assert.equal((await lq.getState(repo, actor("s3"), SB, at(1))).current, null);
	assert.equal((await lq.getState(repo, teacher, SB, at(1))).current, null);
	assert.equal(pub.totals.enrolled, 2, "participants are the session's seat holders");
});

test("yesterday's question never shows up in another session or in the course-level class", async () => {
	const repo = setup();
	await lq.createQuestion(repo, teacher, SA, q(), T0);
	assert.equal((await lq.getState(repo, teacher, "math-live", at(1))).current, null);
	assert.equal((await lq.getState(repo, actor("s1"), "math-live", at(1))).current, null);
	// numbering restarts per session
	const first = await lq.createQuestion(repo, teacher, SB, q(), at(2));
	assert.equal(first.seq, 1);
});

test("a question id cannot be used through another session", async () => {
	const repo = setup();
	const pub = await lq.createQuestion(repo, teacher, SA, q(), T0);
	await assert.rejects(lq.closeQuestion(repo, teacher, SB, pub.id, at(1)), { status: 404 });
	await assert.rejects(lq.submitAnswer(repo, actor("s3"), SB, pub.id, "o2", at(1)), { status: 404 });
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), "math-live", pub.id, "o2", at(1)), { status: 404 });
});

test("non-participants cannot read, answer or manage a session's questions", async () => {
	const repo = setup();
	const pub = await lq.createQuestion(repo, teacher, SA, q(), T0);
	// s3 is enrolled in the course but holds no seat in session A
	await assert.rejects(lq.getState(repo, actor("s3"), SA, at(1)), { status: 404 });
	await assert.rejects(lq.submitAnswer(repo, actor("s3"), SA, pub.id, "o2", at(1)), { status: 404 });
	await assert.rejects(lq.myResults(repo, actor("s3"), SA), { status: 404 });
	await assert.rejects(lq.getState(repo, null, SA, at(1)), { status: 401 });
	// a seat holder who lost their paid enrolment is out
	repo._db.enrolments = repo._db.enrolments.filter((e) => e.userId !== "s2");
	await assert.rejects(lq.getState(repo, actor("s2"), SA, at(1)), { status: 404 });
	// students never manage
	for (const fn of [lq.publishQuestion, lq.closeQuestion, lq.revealQuestion, lq.publishResults]) {
		await assert.rejects(fn(repo, actor("s1"), SA, pub.id), { status: 403 });
	}
	await assert.rejects(lq.createQuestion(repo, actor("s1"), SA, q()), { status: 403 });
	await assert.rejects(lq.listResults(repo, actor("s1"), SA), { status: 403 });
	// another instructor does not own the session
	await assert.rejects(lq.createQuestion(repo, actor("t2", "instructor"), SA, q()), { status: 404 });
	await assert.rejects(lq.getState(repo, actor("unknown"), "99999999-9999-4999-8999-999999999999", at(1)), { status: 404 });
});

test("full flow inside a session: answer, duplicate, late, close, reveal, results persist", async () => {
	const repo = setup();
	const pub = await lq.createQuestion(repo, teacher, SA, q({ durationSec: 30 }), T0);
	const receipt = await lq.submitAnswer(repo, actor("s1"), SA, pub.id, "o2", at(5));
	assert.deepEqual([receipt.received, receipt.duplicate], [true, false]);
	assert.equal((await lq.submitAnswer(repo, actor("s1"), SA, pub.id, "o2", at(6))).duplicate, true, "a retry is a harmless duplicate");
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), SA, pub.id, "o1", at(7)), { status: 409, code: "already_answered" });
	await assert.rejects(lq.submitAnswer(repo, actor("s2"), SA, pub.id, "o2", at(31)), { status: 409 }, "late");
	assert.equal(repo._db.responses.length, 1);
	await lq.publishResults(repo, teacher, SA, pub.id, at(32));
	const rev = await lq.revealQuestion(repo, teacher, SA, pub.id, at(33));
	assert.equal(rev.totals.answered, 1);
	const mine = await lq.myResults(repo, actor("s1"), SA);
	assert.equal(mine.correct, 1);
	assert.equal((await lq.listResults(repo, teacher, SA, at(34))).questions.length, 1);
	assert.equal((await lq.listResults(repo, teacher, SB, at(34))).questions.length, 0, "results are per session");
});

test("questions follow the session's lifecycle", async () => {
	const repo = setup();
	await assert.rejects(lq.createQuestion(repo, teacher, SC, q()), { status: 409, code: "not_live" });
	const draft = await lq.createQuestion(repo, teacher, SC, q({ publish: false }));
	assert.equal(draft.status, "draft", "drafts can be prepared before the session starts");
	await assert.rejects(lq.publishQuestion(repo, teacher, SC, draft.id), { status: 409, code: "not_live" });

	const pub = await lq.createQuestion(repo, teacher, SA, q(), T0);
	repo._db.sessions.find((s) => s.id === SA).status = "completed";
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), SA, pub.id, "o2", at(5)), { status: 409 });
	const state = await lq.getState(repo, actor("s1"), SA, at(6));
	assert.equal(state.session.status, "completed", "results stay readable after the session");
	repo._db.sessions.find((s) => s.id === SA).status = "cancelled";
	await assert.rejects(lq.submitAnswer(repo, actor("s1"), SA, pub.id, "o2", at(5)), { status: 409 });
});

test("simultaneous answers from different students are all kept exactly once", async () => {
	const repo = setup();
	repo._db.seats.push({ class_id: SA, participant_key: "u:s3", user_id: "s3", display_name: "s3" });
	const pub = await lq.createQuestion(repo, teacher, SA, q(), T0);
	await Promise.all([
		...["s1", "s2", "s3"].map((u) => lq.submitAnswer(repo, actor(u), SA, pub.id, "o2", at(2))),
		...["s1", "s2", "s3"].map((u) => lq.submitAnswer(repo, actor(u), SA, pub.id, "o2", at(2))),
	]);
	assert.equal(repo._db.responses.length, 3);
});
