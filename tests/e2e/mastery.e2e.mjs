// End-to-end smoke test against a RUNNING server and its database.
//   1. yarn dev   (development mode = development DB; `next start` uses the PRODUCTION DB config)
//   2. E2E_BASE_URL=http://localhost:3000 node tests/e2e/mastery.e2e.mjs
// Uses the existing DB users (one admin, two non-admin accounts) by minting
// login tokens with JWT_SECRET from .env. Creates one temporary learner and
// removes it at the end. Never prints secrets. Do NOT point at production.
import fs from "node:fs";
import assert from "node:assert/strict";
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
const admin = users.find((u) => u.role === "admin");
const others = users.filter((u) => u.role !== "admin");
assert.ok(admin && others.length >= 2, "need an admin and two other users in the dev DB");
const [parent, stranger] = others;
const token = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "10m" });

let passed = 0;
let grantedRole = false;
let hadRole = false;
let fam;
let hadLearners = 0;
const call = async (method, path, { auth, learner, body, raw } = {}) => {
	const headers = { "Content-Type": "application/json" };
	if (auth) headers.Authorization = token(auth);
	if (learner) headers["x-learner-token"] = learner;
	const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "follow" });
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch (e) {
		/* not json */
	}
	return { status: res.status, json, text, type: res.headers.get("content-type") || "" };
};
const check = (name, cond) => {
	assert.ok(cond, name);
	passed++;
	console.log(`  ✔ ${name}`);
};
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);

let learnerId;
try {
	console.log(`E2E against ${BASE}`);
	// ---- existing functionality still works ----
	for (const path of ["/api/all-courses", "/api/home-courses"]) {
		const r = await call("GET", path);
		check(`existing GET ${path} -> 200`, r.status === 200);
	}
	check("existing /api/categories still requires a token", (await call("GET", "/api/categories")).status === 401);
	check("existing /api/categories works with a token", (await call("GET", "/api/categories", { auth: admin })).status === 200);
	check("existing /api/users/update with login token -> 200", (await call("GET", "/api/users/update", { auth: parent })).status === 200);
	for (const page of ["/", "/courses/", "/auth/"]) check(`page ${page} renders`, (await call("GET", page)).status === 200);

	// ---- learner creation needs the Family role (learners.create) ----
	[[fam]] = await db.query("SELECT id FROM ml_roles WHERE name = 'Family'");
	assert.ok(fam, "run the seeder: the Family role is missing");
	hadRole = Number((await db.query("SELECT COUNT(*) n FROM ml_user_roles WHERE user_id = ? AND role_id = ?", [parent.id, fam.id]))[0][0].n) > 0;
	await db.query("DELETE FROM ml_user_roles WHERE user_id = ? AND role_id = ?", [parent.id, fam.id]);
	hadLearners = Number((await db.query("SELECT COUNT(*) n FROM ml_learners WHERE owner_user_id = ?", [parent.id]))[0][0].n);
	const denied = await call("POST", "/api/mastery/learners", { auth: parent, body: { displayName: "Nope", pin: "1234" } });
	check("student without Family role cannot create a learner (403)", denied.status === 403);
	check("anonymous cannot create a learner (401)", (await call("POST", "/api/mastery/learners", { body: { displayName: "Nope", pin: "1234" } })).status === 401);
	check("no learner was created by the denied requests", Number((await db.query("SELECT COUNT(*) n FROM ml_learners WHERE owner_user_id = ?", [parent.id]))[0][0].n) === hadLearners);
	const listed = await call("GET", "/api/mastery/learners", { auth: parent });
	check("learner list reports canCreate=false", listed.status === 200 && listed.json.canCreate === false);
	grantedRole = (await db.query("SELECT COUNT(*) n FROM ml_user_roles WHERE user_id = ? AND role_id = ?", [parent.id, fam.id]))[0][0].n === 0;
	await db.query("INSERT INTO ml_user_roles (id, user_id, role_id, created_at, updated_at) VALUES (UUID(), ?, ?, NOW(), NOW())", [parent.id, fam.id]);

	// ---- learner creation & PIN ----
	const created = await call("POST", "/api/mastery/learners", { auth: parent, body: { displayName: "E2E Kid", pin: "4826", subjects: ["math", "english"], timeZone: "America/Vancouver" } });
	check("parent creates learner", created.status === 201);
	learnerId = created.json.learner.id;
	const [[row]] = await db.query("SELECT pin_hash FROM ml_learners WHERE id = ?", [learnerId]);
	check("PIN stored hashed", row.pin_hash.startsWith("$2") && !row.pin_hash.includes("4826"));
	check("wrong PIN rejected", (await call("POST", `/api/mastery/learners/${learnerId}/unlock`, { auth: parent, body: { pin: "0000" } })).status === 401);
	check("stranger cannot unlock", (await call("POST", `/api/mastery/learners/${learnerId}/unlock`, { auth: stranger, body: { pin: "4826" } })).status === 404);
	const unlock = await call("POST", `/api/mastery/learners/${learnerId}/unlock`, { auth: parent, body: { pin: "4826" } });
	check("correct PIN unlocks", unlock.status === 200 && unlock.json.learnerToken);
	const lt = unlock.json.learnerToken;

	// ---- study ----
	const home = await call("GET", "/api/mastery/study/home", { learner: lt });
	check("study home lists enrolled subjects", home.status === 200 && home.json.subjects.length === 2);
	const locked = await call("POST", "/api/mastery/study/start", { learner: lt, body: { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 2 } });
	check("locked worksheet refused by URL/API", locked.status === 403);
	const start = await call("POST", "/api/mastery/study/start", { learner: lt, body: { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 } });
	check("current worksheet opens", start.status === 200 && start.json.sheet.problems.length === 8);
	const tutor = await call("POST", "/api/mastery/tutor", { learner: lt, body: { startToken: start.json.startToken, questionIndex: 0, mode: "explain" } });
	check("tutor responds (fallback or AI)", tutor.status === 200 && tutor.json.text);
	check("tutor chat off by default", (await call("POST", "/api/mastery/tutor", { learner: lt, body: { startToken: start.json.startToken, questionIndex: 0, mode: "chat", message: "answer?" } })).status === 403);
	const responses = start.json.sheet.problems.map((p, i) => (i === 0 ? ["999999", right(p)] : [right(p)]));
	const body = { startToken: start.json.startToken, clientAttemptId: `e2e-${Date.now()}-abcdef`, responses, durationMs: 45000, completedAt: new Date().toISOString() };
	const sub = await call("POST", "/api/mastery/study/submit", { learner: lt, body });
	check("submit graded server-side: 7/8 first try -> repeat", sub.status === 201 && sub.json.correctFirst === 7 && sub.json.outcome === "repeat-worksheet");
	check("hint use persisted on attempt", sub.json.hintsUsed === 1);
	const dup = await call("POST", "/api/mastery/study/submit", { learner: lt, body });
	check("duplicate sync is idempotent", dup.status === 200 && dup.json.duplicate === true && dup.json.attemptId === sub.json.attemptId);
	const [[cnt]] = await db.query("SELECT COUNT(*) n FROM ml_attempts WHERE learner_id = ?", [learnerId]);
	check("exactly one attempt row stored", Number(cnt.n) === 1);
	const start2 = await call("POST", "/api/mastery/study/start", { learner: lt, body: { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 } });
	check("repeat uses a new variant", start2.json.sheet.variant === 1);
	const sub2 = await call("POST", "/api/mastery/study/submit", { learner: lt, body: { startToken: start2.json.startToken, clientAttemptId: `e2e2-${Date.now()}-abcdef`, responses: start2.json.sheet.problems.map((p) => [right(p)]), durationMs: 70000 } });
	check("8/8 under 2/3 target -> 3 stars, next worksheet", sub2.json.stars === 3 && sub2.json.outcome === "next-worksheet");

	// ---- placement / adult mode ----
	check("learner cannot self-place without adult mode", (await call("POST", `/api/mastery/learners/${learnerId}/placement`, { learner: lt, body: { subject: "math", position: { levelId: "C", setId: "C-1", worksheetNo: 1 }, confirm: true } })).status === 403);
	check("stranger cannot place", (await call("POST", `/api/mastery/learners/${learnerId}/placement`, { auth: stranger, body: { subject: "math", position: { levelId: "C", setId: "C-1", worksheetNo: 1 }, confirm: true } })).status === 404);
	check("placement needs confirm", (await call("POST", `/api/mastery/learners/${learnerId}/placement`, { auth: parent, body: { subject: "math", position: { levelId: "C", setId: "C-1", worksheetNo: 1 } } })).status === 422);
	check("parent places learner", (await call("POST", `/api/mastery/learners/${learnerId}/placement`, { auth: parent, body: { subject: "math", position: { levelId: "C", setId: "C-1", worksheetNo: 1 }, confirm: true } })).status === 200);
	check("learner cannot enable adult mode", [401, 403].includes((await call("POST", `/api/mastery/learners/${learnerId}/adult-mode`, { learner: lt, body: { enabled: true } })).status));

	// ---- print ----
	check("print locked worksheet refused", (await call("POST", "/api/mastery/print", { auth: parent, body: { learnerId, subject: "math", levelId: "D", setId: "D-1", worksheetNo: 1 } })).status === 403);
	const pr = await call("POST", "/api/mastery/print", { auth: parent, body: { learnerId, subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1, copies: 2, answerKey: true } });
	check("print unlocked worksheet with key for adult", pr.status === 200 && pr.json.sheets.length === 2 && pr.json.sheets[0].answerKey);
	check("learner cannot print answer key", (await call("POST", "/api/mastery/print", { learner: lt, body: { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1, answerKey: true } })).status === 403);

	// ---- dashboard ----
	const dash = await call("GET", `/api/mastery/learners/${learnerId}`, { auth: parent });
	check("dashboard metrics from persisted data", dash.status === 200 && dash.json.stats.worksheets === 2 && dash.json.todayCount === 2 && dash.json.habit.length === 21);
	check("stranger cannot read dashboard", (await call("GET", `/api/mastery/learners/${learnerId}`, { auth: stranger })).status === 404);
	const ics = await call("GET", `/api/mastery/learners/${learnerId}/calendar`, { auth: parent });
	check("calendar reminder download", ics.status === 200 && ics.type.includes("text/calendar") && ics.text.includes("RRULE:FREQ=DAILY"));

	// ---- admin & audit ----
	check("non-admin blocked from admin users API", (await call("GET", "/api/mastery/admin/users", { auth: parent })).status === 403);
	check("anonymous blocked from admin users API", (await call("GET", "/api/mastery/admin/users")).status === 401);
	check("admin lists users", (await call("GET", "/api/mastery/admin/users", { auth: admin })).status === 200);
	const auditR = await call("GET", "/api/mastery/admin/audit?action=placement.change", { auth: admin });
	check("audit records placement change", auditR.status === 200 && auditR.json.entries.some((e) => e.learner_id === learnerId));
	check("global reset refused without password", (await call("POST", "/api/mastery/admin/global-reset", { auth: admin, body: { phrase: "RESET ALL PROGRESS", password: "definitely-wrong" } })).status === 401);
	check("feedback submission", (await call("POST", "/api/mastery/feedback", { learner: lt, body: { message: "E2E feedback (safe to delete)", page: "/study/" } })).status === 201);
	check("presence heartbeat", (await call("POST", "/api/mastery/presence", { learner: lt, body: { path: "/study/" } })).status === 200);
	check("admin presence view", (await call("GET", "/api/mastery/admin/presence", { auth: admin })).json.learners >= 1);

	// ---- cleanup ----
	// ---- an owner without Family standing is view-only (API level) ----
	await db.query("DELETE FROM ml_user_roles WHERE user_id = ? AND role_id = ?", [parent.id, fam.id]);
	const asStudent = { auth: parent };
	check("student-owner can still view the dashboard", (await call("GET", `/api/mastery/learners/${learnerId}`, asStudent)).status === 200);
	check("student-owner cannot reset progress (403)", (await call("POST", `/api/mastery/learners/${learnerId}/reset`, { ...asStudent, body: { confirmText: "E2E Kid" } })).status === 403);
	check("student-owner cannot remove the learner (403)", (await call("DELETE", `/api/mastery/learners/${learnerId}`, { ...asStudent, body: { confirmText: "E2E Kid" } })).status === 403);
	check("student-owner cannot reset PIN (403)", (await call("POST", `/api/mastery/learners/${learnerId}/pin`, { ...asStudent, body: { pin: "1111" } })).status === 403);
	check("student-owner cannot add access (403)", (await call("POST", `/api/mastery/learners/${learnerId}/guardians`, { ...asStudent, body: { email: "x@example.com", relation: "parent" } })).status === 403);
	check("student-owner cannot change placement (403)", (await call("POST", `/api/mastery/learners/${learnerId}/placement`, { ...asStudent, body: { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 2, confirm: true } })).status === 403);
	check("learner still exists after denied requests", Number((await db.query("SELECT COUNT(*) n FROM ml_learners WHERE id = ?", [learnerId]))[0][0].n) === 1);
	await db.query("INSERT INTO ml_user_roles (id, user_id, role_id, created_at, updated_at) VALUES (UUID(), ?, ?, NOW(), NOW())", [parent.id, fam.id]);

	check("removal needs typed name", (await call("DELETE", `/api/mastery/learners/${learnerId}`, { auth: parent, body: { confirmText: "e2e kid" } })).status === 422);
	check("parent removes learner", (await call("DELETE", `/api/mastery/learners/${learnerId}`, { auth: parent, body: { confirmText: "E2E Kid" } })).status === 200);
	const [[gone]] = await db.query("SELECT COUNT(*) n FROM ml_attempts WHERE learner_id = ?", [learnerId]);
	check("cascade removed learner data", Number(gone.n) === 0);
	learnerId = null;
	await db.query("DELETE FROM ml_feedback WHERE message = 'E2E feedback (safe to delete)'");
	console.log(`\nE2E passed: ${passed} checks`);
} finally {
	if (learnerId) await db.query("DELETE FROM ml_learners WHERE id = ?", [learnerId]);
	// Remove the temporary Family grant (only if this run added it)
	if (grantedRole && fam) {
		await db.query("DELETE FROM ml_user_roles WHERE user_id = ? AND role_id = ?", [parent.id, fam.id]);
		if (hadRole) await db.query("INSERT INTO ml_user_roles (id, user_id, role_id, created_at, updated_at) VALUES (UUID(), ?, ?, NOW(), NOW())", [parent.id, fam.id]); // restore a pre-existing grant
	}
	await db.end();
}
