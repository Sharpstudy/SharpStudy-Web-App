// End-to-end test of the instructor student directory and the account-student <-> learner bridge against a
// RUNNING dev server and the real dev MySQL database.
//   1. yarn dev      2. node tests/e2e/student-directory.e2e.mjs
// Creates temporary courses, enrolments, learners and assignments for existing dev users and removes only
// what it created. Never prints secrets. localhost only.
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { generateSheet } from "../../lib/mastery/sheet.js";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");

const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT, timezone: "Z" }); // the app stores UTC
const [users] = await db.query("SELECT id, role, email FROM users WHERE status = 1 OR status IS NULL ORDER BY created_at");
const instructors = users.filter((u) => u.role === "instructor");
const students = users.filter((u) => u.role === "student");
assert.ok(instructors.length >= 2 && students.length >= 4, "need two instructors and four students in the dev DB");
const [teacher, other] = instructors;
const [s1, s2, s3, s4] = students;
const tok = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "15m" });

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
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);
const answersFor = (startToken) => {
	const t = jwt.decode(startToken);
	return generateSheet(t.lv, t.set, t.ws, t.v).problems.map((p) => [right(p)]);
};
const WS = { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 };

let [[cat]] = await db.query("SELECT id FROM categories LIMIT 1");
let tempCat = null;
if (!cat) {
	tempCat = randomUUID();
	await db.query("INSERT INTO categories (id, category, slug, created_at, updated_at) VALUES (?, 'tmp-e2e', 'tmp-e2e', NOW(), NOW())", [tempCat]);
	cat = { id: tempCat };
}
const c1 = randomUUID();
const c2 = randomUUID();
const c3 = randomUUID();
const addCourse = (id, title, owner) => db.query("INSERT INTO courses (id, title, slug, userId, catId, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())", [id, title, `e2e-sd-${id.slice(0, 8)}`, owner, cat.id]);
await addCourse(c1, "E2E Maths A", teacher.id);
await addCourse(c2, "E2E Maths B", teacher.id);
await addCourse(c3, "E2E Other", other.id);
const enrol = (u, c, status = "paid") => db.query("INSERT INTO enrolments (id, userId, courseId, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())", [randomUUID(), u.id, c, status]);
await enrol(s1, c1);
await enrol(s1, c2);
await enrol(s2, c1);
await enrol(s3, c1, "unpaid");
await enrol(s4, c3);
const madeLearners = [];

try {
	const list = (as, qs = "") => call("GET", `instructor/students/${qs}`, { as });
	// ---- authorization of the endpoint itself
	check("anonymous gets 401", (await list(null)).status === 401);
	check("a student account gets 403", (await list(s1)).status === 403);

	// ---- directory: one row per person, only my students
	const d = await list(teacher);
	check("directory loads", d.status === 200 && Array.isArray(d.json.students));
	const mine = d.json.students.filter((r) => [s1.id, s2.id, s3.id, s4.id].includes(r.userId));
	check("a student enrolled in two courses appears exactly once", mine.filter((r) => r.userId === s1.id).length === 1);
	const row1 = mine.find((r) => r.userId === s1.id);
	check("…with both courses", ["E2E Maths A", "E2E Maths B"].every((t) => row1.courses.some((c) => c.title === t)) && new Set(row1.courses.map((c) => c.id)).size === row1.courses.length);
	check("my other paid student is listed, the unpaid one and the other instructor's student are not", mine.some((r) => r.userId === s2.id) && !mine.some((r) => r.userId === s3.id || r.userId === s4.id));
	check("summary numbers are real", d.json.summary.total >= 2 && d.json.summary.needProfile >= 2 && typeof d.json.summary.openAssignments === "number");
	check("no student is shown with invented progress", mine.every((r) => r.status === "no_profile" && r.grade === null && r.counts.assigned === 0 && r.canAssign === false));
	check("course filter", (await list(teacher, `?courseId=${c2}`)).json.students.map((r) => r.userId).join() === s1.id && (await list(teacher, `?courseId=${c1}`)).json.students.filter((r) => [s1.id, s2.id].includes(r.userId)).length === 2);
	check("a course I do not teach is refused", (await list(teacher, `?courseId=${c3}`)).status === 403);
	check("search by e-mail", (await list(teacher, `?q=${encodeURIComponent(s2.email)}`)).json.students.some((r) => r.userId === s2.id));
	check("the other instructor sees only their own student", (await list(other)).json.students.some((r) => r.userId === s4.id) && !(await list(other)).json.students.some((r) => r.userId === s1.id));

	// ---- the bridge: create a profile for a course student
	const link = (as, body) => call("POST", "instructor/students/link/", { as, body });
	const mkBody = { action: "create", studentUserId: s1.id, pin: "4321", subjects: ["math"], dailyGoal: 2, timeZone: "UTC", grade: "C3", age: 8 };
	check("a student cannot create/link profiles", (await link(s1, mkBody)).status === 403);
	check("cannot create for a student of another instructor", (await link(teacher, { ...mkBody, studentUserId: s4.id })).status === 404);
	check("cannot create for an unpaid enrolment", (await link(teacher, { ...mkBody, studentUserId: s3.id })).status === 404);
	check("a bad PIN is refused and nothing is created", (await link(teacher, { ...mkBody, pin: "1" })).status === 422);
	const made = await link(teacher, mkBody);
	check("profile created for the student", made.status === 201 && !!made.json.learnerId);
	madeLearners.push(made.json.learnerId);
	check("a second profile for the same student is refused", (await link(teacher, mkBody)).status === 409);
	const row = (await list(teacher)).json.students.find((r) => r.userId === s1.id);
	check("the SAME row now carries the profile (grade, age, subjects)", row.learnerId === made.json.learnerId && row.gradeLabel === "Class 3" && row.age === 8 && row.subjects.join() === "math" && row.canAssign === true);
	check("grade filter finds them", (await list(teacher, "?grade=C3")).json.students.some((r) => r.userId === s1.id) && !(await list(teacher, "?grade=C5")).json.students.some((r) => r.userId === s1.id));
	const [[dbRow]] = await db.query("SELECT student_user_id, owner_user_id FROM ml_learners WHERE id = ?", [made.json.learnerId]);
	check("database: linked to the student, owned by the instructor", dbRow.student_user_id === s1.id && dbRow.owner_user_id === teacher.id);

	// ---- link an existing profile (explicit, confirmed, both sides authorised)
	const mine2 = await call("POST", "mastery/learners/", { as: teacher, body: { displayName: "E2E Spare", pin: "4321", subjects: ["math"], timeZone: "UTC" } });
	madeLearners.push(mine2.json.learner.id);
	const theirs = await call("POST", "mastery/learners/", { as: other, body: { displayName: "E2E Theirs", pin: "4321", subjects: ["math"], timeZone: "UTC" } });
	madeLearners.push(theirs.json.learner.id);
	check("link needs the confirmation", (await link(teacher, { action: "link", studentUserId: s2.id, learnerId: mine2.json.learner.id })).status === 422);
	check("cannot link a profile you do not manage", (await link(teacher, { action: "link", studentUserId: s2.id, learnerId: theirs.json.learner.id, confirm: true })).status === 404);
	check("cannot link a student you do not teach", (await link(teacher, { action: "link", studentUserId: s4.id, learnerId: mine2.json.learner.id, confirm: true })).status === 404);
	check("linking an existing profile works", (await link(teacher, { action: "link", studentUserId: s2.id, learnerId: mine2.json.learner.id, confirm: true })).status === 200);
	check("a linked profile cannot be linked again", (await link(teacher, { action: "link", studentUserId: s2.id, learnerId: made.json.learnerId, confirm: true })).status === 409);
	check("the other instructor cannot unlink my profile", (await link(other, { action: "unlink", learnerId: mine2.json.learner.id })).status === 404);
	check("unlink keeps the profile", (await link(teacher, { action: "unlink", learnerId: mine2.json.learner.id })).json.unlinked === true && (await call("GET", `mastery/learners/${mine2.json.learner.id}/`, { as: teacher })).status === 200);

	// ---- the student's own access, with the PIN
	const picker = await call("GET", "mastery/learners/", { as: s1 });
	const selfRows = picker.json.learners.filter((l) => l.relation === "self");
	check("the student sees their linked profile (and nothing of the instructor's other learners)", picker.status === 200 && selfRows.length === 1 && selfRows[0].id === made.json.learnerId && !picker.json.learners.some((l) => [teacher.id].includes(l.ownerId)) && !picker.json.learners.some((l) => madeLearners.slice(1).includes(l.id)));
	check("another student cannot unlock it", (await call("POST", `mastery/learners/${made.json.learnerId}/unlock/`, { as: s2, body: { pin: "4321" } })).status === 404);
	check("a wrong PIN is refused", (await call("POST", `mastery/learners/${made.json.learnerId}/unlock/`, { as: s1, body: { pin: "0000" } })).status === 401);
	const unlocked = await call("POST", `mastery/learners/${made.json.learnerId}/unlock/`, { as: s1, body: { pin: "4321" } });
	check("the student unlocks with the PIN", unlocked.status === 200 && !!unlocked.json.learnerToken);
	const tk = unlocked.json.learnerToken;
	check("the session is bound to the student's account", (await call("GET", "mastery/study/home/", { as: teacher, learner: tk })).status === 401);

	// ---- assigning from the directory
	const pub = (as, body) => call("POST", "mastery/assignments/", { as, body });
	check("raw account-student ids are rejected", (await pub(teacher, { ...WS, learnerIds: [s1.id] })).status === 403);
	check("the student cannot assign", (await pub(s1, { ...WS, learnerIds: [made.json.learnerId] })).status === 403);
	const due = new Date(Date.now() + 86400000).toISOString();
	const body = { ...WS, learnerIds: [made.json.learnerId], dueAt: due, courseId: c1, instructions: "Directory test" };
	const a = await pub(teacher, body);
	check("assignment published to the linked profile", a.status === 201 && a.json.students.length === 1);
	check("a retry is not duplicated", (await pub(teacher, body)).json.duplicate === true);
	check("the student is notified in the app, with a link to their own page", (await call("GET", "notifications/", { as: s1 })).json.notifications.some((n) => n.type === "worksheet_assigned" && n.link === "/study/"));

	// ---- start / complete and consistency
	const home = (await call("GET", "mastery/study/home/", { as: s1, learner: tk })).json;
	check("the student sees it as pending", home.assignments.length === 1 && home.assignments[0].status === "pending");
	const aid = home.assignments[0].id;
	const start = await call("POST", "mastery/study/start/", { as: s1, learner: tk, body: { assignmentId: aid } });
	check("starting marks it in progress in the directory", start.status === 200 && (await list(teacher)).json.students.find((r) => r.userId === s1.id).status === "in_progress");
	const sub = await call("POST", "mastery/study/submit/", { as: s1, learner: tk, body: { startToken: start.json.startToken, clientAttemptId: "e2e-sd-attempt-1", responses: answersFor(start.json.startToken), durationMs: 90000 } });
	check("graded submission", [200, 201].includes(sub.status));
	const [[att]] = await db.query("SELECT id, correct_first, total, stars, completed_at FROM ml_attempts WHERE learner_id = ?", [made.json.learnerId]);
	const final = (await list(teacher)).json.students.find((r) => r.userId === s1.id);
	check("directory: all done, counts and last activity from the stored attempt", final.status === "all_done" && final.counts.completed === 1 && new Date(final.lastActivityAt).getTime() === new Date(att.completed_at).getTime());
	const asInstructor = (await call("GET", `mastery/learners/${made.json.learnerId}/`, { as: teacher })).json;
	const asStudent = (await call("GET", "mastery/study/home/", { as: s1, learner: tk })).json;
	check("instructor and student show the same completed score", asInstructor.assignments[0].status === "completed" && asStudent.assignments[0].result.attemptId === att.id && asInstructor.assignments[0].result.correctFirst === att.correct_first && asStudent.assignments[0].result.stars === att.stars);
	check("the student's view has no date of birth or contact, and no edit rights", asInstructor.profile !== null && !JSON.stringify(asStudent).match(/birth_date|birthDate|contact/i) && (await call("PATCH", `mastery/learners/${made.json.learnerId}/`, { as: s1, learner: tk, body: { grade: "C7" } })).status === 403);
	check("summary counts the completed assignment", (await list(teacher)).json.summary.completedAssignments >= 1);
	check("the other instructor cannot open my student's profile", (await call("GET", `mastery/learners/${made.json.learnerId}/`, { as: other })).status === 404);

	console.log(`student-directory e2e: ${passed} checks passed`);
} finally {
	const ids = madeLearners;
	if (ids.length) {
		const [as] = await db.query("SELECT DISTINCT assignment_id FROM ml_assignment_targets WHERE learner_id IN (?)", [ids]);
		const aids = as.map((r) => r.assignment_id);
		if (aids.length) {
			await db.query("DELETE FROM notifications WHERE ref_id IN (?)", [aids]);
			await db.query("DELETE FROM ml_assignments WHERE id IN (?)", [aids]);
		}
		await db.query("DELETE FROM ml_learners WHERE id IN (?)", [ids]);
	}
	await db.query("DELETE FROM courses WHERE id IN (?, ?, ?)", [c1, c2, c3]); // cascades the temporary enrolments
	if (tempCat) await db.query("DELETE FROM categories WHERE id = ?", [tempCat]);
	await db.end();
}
