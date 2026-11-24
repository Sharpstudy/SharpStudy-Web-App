import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createMemoryRepo } from "./memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { containsAnswer, tutorRespond, limitSentences, answerForms } from "../../lib/mastery/tutor.js";
import { generateSheet, problemKey } from "../../lib/mastery/sheet.js";
import { SUBJECTS } from "../../lib/mastery/curriculum.js";
import { formatAnswer } from "../../lib/mastery/answers.js";

// Accounts named parent* model family accounts that hold the "Family" role (learners.create).
const account = (userId, role = "student", extra = /^(parent|p[0-9])/.test(userId) ? ["learners.create"] : []) => ({ kind: "account", userId, role, permissions: resolvePermissions(role, extra) });

// AI double that leaks the answer of whatever question it is shown.
const leakyAi = (sheet, i) => ({ complete: async () => `The answer is ${formatAnswer(sheet.problems[i].answer)}. Great job! Keep going.` });
const echoAi = (text) => ({ complete: async () => text });

async function setup(settings) {
	const repo = createMemoryRepo();
	repo._db.users.push({ id: "p1", email: "p@example.com", role: "student" }, { id: "admin", email: "a@example.com", role: "admin" });
	const kid = await svc.createLearner(repo, account("p1"), { displayName: "Kai", pin: "2468", subjects: ["math"] });
	const actor = { kind: "learner", learnerId: kid.id, accountUserId: "p1" };
	if (settings) for (const [k, v] of Object.entries(settings)) await repo.setSetting(`tutor.${k}`, v);
	const started = await svc.startWorksheet(repo, actor, { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 });
	return { repo, actor, kid, started };
}

test("leak detector recognises answers in many written forms", () => {
	const p = { answer: { kind: "integer", value: "7" } };
	assert.ok(containsAnswer("It is 7.", p));
	assert.ok(containsAnswer("there are seven dots", p));
	assert.ok(!containsAnswer("Count 17 and 70 carefully", p), "must not match inside other numbers");
	assert.ok(containsAnswer("You get 1,200!", { answer: { kind: "integer", value: "1200" } }));
	const frac = { answer: { kind: "fraction", value: "3/4" } };
	assert.ok(containsAnswer("so it's 3/4", frac));
	assert.ok(containsAnswer("three... no, 3 over 4", frac));
	assert.ok(containsAnswer("that's 0.75", frac));
	const choice = { answer: { kind: "choice", value: "B" }, choices: [{ label: "A", text: "hat" }, { label: "B", text: "well" }] };
	assert.ok(containsAnswer("Pick option B", choice));
	assert.ok(containsAnswer("Well rhymes with bell", choice));
	assert.ok(!containsAnswer("Both words end the same", choice));
	const multi = { answer: { kind: "multi", parts: [{ kind: "integer", value: "12" }, { kind: "integer", value: "5" }] } };
	assert.ok(containsAnswer("x is 12", multi));
	assert.ok(containsAnswer("y = 5", multi));
	const expr = { answer: { kind: "expression", value: "x^2 + 5x + 6" } };
	assert.ok(containsAnswer("Answer: x^2+5x+6", expr));
	assert.ok(answerForms({ answer: { kind: "text", value: "children" } }).includes("children"));
});

test("limitSentences keeps replies to about three sentences", () => {
	assert.equal(limitSentences("One. Two! Three? Four. Five."), "One. Two! Three?");
	assert.equal(limitSentences("**Bold** _text_"), "Bold text");
});

test("tutor never discloses the exact answer, across every ready set and mode", async () => {
	for (const subj of SUBJECTS) {
		for (const lv of subj.levels) {
			for (const set of lv.sets.filter((s) => s.ready)) {
				const sheet = generateSheet(lv.id, set.id, 1, 0);
				for (const i of [0, 3, 7]) {
					const problem = sheet.problems[i];
					for (const mode of ["replay", "explain", "example", "chat"]) {
						// Leaky AI must be blocked.
						const r = await tutorRespond({ sheet, problemIndex: i, mode, message: "what is the answer?", settings: { chatEnabled: true }, ai: leakyAi(sheet, i) });
						assert.ok(!containsAnswer(r.text, problem), `${set.id} q${i} ${mode} leaked: ${r.text}`);
						assert.notEqual(r.source, "ai", `${set.id} ${mode}: leaky reply must not be used`);
						// No AI at all: deterministic fallback must also be safe.
						const f = await tutorRespond({ sheet, problemIndex: i, mode, settings: { enabled: false } });
						assert.ok(!containsAnswer(f.text, problem), `${set.id} q${i} ${mode} fallback leaked: ${f.text}`);
						if (r.example) {
							assert.notEqual(problemKey({ ...r.example, scene: r.example.scene || undefined, layout: r.example.layout || undefined, choices: r.example.choices || undefined }), problemKey(problem), "example must be a different question");
							if (problem.choices) assert.ok(r.example.choices && r.example.choices.length > 1, "choice examples include their options");
							assert.notEqual(r.example.answer, formatAnswer(problem.answer), "example must have a different answer");
						}
					}
				}
			}
		}
	}
});

test("safe AI replies are passed through, trimmed to three sentences", async () => {
	const sheet = generateSheet("3A", "3A-2", 1, 0);
	const r = await tutorRespond({
		sheet,
		problemIndex: 0,
		mode: "explain",
		ai: echoAi("Start at the first number. Count on two more, one step at a time. You can do it! Extra sentence here."),
	});
	assert.equal(r.source, "ai");
	assert.equal(r.text, "Start at the first number. Count on two more, one step at a time. You can do it!");
});

test("AI outages fall back to friendly built-in help", async () => {
	const sheet = generateSheet("C", "C-1", 1, 0);
	const throwing = { complete: async () => { throw new Error("network down"); } };
	const r = await tutorRespond({ sheet, problemIndex: 2, mode: "explain", ai: throwing });
	assert.equal(r.source, "fallback");
	assert.ok(r.text.length > 10);
	const nul = await tutorRespond({ sheet, problemIndex: 2, mode: "chat", ai: { complete: async () => null }, settings: { chatEnabled: true } });
	assert.match(nul.text, /can't chat right now/);
});

test("tutor requests are authorised, validated and recorded as hints", async () => {
	const { repo, actor, started } = await setup();
	const r = await svc.tutorRequest(repo, actor, { startToken: started.startToken, questionIndex: 1, mode: "explain" }, { ai: null });
	assert.ok(r.text);
	assert.equal(repo._db.hints.length, 1);
	// Browser-supplied "answers" are ignored: context comes from the token.
	const sneaky = await svc.tutorRequest(repo, actor, { startToken: started.startToken, questionIndex: 1, mode: "example", attempted: "x".repeat(5000), answer: "999" }, { ai: null });
	assert.ok(sneaky.text);
	await assert.rejects(svc.tutorRequest(repo, actor, { startToken: started.startToken, questionIndex: 99, mode: "explain" }), { code: "invalid" });
	await assert.rejects(svc.tutorRequest(repo, actor, { startToken: started.startToken, questionIndex: 0, mode: "solve" }), { code: "invalid" });
	await assert.rejects(svc.tutorRequest(repo, actor, { startToken: "nope", questionIndex: 0, mode: "explain" }), { code: "invalid_token" });
	await assert.rejects(svc.tutorRequest(repo, account("p1"), { startToken: started.startToken, questionIndex: 0, mode: "explain" }), { status: 401 });
	const other = await svc.createLearner(repo, account("p1"), { displayName: "Zed", pin: "1357" });
	await assert.rejects(
		svc.tutorRequest(repo, { kind: "learner", learnerId: other.id, accountUserId: "p1" }, { startToken: started.startToken, questionIndex: 0, mode: "explain" }),
		{ status: 403 }
	);
	// Chat is off by default; admins can enable it.
	await assert.rejects(svc.tutorRequest(repo, actor, { startToken: started.startToken, questionIndex: 0, mode: "chat", message: "help" }), { code: "chat_disabled" });
	await assert.rejects(svc.updateTutorSettings(repo, account("p1"), { chatEnabled: true }), { status: 403 });
	await svc.updateTutorSettings(repo, account("admin", "admin"), { chatEnabled: true });
	const chat = await svc.tutorRequest(repo, actor, { startToken: started.startToken, questionIndex: 0, mode: "chat", message: "help" }, { ai: null });
	assert.ok(chat.text);
	await assert.rejects(svc.updateTutorSettings(repo, account("admin", "admin"), { model: "gpt-4" }), { code: "invalid" });
});

test("hint use is persisted on the attempt", async () => {
	const { repo, actor, started } = await setup();
	await svc.tutorRequest(repo, actor, { startToken: started.startToken, questionIndex: 0, mode: "replay" }, { ai: null });
	await svc.tutorRequest(repo, actor, { startToken: started.startToken, questionIndex: 4, mode: "example" }, { ai: null });
	const responses = started.sheet.problems.map((p) => [p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value]);
	const r = await svc.submitAttempt(repo, actor, { startToken: started.startToken, clientAttemptId: "hint-attempt-0001", responses });
	assert.equal(r.hintsUsed, 2);
});
