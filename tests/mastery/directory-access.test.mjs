// Regression tests for WHO can see WHICH students and learners:
//   - the instructor Students directory (lib/mastery/directory.js)
//   - the Family dashboard lists and details (listLearners / learnerDashboard / learnerOverview)
// Plus a guard for the layout bug that made names wrap one character per line.
//
// Access rules these tests lock in (all pre-existing, none changed):
//   instructor directory = paid students of courses the instructor OWNS + learner profiles the instructor
//                          owns or is explicitly linked to (ml_learner_guardians). Never "everyone".
//   family list          = learners the account owns, is linked to, or (for a student account) is the linked student.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createMemoryRepo } from "./memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import * as asg from "../../lib/mastery/assignments.js";
import { studentDirectory } from "../../lib/mastery/directory.js";
import { createStudentProfile } from "../../lib/mastery/studentLinks.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { verifyLearnerToken } from "../../lib/mastery/tokens.js";

const account = (userId, role = "student", extra = []) => ({ kind: "account", userId, role, name: userId, permissions: resolvePermissions(role, extra) });
const T = Date.parse("2026-10-14T15:00:00Z");
const WS = { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 };
const dir = (repo, who, f = {}) => studentDirectory(repo, who, f, { now: T });
const enrol = (repo, userId, courseId, status = "paid") => repo._db.courseEnrolments.push({ userId, courseId, status, created_at: new Date(T).toISOString() });

async function world() {
	const repo = createMemoryRepo();
	const u = (id, first, last, role = "student") => ({ id, email: `${id}@example.com`, role, first_name: first, last_name: last });
	repo._db.users.push(
		u("inst-a", "Ada", "Teacher", "instructor"),
		u("inst-b", "Bo", "Teacher", "instructor"),
		u("inst-empty", "Eve", "Newcomer", "instructor"),
		u("admin", "Root", "Admin", "admin"),
		u("fam-a", "Fran", "Family"),
		u("fam-b", "Finn", "Family"),
		u("fam-empty", "Nia", "Nobody"),
		u("stu-a1", "Sam", "Lee"),
		u("stu-b1", "Sam", "Lee"), // same NAME as stu-a1, a different person taught by someone else
		u("stu-shared", "Pat", "Both")
	);
	repo._db.courses = [
		{ id: "course-a", title: "A maths", userId: "inst-a" },
		{ id: "course-b", title: "B maths", userId: "inst-b" },
		{ id: "course-a2", title: "A reading", userId: "inst-a" },
	];
	repo._db.courseEnrolments = [];
	repo._db.lessons = {};
	repo._db.lessonsDone = {};
	enrol(repo, "stu-a1", "course-a");
	enrol(repo, "stu-a1", "course-a2"); // two courses, one person
	enrol(repo, "stu-b1", "course-b");
	enrol(repo, "stu-shared", "course-a");
	enrol(repo, "stu-shared", "course-b"); // genuinely taught by both
	const A = account("inst-a", "instructor");
	const B = account("inst-b", "instructor");
	const famA = account("fam-a", "student", ["learners.create"]);
	const famB = account("fam-b", "student", ["learners.create"]);
	const mk = (who, name, extra = {}) => svc.createLearner(repo, who, { displayName: name, pin: "1234", subjects: ["math"], timeZone: "UTC", ...extra });
	// family learners
	const a1 = await mk(famA, "Kid A1", { grade: "C1" });
	const a2 = await mk(famA, "Kid A2", { grade: "C2" });
	const b1 = await mk(famB, "Kid B1", { grade: "C3" });
	// instructor-managed profiles for course students
	const pa = (await createStudentProfile(repo, A, { studentUserId: "stu-a1", pin: "1234", subjects: ["math"], timeZone: "UTC", grade: "C4" })).learnerId;
	const pb = (await createStudentProfile(repo, B, { studentUserId: "stu-b1", pin: "1234", subjects: ["math"], timeZone: "UTC", grade: "C5" })).learnerId;
	return { repo, A, B, famA, famB, a1, a2, b1, pa, pb, empty: account("inst-empty", "instructor"), admin: account("admin", "admin"), nobody: account("fam-empty", "student", ["learners.create"]) };
}
const names = (d) => d.students.map((s) => s.name).sort();

// ------------------------------------------------------------------ unrelated instructors

test("an instructor sees only their own students and never an unrelated instructor's", async () => {
	const { repo, A, B } = await world();
	const a = await dir(repo, A);
	const b = await dir(repo, B);
	assert.deepEqual(a.students.map((s) => s.userId).sort(), ["stu-a1", "stu-shared"]);
	assert.deepEqual(b.students.map((s) => s.userId).sort(), ["stu-b1", "stu-shared"]);
	assert.ok(!a.students.some((s) => s.userId === "stu-b1"), "A does not see B's student");
	assert.ok(!b.students.some((s) => s.userId === "stu-a1"), "B does not see A's student");
	// the shared student shows only the course that THIS instructor teaches
	assert.deepEqual(a.students.find((s) => s.userId === "stu-shared").courses.map((c) => c.title), ["A maths"]);
	assert.deepEqual(b.students.find((s) => s.userId === "stu-shared").courses.map((c) => c.title), ["B maths"]);
	// totals describe only their own scope
	assert.equal(a.summary.total, 2);
});

test("an unrelated instructor cannot use another instructor's course filter, open their learner, assign to them or read their progress", async () => {
	const { repo, A, B, pa } = await world();
	await assert.rejects(dir(repo, B, { courseId: "course-a" }), { status: 403 });
	await assert.rejects(svc.learnerDashboard(repo, B, pa, { now: T }), { status: 404 });
	await assert.rejects(asg.createAssignment(repo, B, { ...WS, learnerIds: [pa] }, { now: T }), { status: 403 });
	await assert.rejects(createStudentProfile(repo, B, { studentUserId: "stu-a1", pin: "1234", subjects: ["math"] }), { status: 404 }, "a student B does not teach");
	// the owner is unaffected by all of the above
	assert.equal((await svc.learnerDashboard(repo, A, pa, { now: T })).learner.id, pa);
	assert.equal(repo._db.assignments.length, 0);
});

test("an administrator or a student account does not get a global directory", async () => {
	const { repo, admin } = await world();
	assert.deepEqual((await dir(repo, admin)).students, [], "the directory is scoped by course ownership, even for an admin account");
	await assert.rejects(dir(repo, account("stu-a1")), { status: 403 });
	await assert.rejects(dir(repo, account("fam-a")), { status: 403 });
	await assert.rejects(dir(repo, null), { status: 401 });
});

test("profile-only rows appear only through ownership or an explicit link, and disappear when the link is removed", async () => {
	const { repo, A, B, famA, a1 } = await world();
	assert.ok(!(await dir(repo, A)).students.some((s) => s.learnerId === a1.id), "a family child is not an instructor's student");
	await svc.addGuardian(repo, famA, a1.id, "inst-a@example.com", "instructor");
	const row = (await dir(repo, A)).students.find((s) => s.learnerId === a1.id);
	assert.ok(row && row.type === "profile", "visible only after the explicit link");
	assert.ok(!(await dir(repo, B)).students.some((s) => s.learnerId === a1.id), "an unrelated instructor still cannot see it");
	await svc.removeGuardian(repo, famA, a1.id, "inst-a");
	assert.ok(!(await dir(repo, A)).students.some((s) => s.learnerId === a1.id), "gone once unlinked");
});

// ------------------------------------------------------------------ unrelated families

test("a family sees only its own learners; another family's learners, assignments and progress are unreachable", async () => {
	const { repo, A, famA, famB, a1, a2, b1 } = await world();
	assert.deepEqual((await svc.listLearners(repo, famA)).map((l) => l.id).sort(), [a1.id, a2.id].sort());
	assert.deepEqual((await svc.listLearners(repo, famB)).map((l) => l.id), [b1.id]);
	assert.deepEqual((await asg.learnerOverview(repo, famB, {}, { now: T })).learners.map((l) => l.id), [b1.id]);
	// B cannot open, change, unlock or read results of A's children (existence is not revealed)
	for (const id of [a1.id, a2.id]) {
		await assert.rejects(svc.learnerDashboard(repo, famB, id, { now: T }), { status: 404 });
		await assert.rejects(svc.updateLearner(repo, famB, id, { dailyGoal: 9 }), { status: 404 });
		await assert.rejects(svc.unlockLearner(repo, famB, id, "1234"), { status: 404 });
	}
	// an instructor assigns work to A's child (linked); B's family never sees it
	await svc.addGuardian(repo, famA, a1.id, "inst-a@example.com", "instructor");
	await asg.createAssignment(repo, A, { ...WS, learnerIds: [a1.id], title: "Only for A1" }, { now: T });
	assert.deepEqual((await svc.learnerDashboard(repo, famA, a1.id, { now: T })).assignments.map((x) => x.title), ["Only for A1"]);
	assert.deepEqual((await svc.learnerDashboard(repo, famB, b1.id, { now: T })).assignments, []);
	assert.deepEqual((await asg.learnerOverview(repo, famB, {}, { now: T })).learners[0].counts, { assigned: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 });
});

test("a learner session belongs to its own family: it cannot be used under another family's account", async () => {
	const { repo, famA, famB, a1 } = await world();
	const token = (await svc.unlockLearner(repo, famA, a1.id, "1234", { now: T })).learnerToken;
	assert.equal((await svc.resolveLearnerSession(repo, verifyLearnerToken(token), famA)).learnerId, a1.id);
	assert.equal(await svc.resolveLearnerSession(repo, verifyLearnerToken(token), famB), null);
});

test("a guardian linked to one learner sees only that learner, not the rest of the family", async () => {
	const { repo, famA, a1, a2 } = await world();
	repo._db.users.push({ id: "gran", email: "gran@example.com", role: "student" });
	await svc.addGuardian(repo, famA, a1.id, "gran@example.com", "parent");
	const gran = account("gran");
	assert.deepEqual((await svc.listLearners(repo, gran)).map((l) => l.id), [a1.id]);
	await assert.rejects(svc.learnerDashboard(repo, gran, a2.id, { now: T }), { status: 404 });
});

test("an instructor's family list is only what they own or are linked to - never every learner", async () => {
	const { repo, A, B, famA, pa, pb, a1 } = await world();
	assert.deepEqual((await svc.listLearners(repo, A)).map((l) => l.id), [pa]);
	assert.deepEqual((await svc.listLearners(repo, B)).map((l) => l.id), [pb]);
	await svc.addGuardian(repo, famA, a1.id, "inst-a@example.com", "instructor");
	assert.deepEqual((await svc.listLearners(repo, A)).map((l) => [l.id, l.relation]).sort(), [[a1.id, "instructor"], [pa, "owner"]].sort());
	assert.ok(!(await svc.listLearners(repo, B)).some((l) => l.id === a1.id));
});

// ------------------------------------------------------------------ duplicate-looking names

test("identical names are different people: separate rows, separate scope, separate progress", async () => {
	const { repo, A, B, pa, pb } = await world();
	const a = (await dir(repo, A)).students.find((s) => s.name === "Sam Lee");
	const b = (await dir(repo, B)).students.find((s) => s.name === "Sam Lee");
	assert.ok(a && b);
	assert.notEqual(a.userId, b.userId);
	assert.notEqual(a.learnerId, b.learnerId);
	assert.deepEqual([a.learnerId, b.learnerId], [pa, pb]);
	assert.equal((await dir(repo, A)).students.filter((s) => s.name === "Sam Lee").length, 1, "never merged into one row");
	// work given to A's Sam does not appear on B's Sam
	await asg.createAssignment(repo, A, { ...WS, learnerIds: [pa] }, { now: T });
	assert.equal((await dir(repo, A)).students.find((s) => s.name === "Sam Lee").counts.assigned, 1);
	assert.equal((await dir(repo, B)).students.find((s) => s.name === "Sam Lee").counts.assigned, 0);
	// searching by the shared name stays inside each instructor's scope
	assert.deepEqual((await dir(repo, A, { q: "sam lee" })).students.map((s) => s.userId), ["stu-a1"]);
	assert.deepEqual((await dir(repo, B, { q: "sam lee" })).students.map((s) => s.userId), ["stu-b1"]);
});

test("two learner profiles with the same display name under different owners stay separate", async () => {
	const { repo, famA, famB } = await world();
	const x = await svc.createLearner(repo, famA, { displayName: "Twin", pin: "1234", subjects: ["math"], timeZone: "UTC" });
	const y = await svc.createLearner(repo, famB, { displayName: "Twin", pin: "1234", subjects: ["math"], timeZone: "UTC" });
	assert.notEqual(x.id, y.id);
	assert.ok((await svc.listLearners(repo, famA)).some((l) => l.id === x.id) && !(await svc.listLearners(repo, famA)).some((l) => l.id === y.id));
	assert.ok((await svc.listLearners(repo, famB)).some((l) => l.id === y.id) && !(await svc.listLearners(repo, famB)).some((l) => l.id === x.id));
	await assert.rejects(svc.learnerDashboard(repo, famA, y.id, { now: T }), { status: 404 });
});

test("one student in several courses is one row (not duplicated), and the same row when filtering by either course", async () => {
	const { repo, A } = await world();
	const all = await dir(repo, A);
	assert.equal(all.students.filter((s) => s.userId === "stu-a1").length, 1);
	assert.deepEqual((await dir(repo, A, { courseId: "course-a2" })).students.map((s) => s.userId), ["stu-a1"]);
	assert.deepEqual((await dir(repo, A, { courseId: "course-a" })).students.map((s) => s.userId).sort(), ["stu-a1", "stu-shared"]);
});

// ------------------------------------------------------------------ empty results

test("empty directories: no courses, no enrolments, no matches", async () => {
	const { repo, empty, A } = await world();
	const none = await dir(repo, empty);
	assert.deepEqual([none.students, none.courses, none.total, none.pages, none.page], [[], [], 0, 1, 1]);
	assert.deepEqual(none.summary, { total: 0, activeLearners: 0, openAssignments: 0, completedAssignments: 0, needProfile: 0 });
	// a course with nobody enrolled
	repo._db.courses.push({ id: "course-empty", title: "Empty", userId: "inst-empty" });
	const noEnrol = await dir(repo, empty);
	assert.deepEqual([noEnrol.students.length, noEnrol.courses.map((c) => c.title)], [0, ["Empty"]]);
	assert.deepEqual((await dir(repo, empty, { courseId: "course-empty" })).students, []);
	// unpaid enrolments are not students
	enrol(repo, "stu-a1", "course-empty", "unpaid");
	assert.deepEqual((await dir(repo, empty)).students, []);
	// filters with no match return an empty page, not an error
	const miss = await dir(repo, A, { q: "zzz-no-such-student" });
	assert.deepEqual([miss.students, miss.total, miss.pages], [[], 0, 1]);
	assert.deepEqual((await dir(repo, A, { grade: "C7" })).students, []);
	assert.deepEqual((await dir(repo, A, { page: 7 })).page, 1, "an out-of-range page is clamped");
});

test("empty family: an account with no learners gets empty lists, not someone else's", async () => {
	const { repo, nobody, empty } = await world();
	assert.deepEqual(await svc.listLearners(repo, nobody), []);
	const ov = await asg.learnerOverview(repo, nobody, {}, { now: T });
	assert.deepEqual([ov.learners, ov.total], [[], 0]);
	assert.deepEqual(await svc.listLearners(repo, empty), [], "an instructor with no profiles has none");
	await assert.rejects(svc.listLearners(repo, null), { status: 401 });
});

// ------------------------------------------------------------------ layout guard

test("the student table keeps a real column width: no one-character wrapping, no stretched page", () => {
	const css = fs.readFileSync(new URL("../../styles/sharpstudy/_instructor.scss", import.meta.url), "utf8");
	// comments are ignored: the explanation of the old bug mentions the property by name
	const sd = css
		.slice(css.indexOf("// ---- Students directory ----"))
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
	// `overflow-wrap: anywhere` let a table column shrink to ONE character (this was the bug)
	assert.ok(!/overflow-wrap:\s*anywhere/.test(sd), "no overflow-wrap:anywhere in the directory styles");
	assert.match(sd, /\.sd-col-student\s*\{[^}]*min-width:\s*\d+px/, "the student column has a minimum width");
	// the grid column must be able to shrink so a wide table scrolls inside its wrapper instead of widening the page
	assert.match(sd, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
	assert.match(sd, /overflow-x:\s*auto/);
	const tsx = fs.readFileSync(new URL("../../components/Instructor/StudentDirectory.js", import.meta.url), "utf8");
	assert.match(tsx, /sd-col-student/);
	assert.match(tsx, /<wbr \/>/, "e-mails may break before the @ but are never cut");
});
