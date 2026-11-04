// Parent dashboard (/family/) and its permissions: a read-only summary of the signed-in parent's OWN linked
// children, kept apart from device management, with every instructor-only action refused server-side.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createFamilyRepo } from "./memoryRepo.mjs";
import { parentOverview } from "../../lib/family/overview.js";
import { redeemParentLink } from "../../lib/family/links.js";
import { parentCode } from "./helpers.mjs";
import * as fam from "../../lib/family/service.js";
import * as svc from "../../lib/mastery/service.js";
import * as asg from "../../lib/mastery/assignments.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { verifyLearnerToken } from "../../lib/mastery/tokens.js";

const T = Date.parse("2026-10-24T10:00:00Z");
const ctx = { now: T };
const account = (userId, role = "student") => ({ kind: "account", userId, role, permissions: resolvePermissions(role, []) });
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);
const WS = { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 };

async function world() {
	const repo = createFamilyRepo();
	repo._db.users.push(
		{ id: "teacher", email: "t@example.com", role: "instructor", status: true, first_name: "Tess", last_name: "T" },
		{ id: "admin", email: "ad@example.com", role: "admin", status: true },
		{ id: "pA", email: "a@example.com", role: "student", status: true },
		{ id: "pB", email: "b@example.com", role: "student", status: true },
		{ id: "pNone", email: "n@example.com", role: "student", status: true }
	);
	repo._db.courses = [{ id: "c1", userId: "teacher" }];
	const w = { repo, teacher: account("teacher", "instructor"), admin: account("admin", "admin"), A: account("pA"), B: account("pB"), none: account("pNone") };
	const mk = (name) => svc.createLearner(repo, w.teacher, { displayName: name, pin: "1234", subjects: ["math"], timeZone: "UTC" }, ctx);
	w.maya = await mk("Maya");
	w.zed = await mk("Zed");
	const link = async (parent, kid) => redeemParentLink(repo, parent, { code: (await parentCode(repo, kid.id, ctx)).code }, ctx);
	await link(w.A, w.maya);
	await link(w.B, w.zed);
	// one finished worksheet and one pending assignment for Maya
	const { assignmentId } = await asg.createAssignment(repo, w.teacher, { ...WS, learnerIds: [w.maya.id], title: "Counting 1" }, ctx);
	const unlocked = await svc.unlockLearner(repo, w.teacher, w.maya.id, "1234", ctx);
	const kid = await svc.resolveLearnerSession(repo, verifyLearnerToken(unlocked.learnerToken), null);
	const started = await svc.startWorksheet(repo, kid, { assignmentId }, ctx);
	await svc.submitAttempt(repo, kid, { startToken: started.startToken, clientAttemptId: "maya-attempt-0001", responses: started.sheet.problems.map((p) => [right(p)]), durationMs: 60000 }, { now: T + 60000 });
	await asg.createAssignment(repo, w.teacher, { ...WS, worksheetNo: 2, learnerIds: [w.maya.id], title: "Counting 2" }, ctx);
	return w;
}

test("a parent sees a concise summary of their own children: progress, worksheets, recent activity", async () => {
	const w = await world();
	const o = await parentOverview(w.repo, w.A, ctx);
	assert.deepEqual(o.children.map((c) => c.nickname), ["Maya"]);
	const m = o.children[0];
	assert.equal(m.summary.worksheetsDone, 1);
	assert.equal(m.worksheets.counts.completed, 1);
	assert.equal(m.worksheets.counts.pending, 1);
	assert.deepEqual(m.worksheets.pending.map((i) => i.title), ["Counting 2"]);
	assert.deepEqual(m.worksheets.completed.map((i) => i.title), ["Counting 1"]);
	assert.equal(m.recent.length, 1);
	assert.ok(m.subjects.some((s) => s.id === "math"));
});

test("family isolation: each parent sees only their linked children; others, staff and strangers see none", async () => {
	const w = await world();
	assert.deepEqual((await parentOverview(w.repo, w.B, ctx)).children.map((c) => c.nickname), ["Zed"]);
	assert.deepEqual((await parentOverview(w.repo, w.none, ctx)).children, []);
	// an instructor or administrator is not a parent by that fact
	assert.deepEqual((await parentOverview(w.repo, w.teacher, ctx)).children, []);
	assert.deepEqual((await parentOverview(w.repo, w.admin, ctx)).children, []);
	await assert.rejects(parentOverview(w.repo, null, ctx), { status: 401 });
	await assert.rejects(parentOverview(w.repo, { kind: "learner", learnerId: w.maya.id }, ctx), { status: 401 });
	// unlinking removes the child from the parent's view
	await svc.removeGuardian(w.repo, w.teacher, w.maya.id, "pA", ctx);
	assert.deepEqual((await parentOverview(w.repo, w.A, ctx)).children, []);
});

test("the summary carries no answers, contact details, guardians, PINs or other families' data", async () => {
	const w = await world();
	const text = JSON.stringify(await parentOverview(w.repo, w.A, ctx));
	for (const bad of ["Zed", "pin_hash", "contact", "birth", "guardian", "responses", "answer", "t@example.com", "b@example.com", "token"]) assert.ok(!text.includes(bad), bad);
});

test("parents cannot assign worksheets or manage the course/learner records of anyone", async () => {
	const w = await world();
	await assert.rejects(asg.createAssignment(w.repo, w.A, { ...WS, learnerIds: [w.maya.id] }, ctx), (e) => e.status === 403);
	await assert.rejects(asg.createAssignment(w.repo, w.A, { ...WS, learnerIds: [w.zed.id] }, ctx), (e) => e.status === 403 || e.status === 404);
});

test("parents cannot change enrolments, placement, profile, adult mode or PIN, even through the Mastery APIs", async () => {
	const w = await world();
	const pos = { levelId: "7A", setId: "7A-1", worksheetNo: 1 };
	await assert.rejects(svc.setEnrolment(w.repo, w.A, w.maya.id, "math", false, ctx), { status: 403 });
	await assert.rejects(svc.setPlacement(w.repo, w.A, w.maya.id, "math", pos, true, ctx), { status: 403 });
	await assert.rejects(svc.updateLearner(w.repo, w.A, w.maya.id, { displayName: "Renamed" }, ctx), { status: 403 });
	await assert.rejects(svc.updateLearner(w.repo, w.A, w.maya.id, { dailyGoal: 9 }, ctx), { status: 403 });
	await assert.rejects(svc.setAdultMode(w.repo, w.A, w.maya.id, true, ctx), { status: 403 });
	await assert.rejects(svc.resetPin(w.repo, w.A, w.maya.id, "9999", ctx), { status: 403 });
	await assert.rejects(svc.resetProgress(w.repo, w.A, w.maya.id, null, "Maya", ctx), { status: 403 });
	await assert.rejects(svc.removeLearner(w.repo, w.A, w.maya.id, "Maya", ctx), { status: 403 });
	// ...and nothing about the child changed
	const l = await w.repo.getLearner(w.maya.id);
	assert.equal(l.display_name, "Maya");
	assert.equal(l.adult_mode, false);
	assert.equal((await parentOverview(w.repo, w.A, ctx)).children[0].summary.worksheetsDone, 1);
});

test("parents cannot touch another family's child through any of those routes (404, not 403)", async () => {
	const w = await world();
	for (const f of [
		() => svc.setEnrolment(w.repo, w.A, w.zed.id, "math", false, ctx),
		() => svc.updateLearner(w.repo, w.A, w.zed.id, { dailyGoal: 3 }, ctx),
		() => svc.resetProgress(w.repo, w.A, w.zed.id, null, "Zed", ctx),
		() => svc.learnerDashboard(w.repo, w.A, w.zed.id, ctx),
		() => fam.createPairing(w.repo, w.A, { learnerIds: [w.zed.id] }, ctx),
	]) await assert.rejects(f(), { status: 404 });
});

test("instructors keep their learner management", async () => {
	const w = await world();
	await svc.updateLearner(w.repo, w.teacher, w.maya.id, { dailyGoal: 4 }, ctx);
	await svc.setEnrolment(w.repo, w.teacher, w.maya.id, "math", true, ctx);
	await svc.setPlacement(w.repo, w.teacher, w.maya.id, "math", { levelId: "7A", setId: "7A-1", worksheetNo: 1 }, true, ctx);
	await svc.setAdultMode(w.repo, w.admin, w.maya.id, false, ctx);
	await svc.resetPin(w.repo, w.teacher, w.maya.id, "4321", ctx);
});

test("device management stays on its own page and the dashboard exposes no management controls", () => {
	const root = new URL("../../", import.meta.url);
	const src = (p) => readFileSync(new URL(p, root), "utf8");
	assert.ok(existsSync(new URL("pages/family/manage.js", root)));
	assert.match(src("pages/family/manage.js"), /ManageFamily/);
	const dash = src("components/Family/ParentDashboard.js").replace(/^\/\/.*$/gm, ""); // code only, not the header comment
	assert.match(dash, /parent\.overview\(/);
	assert.match(dash, /href="\/family\/manage\/"/, "links to the separate family & devices page");
	assert.doesNotMatch(dash, /createPairing|revoke|setPin|decide|\.link\(|setPicture/, "no device/PIN/link calls on the dashboard");
	assert.doesNotMatch(dash, /Assign a worksheet|Assign worksheet|Reset progress|Remove learner|Change placement|enrol|Add learner|Generate Parent Link/i, "no instructor controls");
	const page = src("pages/family/index.js");
	assert.match(page, /user\.role === "instructor" \|\| user\.role === "admin"/);
	assert.match(page, /<ParentDashboard \/>/);
	assert.match(src("pages/api/family/overview.js"), /parentOverview\(familyRepo, actor/);
	assert.doesNotMatch(src("pages/api/family/overview.js"), /req\.(query|body)/, "the request cannot choose which children are shown");
});
