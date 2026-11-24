// End-to-end test of learner profiles, assignments and the three views against a RUNNING dev
// server and the real dev MySQL database (separate identities via signed tokens + real PIN unlocks).
//   1. yarn dev      2. node tests/e2e/assignments.e2e.mjs
// Creates temporary learners (and their assignments / notifications) owned by existing dev users and
// removes everything it created at the end. Never prints secrets. localhost only.
import fs from "node:fs";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { generateSheet } from "../../lib/mastery/sheet.js";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");

const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT });
const [users] = await db.query("SELECT id, role, email FROM users WHERE status = 1 OR status IS NULL");
const instructors = users.filter((u) => u.role === "instructor");
const student = users.find((u) => u.role === "student");
assert.ok(instructors.length >= 2 && student, "need two instructors and a student in the dev DB");
const [teacher, parent] = instructors; // teacher teaches; parent owns a family child
const tok = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "15m" });
const [[outsiderLearner]] = await db.query("SELECT id FROM ml_learners WHERE owner_user_id = ? LIMIT 1", [parent.id]).then((r) => (r[0].length ? r : [[{ id: null }]]));

let passed = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	passed++;
};
const call = async (method, path, { as, learner, body } = {}) => {
	const headers = { "Content-Type": "application/json" };
	if (as) headers.Authorization = tok(as);
	if (learner) headers["x-learner-token"] = learner;
	const res = await fetch(`${BASE}/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	let json = null;
	try {
		json = await res.json();
	} catch (e) {
		/* empty */
	}
	return { status: res.status, json };
};
const M = (p) => `mastery/${p}`;
// Right answers, computed like the server does: regenerate the sheet from the signed start token.
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);
const answersFor = (startToken, wrongFirst = 0) => {
	const t = jwt.decode(startToken);
	return generateSheet(t.lv, t.set, t.ws, t.v).problems.map((p, i) => (i < wrongFirst ? [p.answer.kind === "multi" ? p.answer.parts.map(() => "x") : "x", right(p)] : [right(p)]));
};
const made = [];
const WS = { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 };

try {
	// ---- profiles
	const mk = async (owner, name, extra = {}) => {
		const r = await call("POST", M("learners/"), { as: owner, body: { displayName: name, pin: "4321", subjects: ["math"], dailyGoal: 2, timeZone: "UTC", ...extra } });
		assert.equal(r.status, 201, `create ${name}: ${JSON.stringify(r.json)}`);
		made.push({ id: r.json.learner.id, owner, name });
		return r.json.learner;
	};
	const a1 = await mk(teacher, "E2E Alpha", { grade: "C3", age: 8, contactName: "Rao", contactEmail: "rao@example.com", birthYear: undefined });
	const a2 = await mk(teacher, "E2E Beta", { grade: "C3" });
	const kid = await mk(parent, "E2E Kid", { grade: "UKG", age: 5 });
	check("grade label and age are returned", a1.grade === "C3" && a1.gradeLabel === "Class 3" && a1.age === 8 && kid.gradeLabel === "UKG");
	check("date of birth and contact are not in the learner payload", !JSON.stringify(a1).match(/contact|birth_date|birthDate|rao@/i));
	check("invalid grade is refused", (await call("PATCH", M(`learners/${a1.id}/`), { as: teacher, body: { grade: "C9" } })).status === 422);
	check("invalid age is refused", (await call("PATCH", M(`learners/${a1.id}/`), { as: teacher, body: { age: 99 } })).status === 422);
	const dob = await call("PATCH", M(`learners/${a1.id}/`), { as: teacher, body: { birthDate: "2017-05-20" } });
	check("date of birth saved; age derived from it", dob.status === 200 && dob.json.learner.age >= 8);
	check("student account cannot edit a learner it does not own", (await call("PATCH", M(`learners/${a1.id}/`), { as: student, body: { grade: "C1" } })).status === 404);
	const addG = await call("POST", M(`learners/${kid.id}/guardians/`), { as: parent, body: { email: teacher.email, relation: "instructor" } });
	check("parent links the teacher as the learner's instructor", addG.status === 200);

	// ---- scope
	const ov = (as, qs = "") => call("GET", M(`learners/overview/${qs}`), { as });
	const teacherOv = await ov(teacher);
	const ids = teacherOv.json.learners.map((l) => l.id);
	check("teacher sees own + linked learners", [a1.id, a2.id, kid.id].every((id) => ids.includes(id)));
	check("teacher does not see the other instructor's other learners", !outsiderLearner.id || !ids.includes(outsiderLearner.id));
	check("grade filter", (await ov(teacher, "?grade=C3")).json.learners.filter((l) => made.some((m) => m.id === l.id)).map((l) => l.id).sort().join() === [a1.id, a2.id].sort().join());
	check("name search", (await ov(teacher, "?q=Beta")).json.learners.map((l) => l.id).join() === a2.id);
	check("parent sees the child but not the teacher's learners", (await ov(parent)).json.learners.some((l) => l.id === kid.id) && !(await ov(parent)).json.learners.some((l) => l.id === a1.id));
	check("anonymous overview is refused", (await ov(null)).status === 401);

	// ---- assigning
	const pub = (as, body) => call("POST", M("assignments/"), { as, body });
	const due = new Date(Date.now() + 86400000).toISOString();
	check("a student account cannot assign", (await pub(student, { ...WS, learnerIds: [a1.id] })).status === 403);
	check("anonymous cannot assign", (await pub(null, { ...WS, learnerIds: [a1.id] })).status === 401);
	if (outsiderLearner.id) check("an instructor cannot assign to a learner they do not teach", (await pub(teacher, { ...WS, learnerIds: [outsiderLearner.id] })).status === 403);
	check("mixed in-scope and out-of-scope refuses the whole group", !outsiderLearner.id || (await pub(teacher, { ...WS, learnerIds: [a1.id, outsiderLearner.id] })).status === 403);
	const preview = await pub(teacher, { ...WS, learnerIds: [a1.id, a2.id], dueAt: due, instructions: "Go slowly", preview: true });
	check("review step", preview.status === 200 && preview.json.preview && preview.json.students.length === 2);
	const [[c0]] = await db.query("SELECT COUNT(*) n FROM ml_assignment_targets WHERE learner_id IN (?, ?)", [a1.id, a2.id]);
	check("review wrote nothing", c0.n === 0);
	const group = await pub(teacher, { ...WS, learnerIds: [a1.id, a2.id], dueAt: due, instructions: "Go slowly", groupLabel: "E2E group" });
	check("group assignment published", group.status === 201 && group.json.students.length === 2);
	const retry = await pub(teacher, { ...WS, learnerIds: [a2.id, a1.id], dueAt: due, instructions: "Go slowly", groupLabel: "E2E group" });
	check("a retry is recognised, not duplicated", retry.status === 200 && retry.json.duplicate === true);
	const [[c1]] = await db.query("SELECT COUNT(*) n FROM ml_assignment_targets WHERE learner_id IN (?, ?)", [a1.id, a2.id]);
	check("exactly two target rows", c1.n === 2);
	const kidWork = await pub(teacher, { ...WS, learnerIds: [kid.id], dueAt: due, title: "E2E kid sheet" });
	check("assignment to a linked family child", kidWork.status === 201);
	check("guardian of the child is notified once, the teacher is not", kidWork.json.notified && kidWork.json.notified.created === 1);
	await pub(teacher, { ...WS, learnerIds: [kid.id], dueAt: due, title: "E2E kid sheet" });

	// ---- the learner's side (real PIN unlock)
	const unlock = async (owner, l) => (await call("POST", M(`learners/${l.id}/unlock/`), { as: owner, body: { pin: "4321" } })).json.learnerToken;
	const t1 = await unlock(teacher, a1);
	const t2 = await unlock(teacher, a2);
	const tk = await unlock(parent, kid);
	check("PIN unlock gives learner sessions", !!t1 && !!t2 && !!tk);
	const home = (owner, t) => call("GET", M("study/home/"), { as: owner, learner: t });
	let h1 = await home(teacher, t1);
	check("learner sees only their own assignment, pending", h1.json.assignments.length === 1 && h1.json.assignments[0].status === "pending" && h1.json.assignments[0].instructions === "Go slowly");
	check("learner page has no date of birth or contact", !JSON.stringify(h1.json).match(/contact|birth_date|birthDate|rao@/i));
	const asgId = h1.json.assignments[0].id;
	check("another learner cannot start it as theirs", (await call("POST", M("study/start/"), { as: parent, learner: tk, body: { assignmentId: asgId } })).status === 404);

	const start = await call("POST", M("study/start/"), { as: teacher, learner: t1, body: { assignmentId: asgId } });
	check("starting marks it in progress", start.status === 200 && start.json.assignmentId === asgId);
	check("learner sees in_progress, not completed", (await home(teacher, t1)).json.assignments[0].status === "in_progress");
	const dashT = (id) => call("GET", M(`learners/${id}/`), { as: teacher });
	check("instructor sees in_progress", (await dashT(a1.id)).json.assignments[0].status === "in_progress");
	check("the classmate is still pending", (await home(teacher, t2)).json.assignments[0].status === "pending");

	// ---- submit and compare all views with the stored attempt
	const responses = answersFor(start.json.startToken, 2);
	const submit = await call("POST", M("study/submit/"), { as: teacher, learner: t1, body: { startToken: start.json.startToken, clientAttemptId: "e2e-alpha-attempt-1", responses, durationMs: 120000 } });
	check("submission graded", [200, 201].includes(submit.status) && submit.json.duplicate === false);
	const again = await call("POST", M("study/submit/"), { as: teacher, learner: t1, body: { startToken: start.json.startToken, clientAttemptId: "e2e-alpha-attempt-1", responses, durationMs: 120000 } });
	check("a retried sync is a duplicate", [200, 201].includes(again.status) && again.json.duplicate === true);
	const [[att]] = await db.query("SELECT id, correct_first, total, stars FROM ml_attempts WHERE learner_id = ? AND client_attempt_id = 'e2e-alpha-attempt-1'", [a1.id]);
	const [[tgt]] = await db.query("SELECT attempt_id, completed_at, started_at FROM ml_assignment_targets WHERE learner_id = ?", [a1.id]);
	check("database: target points at the graded attempt", tgt.attempt_id === att.id && !!tgt.completed_at && !!tgt.started_at);
	const doneStudent = (await home(teacher, t1)).json;
	const doneInstr = (await dashT(a1.id)).json;
	for (const [name, a] of [["student", doneStudent.assignments[0]], ["instructor", doneInstr.assignments[0]]]) {
		check(`${name}: completed with the authoritative score`, a.status === "completed" && a.result.attemptId === att.id && a.result.correctFirst === att.correct_first && a.result.total === att.total && a.result.stars === att.stars);
	}
	check("counts agree across views", JSON.stringify(doneStudent.assignmentCounts) === JSON.stringify(doneInstr.assignmentCounts) && doneStudent.assignmentCounts.completed === 1);
	check("ladder daily goal count comes from the same attempt", doneStudent.todayCount === doneInstr.todayCount && doneStudent.todayCount >= 1);
	check("the classmate is unaffected", (await home(teacher, t2)).json.assignmentCounts.completed === 0 && (await home(teacher, t2)).json.todayCount === 0);
	check("instructor overview shows A1 all done, A2 not started", (await ov(teacher)).json.learners.find((l) => l.id === a1.id).status === "all_done" && (await ov(teacher)).json.learners.find((l) => l.id === a2.id).status === "not_started");

	// ---- Family dashboard (guardian) for the child, then complete it
	const famBefore = await call("GET", M(`learners/${kid.id}/`), { as: parent });
	check("guardian sees the child's assignment (pending)", famBefore.json.assignments.length === 1 && famBefore.json.assignments[0].status === "pending");
	const ks = await call("POST", M("study/start/"), { as: parent, learner: tk, body: { assignmentId: famBefore.json.assignments[0].id } });
	check("guardian sees it in progress", (await call("GET", M(`learners/${kid.id}/`), { as: parent })).json.assignments[0].status === "in_progress");
	await call("POST", M("study/submit/"), { as: parent, learner: tk, body: { startToken: ks.json.startToken, clientAttemptId: "e2e-kid-attempt-1", responses: answersFor(ks.json.startToken), durationMs: 120000 } });
	const [[katt]] = await db.query("SELECT id, correct_first, total, stars FROM ml_attempts WHERE learner_id = ?", [kid.id]);
	const famAfter = (await call("GET", M(`learners/${kid.id}/`), { as: parent })).json;
	const teachAfter = (await call("GET", M(`learners/${kid.id}/`), { as: teacher })).json;
	check("guardian and linked instructor see the same completed score", famAfter.assignments[0].status === "completed" && teachAfter.assignments[0].status === "completed" && famAfter.assignments[0].result.correctFirst === katt.correct_first && teachAfter.assignments[0].result.stars === katt.stars && famAfter.lastUpdateAt);
	check("family view carries the grade, age, stars and goal", famAfter.learner.gradeLabel === "UKG" && famAfter.learner.age === 5 && famAfter.totalStars === katt.stars && famAfter.dailyGoal === 2);

	// ---- isolation
	check("the parent cannot open the teacher's learner", (await call("GET", M(`learners/${a1.id}/`), { as: parent })).status === 404);
	check("a student account cannot open the child", (await call("GET", M(`learners/${kid.id}/`), { as: student })).status === 404);
	check("the child's session cannot open another learner", (await call("GET", M(`learners/${a1.id}/`), { as: parent, learner: tk })).status === 404);
	check("a guardian cannot cancel the teacher's assignment", [403, 404].includes((await call("PATCH", M(`assignments/${asgId}/`), { as: parent, body: { cancel: true } })).status));
	check("a student cannot cancel it", (await call("PATCH", M(`assignments/${asgId}/`), { as: student, body: { cancel: true } })).status === 403);
	check("a learner session on its own cannot assign", (await call("POST", M("assignments/"), { learner: tk, body: { ...WS, learnerIds: [kid.id] } })).status === 401);

	// ---- notifications
	const notes = (await call("GET", "notifications/", { as: parent })).json.notifications.filter((n) => n.title.includes("E2E Kid"));
	check("the guardian has exactly one in-app notice for the child's assignment", notes.filter((n) => n.type === "worksheet_assigned").length === 1);
	const [[mail]] = await db.query("SELECT email_status FROM notifications WHERE type = 'worksheet_assigned' AND user_id = ? ORDER BY created_at DESC LIMIT 1", [parent.id]);
	check("e-mail status is recorded and nothing is claimed sent without SES settings", process.env.AWS_SES_USER ? true : mail.email_status !== "sent");
	check("the teacher gets no notice about their own action", !(await call("GET", "notifications/", { as: teacher })).json.notifications.some((n) => n.title.includes("E2E Kid")));
	const newDue = new Date(Date.now() + 3 * 86400000).toISOString();
	const kidAsg = famAfter.assignments[0].id;
	const chg = await call("PATCH", M(`assignments/${kidAsg}/`), { as: teacher, body: { dueAt: newDue } });
	check("due date change saved and announced once", chg.status === 200 && chg.json.changed.includes("due") && chg.json.notified.created === 1);
	const chg2 = await call("PATCH", M(`assignments/${kidAsg}/`), { as: teacher, body: { dueAt: newDue } });
	check("repeating it changes and announces nothing", chg2.json.changed.length === 0);

	// ---- cancel keeps results
	const cx = await call("PATCH", M(`assignments/${asgId}/`), { as: teacher, body: { cancel: true } });
	check("cancel works and is idempotent", cx.status === 200 && (await call("PATCH", M(`assignments/${asgId}/`), { as: teacher, body: { cancel: true } })).json.changed.length === 0);
	check("cancelled work leaves the learner's list but results stay for adults", !(await home(teacher, t2)).json.assignments.length && (await dashT(a1.id)).json.assignments[0].status === "cancelled");
	check("the learner's stars survive", (await home(teacher, t1)).json.totalStars === att.stars);

	console.log(`assignments e2e: ${passed} checks passed`);
} finally {
	const ids = made.map((m) => m.id);
	if (ids.length) {
		const [as] = await db.query("SELECT DISTINCT assignment_id FROM ml_assignment_targets WHERE learner_id IN (?)", [ids]);
		const aids = as.map((r) => r.assignment_id);
		if (aids.length) {
			await db.query("DELETE FROM notifications WHERE ref_id IN (?)", [aids]);
			await db.query("DELETE FROM ml_assignments WHERE id IN (?)", [aids]); // cascades to targets
		}
		await db.query("DELETE FROM ml_learners WHERE id IN (?)", [ids]); // cascades attempts, progress, guardians, enrolments
	}
	await db.end();
}
