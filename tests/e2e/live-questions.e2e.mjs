// End-to-end test of the live-question API against a RUNNING dev server and its
// real MySQL database (separate instructor and student sessions, via tokens).
//   1. yarn dev
//   2. node tests/e2e/live-questions.e2e.mjs
// Creates one temporary course (class) owned by a non-admin user, enrols two
// existing users in it, runs the whole flow and deletes the course at the end
// (responses/questions cascade). Never prints secrets. localhost only.
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");

const db = await mysql.createConnection({
	host: process.env.DB_HOSTNAME,
	port: process.env.DB_PORT,
	user: process.env.DB_USERNAME,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME_DEVELOPMENT,
});
const [users] = await db.query("SELECT id, role, email FROM users WHERE status = 1 OR status IS NULL ORDER BY created_at");
const nonAdmins = users.filter((u) => u.role !== "admin");
assert.ok(nonAdmins.length >= 4, "need at least four non-admin users in the dev DB");
const [teacher, s1, s2, outsider] = nonAdmins; // teacher owns the temp course (role is irrelevant: ownership decides)
const admin = users.find((u) => u.role === "admin");
const token = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "10m" });

let [[cat]] = await db.query("SELECT id FROM categories LIMIT 1");
let tempCat = null;
if (!cat) {
	tempCat = randomUUID();
	await db.query("INSERT INTO categories (id, category, slug, created_at, updated_at) VALUES (?, 'tmp-e2e', 'tmp-e2e', NOW(), NOW())", [tempCat]);
	cat = { id: tempCat };
}
const courseId = randomUUID();
const slug = `e2e-live-${Date.now()}`;
const otherSlug = `e2e-other-${Date.now()}`;
const otherCourse = randomUUID();
const addCourse = (id, s, owner) =>
	db.query("INSERT INTO courses (id, title, slug, userId, catId, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())", [id, "E2E Live", s, owner, cat.id]);
await addCourse(courseId, slug, teacher.id);
await addCourse(otherCourse, otherSlug, teacher.id);
for (const [u, c] of [[s1, courseId], [s2, courseId], [outsider, otherCourse]]) {
	await db.query("INSERT INTO enrolments (id, userId, courseId, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())", [randomUUID(), u.id, c]);
}

let passed = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	passed++;
};
const call = async (method, path, { as, body } = {}) => {
	const headers = { "Content-Type": "application/json" };
	if (as) headers.Authorization = token(as);
	const res = await fetch(`${BASE}/api/live-questions/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	let json = null;
	try {
		json = await res.json();
	} catch (e) {
		/* empty */
	}
	return { status: res.status, json };
};

try {
	const Q = { text: "Which is a prime number?", options: ["4", "7", "9"], correctIndex: 1, explanation: "7 has only two factors.", durationSec: 60 };

	// ---- authorization
	check("anonymous cannot read state", (await call("GET", `${slug}/state/`)).status === 401);
	check("student cannot create", (await call("POST", `${slug}/questions/`, { as: s1, body: Q })).status === 403);
	check("outsider cannot read state", (await call("GET", `${slug}/state/`, { as: outsider })).status === 403);
	check("unknown class is 404", (await call("GET", `nope-${slug}/state/`, { as: s1 })).status === 404);

	// ---- instructor publishes in the "existing class"
	const created = await call("POST", `${slug}/questions/`, { as: teacher, body: { ...Q, publish: true } });
	check("instructor publishes", created.status === 201 && created.json.question.status === "open");
	const qid = created.json.question.id;
	check("deadline set from countdown", !!created.json.question.deadlineAt);

	// ---- student receives it without refresh (polling state) and without the answer
	const st = await call("GET", `${slug}/state/`, { as: s1 });
	check("student sees open question", st.status === 200 && st.json.role === "student" && st.json.current.id === qid);
	const raw = JSON.stringify(st.json);
	check("correct answer hidden from student", !/correct/i.test(raw) && !raw.includes("7 has only"));

	// ---- answers
	const a1 = await call("POST", `${slug}/questions/${qid}/answer/`, { as: s1, body: { optionId: "o2", userId: s2.id } });
	check("student answers", a1.status === 200 && a1.json.received === true && a1.json.isCorrect === undefined);
	const dup = await call("POST", `${slug}/questions/${qid}/answer/`, { as: s1, body: { optionId: "o2" } });
	check("duplicate is idempotent", dup.status === 200 && dup.json.duplicate === true);
	const change = await call("POST", `${slug}/questions/${qid}/answer/`, { as: s1, body: { optionId: "o1" } });
	check("changing is refused when not allowed", change.status === 409);
	const a2 = await call("POST", `${slug}/questions/${qid}/answer/`, { as: s2, body: { optionId: "o1" } });
	check("second student answers", a2.status === 200);
	const [rows] = await db.query("SELECT user_id, option_id, is_correct FROM live_question_responses WHERE live_question_id = ?", [qid]);
	check("exactly one stored response per student, under their own ids", rows.length === 2 && rows.some((r) => r.user_id === s1.id && r.option_id === "o2" && r.is_correct === 1) && rows.some((r) => r.user_id === s2.id && r.option_id === "o1" && r.is_correct === 0));
	check("instructor cannot answer", (await call("POST", `${slug}/questions/${qid}/answer/`, { as: teacher, body: { optionId: "o2" } })).status === 403);
	check("outsider cannot answer", (await call("POST", `${slug}/questions/${qid}/answer/`, { as: outsider, body: { optionId: "o2" } })).status === 403);
	check("invalid option rejected", (await call("POST", `${slug}/questions/${qid}/answer/`, { as: s2, body: { optionId: "zzz" } })).status === 422);

	// ---- instructor live results
	const ist = await call("GET", `${slug}/state/`, { as: teacher });
	check("instructor sees counts", ist.json.current.totals.answered === 2 && ist.json.current.totals.correct === 1 && ist.json.current.correctOptionId === "o2");
	check("instructor sees who answered", ist.json.current.answered.length === 2 && ist.json.current.pending.length === 0);

	// ---- cross-class isolation
	check("question id from another class is 404", (await call("POST", `${otherSlug}/questions/${qid}/answer/`, { as: outsider, body: { optionId: "o2" } })).status === 404);
	check("other class sees nothing", (await call("GET", `${otherSlug}/state/`, { as: outsider })).json.current === null);
	check("student cannot reveal", (await call("POST", `${slug}/questions/${qid}`, { as: s1, body: { action: "reveal" } })).status === 403);
	check("student cannot read teacher results", (await call("GET", `${slug}/questions/`, { as: s1 })).status === 403);
	check("unknown action rejected", (await call("POST", `${slug}/questions/${qid}`, { as: teacher, body: { action: "explode" } })).status === 422);

	// ---- close, late submission, results, reveal
	const closed = await call("POST", `${slug}/questions/${qid}`, { as: teacher, body: { action: "close" } });
	check("instructor closes", closed.status === 200 && closed.json.question.status === "closed");
	check("late submission rejected", (await call("POST", `${slug}/questions/${qid}/answer/`, { as: s2, body: { optionId: "o2" } })).status === 409);
	let sv = (await call("GET", `${slug}/state/`, { as: s2 })).json.current;
	check("still hidden after close", sv.status === "closed" && sv.correctOptionId === undefined && sv.results === undefined);
	await call("POST", `${slug}/questions/${qid}`, { as: teacher, body: { action: "publish_results" } });
	sv = (await call("GET", `${slug}/state/`, { as: s2 })).json.current;
	check("distribution released", sv.results && sv.results.total === 2 && sv.correctOptionId === undefined);
	await call("POST", `${slug}/questions/${qid}`, { as: teacher, body: { action: "reveal" } });
	sv = (await call("GET", `${slug}/state/`, { as: s2 })).json.current;
	check("answer + explanation after reveal", sv.correctOptionId === "o2" && sv.explanation.startsWith("7 has") && sv.myAnswer.isCorrect === false);
	const mine = await call("GET", `${slug}/my-results/`, { as: s1 });
	check("student sees only own results", mine.json.total === 1 && mine.json.correct === 1 && !JSON.stringify(mine.json).includes(s2.id));

	// ---- next question, expiry by server clock, saved results
	const q2 = await call("POST", `${slug}/questions/`, { as: teacher, body: { text: "1+1?", options: ["2", "3"], correctIndex: 0, durationSec: 5, publish: true } });
	check("next question launches", q2.status === 201 && q2.json.question.seq === 2);
	await new Promise((r) => setTimeout(r, 5600));
	check("expired question rejects answers", (await call("POST", `${slug}/questions/${q2.json.question.id}/answer/`, { as: s1, body: { optionId: "o1" } })).status === 409);
	check("expired question is closed in state", (await call("GET", `${slug}/state/`, { as: teacher })).json.current.status === "closed");
	const review = await call("GET", `${slug}/questions/`, { as: teacher });
	check("saved results for review", review.status === 200 && review.json.questions.length === 2 && review.json.questions[0].totals.answered === 2);
	if (admin) check("admin can review", (await call("GET", `${slug}/questions/`, { as: admin })).status === 200);

	// ---- importable quiz questions (endpoint works; contents depend on dev data)
	const imp = await call("GET", `${slug}/importable/`, { as: teacher });
	check("importable endpoint", imp.status === 200 && Array.isArray(imp.json.questions));
	check("students cannot import", (await call("GET", `${slug}/importable/`, { as: s1 })).status === 403);

	console.log(`live-questions e2e: ${passed} checks passed`);
} finally {
	await db.query("DELETE FROM courses WHERE id IN (?, ?)", [courseId, otherCourse]); // cascades to enrolments, questions, responses
	if (tempCat) await db.query("DELETE FROM categories WHERE id = ?", [tempCat]);
	await db.end();
}
