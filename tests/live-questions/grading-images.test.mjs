// Answer-key regression tests and image / true-false questions.
import test from "node:test";
import assert from "node:assert/strict";
import * as lq from "../../lib/live-questions/service.js";
import { createLiveRepo } from "./memoryRepo.mjs";

const actor = (userId, role = "student") => ({ userId, role });
const T0 = new Date("2026-10-21T12:00:00Z");
const at = (sec) => new Date(T0.getTime() + sec * 1000);
const teacher = actor("t1", "instructor");
const SA = "11111111-1111-4111-8111-111111111111";
const SB = "22222222-2222-4222-8222-222222222222";

function setup() {
	const repo = createLiveRepo();
	repo._db.courses.push({ id: "c1", slug: "math", title: "Math", userId: "t1" }, { id: "c2", slug: "art", title: "Art", userId: "t2" });
	repo._db.users.push({ id: "s1", name: "Ann" }, { id: "s2", name: "Bo" });
	for (const u of ["s1", "s2"]) repo._db.enrolments.push({ userId: u, courseId: "c1", status: "paid" });
	const mk = (id) => ({ id, course_id: "c1", instructor_id: "t1", status: "live" });
	repo._db.sessions.push(mk(SA), mk(SB));
	for (const u of ["s1", "s2"]) repo._db.seats.push({ class_id: SA, participant_key: `u:${u}`, user_id: u, display_name: u });
	repo._db.seats.push({ class_id: SB, participant_key: "u:s1", user_id: "s1", display_name: "s1" });
	return repo;
}
const q = (extra = {}) => ({ text: "2 + 2 =", options: ["3", "4", "5", "6"], correctIndex: 1, publish: true, ...extra });

// ------------------------------------------------------------------ grading

test("REGRESSION: 2 + 2 = with options 3, 4, 5, 6 and the saved key 4 grades 4 correct and 5 incorrect", async () => {
	const repo = setup();
	const pub = await lq.createQuestion(repo, teacher, SA, q(), T0);
	const stored = repo._db.questions[0];
	assert.equal(stored.options.find((o) => o.id === stored.correct_option_id).text, "4", "the key points at the option whose text is 4");
	await lq.submitAnswer(repo, actor("s1"), SA, pub.id, stored.options[1].id, at(1)); // picks 4
	await lq.submitAnswer(repo, actor("s2"), SA, pub.id, stored.options[2].id, at(1)); // picks 5
	await lq.revealQuestion(repo, teacher, SA, pub.id, at(2));

	const s1 = (await lq.getState(repo, actor("s1"), SA, at(3))).current;
	const s2 = (await lq.getState(repo, actor("s2"), SA, at(3))).current;
	assert.equal(s1.options.find((o) => o.id === s1.correctOptionId).text, "4");
	assert.equal(s1.myAnswer.isCorrect, true);
	assert.equal(s2.myAnswer.isCorrect, false);
	assert.equal(s2.options.find((o) => o.id === s2.myAnswer.optionId).text, "5");
	const inst = (await lq.getState(repo, teacher, SA, at(3))).current;
	assert.equal(inst.options.find((o) => o.id === inst.correctOptionId).text, "4");
	assert.deepEqual(inst.answered.map((a) => [a.name, a.isCorrect]).sort(), [["s1", true], ["s2", false]]);
	assert.deepEqual([inst.totals.answered, inst.totals.correct], [2, 1]);
	assert.equal((await lq.myResults(repo, actor("s2"), SA)).correct, 0);
});

test("the key is explicit: missing, null, empty, boolean, fractional and out-of-range keys are refused (null/'' used to become option 1)", async () => {
	const repo = setup();
	const base = { text: "2 + 2 =", options: ["5", "4"] };
	for (const bad of [undefined, null, "", false, true, NaN, -1, 2, 1.5, "1.5", "abc", [], {}, "  "]) {
		await assert.rejects(lq.createQuestion(repo, teacher, SA, { ...base, correctIndex: bad }), { status: 422 }, `correctIndex ${JSON.stringify(bad)}`);
	}
	assert.equal(repo._db.questions.length, 0, "nothing is stored for an invalid question");
	const ok = await lq.createQuestion(repo, teacher, SA, { ...base, correctIndex: "1" });
	assert.equal(ok.options.find((o) => o.id === ok.correctOptionId).text, "4");
});

test("the key follows the option, not the position it was entered in", async () => {
	const repo = setup();
	const a = await lq.createQuestion(repo, teacher, SA, { text: "2 + 2 =", options: ["4", "5"], correctIndex: 0 });
	const b = await lq.createQuestion(repo, teacher, SA, { text: "2 + 2 =", options: ["5", "4"], correctIndex: 1 });
	for (const v of [a, b]) assert.equal(v.options.find((o) => o.id === v.correctOptionId).text, "4");
});

test("an answer is graded by the saved key only; the client cannot send correctness", async () => {
	const repo = setup();
	const pub = await lq.createQuestion(repo, teacher, SA, q(), T0);
	await lq.submitAnswer(repo, { ...actor("s1"), isCorrect: true, correct: true }, SA, pub.id, "o3", at(1));
	assert.equal(repo._db.responses[0].is_correct, false);
	await assert.rejects(lq.submitAnswer(repo, actor("s2"), SA, pub.id, "4", at(1)), { status: 422 }, "an option TEXT is not an option id");
});

test("grades always follow the current key: correcting one wrong key re-grades only that question", async () => {
	const repo = setup();
	// What the old editor produced: the first option silently stored as the key.
	repo._db.questions.push({
		id: "q-old", course_id: "c1", class_id: SA, instructor_id: "t1", seq: 1, question_type: "single", question_text: "2+2 =",
		options: [{ id: "o1", text: "5" }, { id: "o2", text: "4" }], correct_option_id: "o1", status: "revealed", allow_change: false,
		results_published: false, deadline_at: null, closed_at: T0, revealed_at: T0, opened_at: T0,
	});
	repo._db.questions.push({ id: "q-other", course_id: "c1", class_id: SB, instructor_id: "t1", seq: 1, question_type: "single", question_text: "x", options: [{ id: "o1", text: "a" }, { id: "o2", text: "b" }], correct_option_id: "o1", status: "revealed", results_published: false });
	repo._db.responses.push({ id: "r1", live_question_id: "q-old", user_id: "s1", option_id: "o2", is_correct: false, submitted_at: T0 });
	const before = (await lq.getState(repo, actor("s1"), SA, at(5))).current;
	assert.equal(before.myAnswer.isCorrect, false, "the stored key says 5, so 4 looks wrong until the instructor corrects it");

	await assert.rejects(lq.setCorrectOption(repo, actor("s1"), SA, "q-old", "o2"), { status: 403 });
	await assert.rejects(lq.setCorrectOption(repo, teacher, SA, "q-old", "o9"), { status: 422 });
	await assert.rejects(lq.setCorrectOption(repo, teacher, SB, "q-old", "o2"), { status: 404 }, "wrong session");
	await lq.setCorrectOption(repo, teacher, SA, "q-old", "o2");
	const after = (await lq.getState(repo, actor("s1"), SA, at(5))).current;
	assert.equal(after.myAnswer.isCorrect, true);
	assert.equal(repo._db.responses[0].is_correct, true);
	assert.equal(repo._db.questions.find((x) => x.id === "q-other").correct_option_id, "o1", "no other question is touched");
});

test("drafts can be edited (with an explicit key); published questions cannot", async () => {
	const repo = setup();
	const d = await lq.createQuestion(repo, teacher, SA, q({ publish: false }));
	const e = await lq.updateDraft(repo, teacher, SA, d.id, { text: "3 + 3 =", options: ["5", "6", "7"], correctIndex: 1 });
	assert.equal(e.text, "3 + 3 =");
	assert.equal(e.options.find((o) => o.id === e.correctOptionId).text, "6");
	await assert.rejects(lq.updateDraft(repo, teacher, SA, d.id, { text: "3 + 3 =", options: ["5", "6"] }), { status: 422 }, "key required again");
	await assert.rejects(lq.updateDraft(repo, actor("s1"), SA, d.id, q()), { status: 403 });
	await lq.publishQuestion(repo, teacher, SA, d.id, T0);
	await assert.rejects(lq.updateDraft(repo, teacher, SA, d.id, q()), { status: 409 });
	const state = await lq.getState(repo, teacher, SA, T0);
	assert.equal(state.drafts.length, 0);
});

test("the instructor sees drafts with their saved key (index + options) so they can be edited", async () => {
	const repo = setup();
	await lq.createQuestion(repo, teacher, SA, q({ publish: false }));
	const [d] = (await lq.getState(repo, teacher, SA, T0)).drafts;
	assert.equal(d.correctIndex, 1);
	assert.equal(d.options[d.correctIndex].text, "4");
	assert.equal(d.kind, "single");
});

// ------------------------------------------------------------------ true / false

test("true/false questions have fixed True and False options and an explicit key", async () => {
	const repo = setup();
	await assert.rejects(lq.createQuestion(repo, teacher, SA, { kind: "true_false", text: "The Earth is flat." }), { status: 422 });
	const v = await lq.createQuestion(repo, teacher, SA, { kind: "true_false", text: "The Earth is flat.", options: ["x", "y", "z"], correctIndex: 1, publish: true }, T0);
	assert.deepEqual(v.options.map((o) => o.text), ["True", "False"]);
	assert.equal(v.type, "true_false");
	assert.equal(v.options.find((o) => o.id === v.correctOptionId).text, "False");
	await lq.submitAnswer(repo, actor("s1"), SA, v.id, "o2", at(1));
	await lq.submitAnswer(repo, actor("s2"), SA, v.id, "o1", at(1));
	const r = await lq.revealQuestion(repo, teacher, SA, v.id, at(2));
	assert.equal(r.totals.correct, 1);
	await assert.rejects(lq.createQuestion(repo, teacher, SA, { kind: "essay", text: "x", correctIndex: 0 }), { status: 422 });
});

// ------------------------------------------------------------------ images

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const b64 = (b) => b.toString("base64");

test("uploads: only PNG/JPEG/WebP/GIF by content, within the size limit; SVG, scripts and disguised files are refused", async () => {
	const repo = setup();
	assert.equal((await lq.uploadImage(repo, teacher, SA, b64(PNG))).mime, "image/png");
	assert.equal((await lq.uploadImage(repo, teacher, SA, "data:image/jpeg;base64," + b64(JPG))).mime, "image/jpeg");
	const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
	assert.equal((await lq.uploadImage(repo, teacher, SA, b64(webp))).mime, "image/webp");
	assert.equal((await lq.uploadImage(repo, teacher, SA, b64(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)])))).mime, "image/gif");
	const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
	for (const bad of [svg, Buffer.from("<html><script>1</script></html>"), Buffer.from("MZ" + "x".repeat(50)), Buffer.from("PK\u0003\u0004" + "x".repeat(50)), Buffer.from("just text, named photo.png")]) {
		await assert.rejects(lq.uploadImage(repo, teacher, SA, b64(bad)), { status: 415 });
	}
	await assert.rejects(lq.uploadImage(repo, teacher, SA, b64(Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))), { status: 413 });
	for (const bad of ["", "###not base64###", undefined, null]) await assert.rejects(lq.uploadImage(repo, teacher, SA, bad), { status: 422 });
	assert.equal(repo._db.images.length, 4, "rejected files are never stored");
});

test("only the session's instructor can upload; students and other instructors cannot", async () => {
	const repo = setup();
	await assert.rejects(lq.uploadImage(repo, actor("s1"), SA, b64(PNG)), { status: 403 });
	await assert.rejects(lq.uploadImage(repo, actor("t2", "instructor"), SA, b64(PNG)), { status: 404 });
	await assert.rejects(lq.uploadImage(repo, null, SA, b64(PNG)), { status: 401 });
});

test("an image question is created, published, answered and graded; the image stays with its question and session", async () => {
	const repo = setup();
	const cat = (await lq.uploadImage(repo, teacher, SA, b64(PNG))).imageId;
	const dog = (await lq.uploadImage(repo, teacher, SA, b64(JPG))).imageId;
	const v = await lq.createQuestion(repo, teacher, SA, { text: "Which animal is this?", imageId: cat, options: [{ text: "Dog" }, { text: "Cat" }, { text: "Bird" }], correctIndex: 1, publish: true }, T0);
	assert.equal(v.imageId, cat);
	assert.equal(repo._db.questions[0].class_id, SA);
	// an image-only question with image options
	const v2 = await lq.createQuestion(repo, teacher, SA, { options: [{ imageId: cat }, { imageId: dog }], imageId: null, text: "Pick the dog", correctIndex: 1, publish: true }, at(5));
	assert.deepEqual(v2.options.map((o) => o.imageId), [cat, dog]);
	assert.equal((await lq.getState(repo, actor("s1"), SA, at(6))).current.options[1].imageId, dog);
	await lq.submitAnswer(repo, actor("s1"), SA, v2.id, "o2", at(6));
	await lq.submitAnswer(repo, actor("s2"), SA, v2.id, "o1", at(6));
	const rev = await lq.revealQuestion(repo, teacher, SA, v2.id, at(7));
	assert.deepEqual([rev.totals.answered, rev.totals.correct], [2, 1]);
	// text OR image is required for the question and each option
	await assert.rejects(lq.createQuestion(repo, teacher, SA, { text: "", options: ["a", "b"], correctIndex: 0 }), { status: 422 });
	await assert.rejects(lq.createQuestion(repo, teacher, SA, { text: "x", options: [{ text: "" }, { text: "b" }], correctIndex: 0 }), { status: 422 });
	await assert.rejects(lq.createQuestion(repo, teacher, SA, { text: "x", options: [{ imageId: cat }, { imageId: cat }], correctIndex: 0 }), { status: 422 }, "duplicate images");
	assert.ok((await lq.createQuestion(repo, teacher, SA, { text: "", imageId: cat, options: ["a", "b"], correctIndex: 0 })).imageId, "an image alone can be the question");
});

test("images cannot be borrowed across sessions, instructors or fabricated ids", async () => {
	const repo = setup();
	const inA = (await lq.uploadImage(repo, teacher, SA, b64(PNG))).imageId;
	await assert.rejects(lq.createQuestion(repo, teacher, SB, { text: "x", imageId: inA, options: ["a", "b"], correctIndex: 0 }), { status: 422 }, "image of session A in session B");
	await assert.rejects(lq.createQuestion(repo, teacher, SA, { text: "x", imageId: "00000000-0000-4000-8000-000000000000", options: ["a", "b"], correctIndex: 0 }), { status: 422 });
	await assert.rejects(lq.createQuestion(repo, teacher, SA, { text: "x", options: [{ text: "a", imageId: "nope" }, "b"], correctIndex: 0 }), { status: 422 });
	// admin (a different uploader) cannot reuse the instructor's upload either
	await assert.rejects(lq.createQuestion(repo, actor("root", "admin"), SA, { text: "x", imageId: inA, options: ["a", "b"], correctIndex: 0 }), { status: 422 });
});

test("image access: students see an image only after its question is published in their own session", async () => {
	const repo = setup();
	const img = (await lq.uploadImage(repo, teacher, SA, b64(PNG))).imageId;
	const draft = await lq.createQuestion(repo, teacher, SA, { text: "Name this", imageId: img, options: ["a", "b"], correctIndex: 0 });
	assert.equal((await lq.getImageForViewer(repo, teacher, SA, img)).mime, "image/png");
	await assert.rejects(lq.getImageForViewer(repo, actor("s1"), SA, img), { status: 404 }, "drafts stay private");
	await lq.publishQuestion(repo, teacher, SA, draft.id, T0);
	assert.equal((await lq.getImageForViewer(repo, actor("s1"), SA, img)).mime, "image/png");
	// s2 holds no seat in session B; s1 does, but the image belongs to session A
	await assert.rejects(lq.getImageForViewer(repo, actor("s2"), SB, img), { status: 404 });
	await assert.rejects(lq.getImageForViewer(repo, actor("s1"), SB, img), { status: 404 });
	await assert.rejects(lq.getImageForViewer(repo, null, SA, img), { status: 401 });
	await assert.rejects(lq.getImageForViewer(repo, actor("outsider"), SA, img), { status: 404 });
	// session B's instructor view cannot read it either
	await assert.rejects(lq.getImageForViewer(repo, actor("t2", "instructor"), SA, img), { status: 404 });
});
