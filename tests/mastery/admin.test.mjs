import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createMemoryRepo } from "./memoryRepo.mjs";
import * as admin from "../../lib/mastery/admin.js";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions, learnerAccess, PERMISSIONS } from "../../lib/mastery/policy.js";

// Actor whose permissions are resolved the same way the API does it.
async function actorFor(repo, userId) {
	const u = await repo.getUser(userId);
	return { kind: "account", userId, role: u.role, permissions: resolvePermissions(u.role, [...(await repo.permissionsForUser(userId)), ...(userId === "parent" ? ["learners.create"] : [])]) };
}

function setup() {
	const repo = createMemoryRepo();
	repo._db.users.push(
		{ id: "admin", email: "admin@example.com", role: "admin" },
		{ id: "teacher", email: "t@example.com", role: "instructor" },
		{ id: "parent", email: "p@example.com", role: "student" },
		{ id: "support", email: "s@example.com", role: "student" }
	);
	return repo;
}

test("unauthorised users cannot use restricted admin functionality", async () => {
	const repo = setup();
	for (const uid of ["teacher", "parent"]) {
		const a = await actorFor(repo, uid);
		await assert.rejects(admin.listUsers(repo, a), { status: 403 });
		await assert.rejects(admin.setUserRole(repo, a, "parent", "admin"), { status: 403 });
		await assert.rejects(admin.listRoles(repo, a), { status: 403 });
		await assert.rejects(admin.createRole(repo, a, { name: "Hax", permissions: ["system.global_reset"] }), { status: 403 });
		await assert.rejects(admin.listAudit(repo, a), { status: 403 });
		await assert.rejects(admin.listFeedback(repo, a), { status: 403 });
		await assert.rejects(admin.listPresence(repo, a), { status: 403 });
		await assert.rejects(svc.adminListLearners(repo, a), { status: 403 });
		await assert.rejects(svc.updateTutorSettings(repo, a, { chatEnabled: true }), { status: 403 });
		await assert.rejects(svc.globalReset(repo, a, { phrase: svc.GLOBAL_RESET_PHRASE, passwordOk: true }), { status: 403 });
	}
	await assert.rejects(admin.listUsers(repo, null), { status: 401 });
	await assert.rejects(admin.listUsers(repo, { kind: "learner", learnerId: "x" }), { status: 401 });
});

test("admins manage users and built-in roles; cannot lock themselves out", async () => {
	const repo = setup();
	const a = await actorFor(repo, "admin");
	const list = await admin.listUsers(repo, a);
	assert.equal(list.count, 4);
	// instructor access comes only from an approved instructor application, never from this panel
	await assert.rejects(admin.setUserRole(repo, a, "parent", "instructor"), { code: "instructor_application_required" });
	assert.equal((await repo.getUser("parent")).role, "student");
	await admin.setUserRole(repo, a, "parent", "admin");
	assert.equal((await repo.getUser("parent")).role, "admin");
	await admin.setUserRole(repo, a, "parent", "student");
	assert.equal((await repo.getUser("parent")).role, "student");
	await admin.setUserRole(repo, a, "teacher", "student"); // removing instructor access stays possible
	assert.equal((await repo.getUser("teacher")).role, "student");
	await assert.rejects(admin.setUserRole(repo, a, "parent", "superuser"), { code: "invalid" });
	await assert.rejects(admin.setUserRole(repo, a, "admin", "student"), { code: "invalid" });
	assert.ok(repo._db.audit.some((x) => x.action === "user.role_change"));
});

test("custom roles grant permissions that the server enforces", async () => {
	const repo = setup();
	const a = await actorFor(repo, "admin");
	await assert.rejects(admin.createRole(repo, a, { name: "Bad", permissions: ["root"] }), { code: "invalid" });
	await assert.rejects(admin.createRole(repo, a, { name: "admin", permissions: [] }), { code: "invalid" });
	const role = await admin.createRole(repo, a, { name: "Support", permissions: [PERMISSIONS.ADMIN_ACCESS, PERMISSIONS.LEARNERS_MANAGE_ALL, PERMISSIONS.FEEDBACK_MANAGE] });
	await admin.setUserCustomRoles(repo, a, "support", [role.id]);
	const support = await actorFor(repo, "support");
	// Granted
	await admin.listFeedback(repo, support);
	await svc.adminListLearners(repo, support);
	// Not granted
	await assert.rejects(admin.listAudit(repo, support), { status: 403 });
	await assert.rejects(admin.listUsers(repo, support), { status: 403 });
	// learners.manage_all gives full learner access server-side
	const kid = await svc.createLearner(repo, await actorFor(repo, "parent"), { displayName: "Lu", pin: "1212" });
	assert.equal(learnerAccess(support, await repo.getLearner(kid.id), null).admin, true);
	await svc.resetPin(repo, support, kid.id, "3434");
	// Removing the role revokes access immediately
	await admin.deleteRole(repo, a, role.id);
	const revoked = await actorFor(repo, "support");
	await assert.rejects(admin.listFeedback(repo, revoked), { status: 403 });
	await assert.rejects(svc.resetPin(repo, revoked, kid.id, "5656"), { status: 404 });
});

test("audit log records logins, placement, PIN changes and resets", async () => {
	const repo = setup();
	const parent = await actorFor(repo, "parent");
	const kid = await svc.createLearner(repo, parent, { displayName: "Ola", pin: "1111" });
	await svc.unlockLearner(repo, parent, kid.id, "1111");
	await svc.setPlacement(repo, parent, kid.id, "math", { levelId: "B", setId: "B-1", worksheetNo: 1 }, true);
	await svc.resetPin(repo, parent, kid.id, "2222");
	await svc.resetProgress(repo, parent, kid.id, null, "Ola");
	const a = await actorFor(repo, "admin");
	const { entries } = await admin.listAudit(repo, a);
	const actions = entries.map((e) => e.action);
	for (const act of ["learner.login", "placement.change", "learner.pin_reset", "learner.progress_reset"]) assert.ok(actions.includes(act), act);
	assert.ok(!JSON.stringify(entries).includes("2222"), "PINs never appear in the audit log");
	const filtered = await admin.listAudit(repo, a, { action: "placement.change" });
	assert.equal(filtered.entries.length, 1);
});

test("feedback: anyone signed in can submit; screenshots validated; admins triage", async () => {
	const repo = setup();
	const parent = await actorFor(repo, "parent");
	await assert.rejects(admin.createFeedback(repo, null, { message: "hi" }), { status: 401 });
	await assert.rejects(admin.createFeedback(repo, parent, { message: "" }), { code: "invalid" });
	await assert.rejects(admin.createFeedback(repo, parent, { message: "x", screenshot: "javascript:alert(1)" }), { code: "invalid" });
	await assert.rejects(admin.createFeedback(repo, parent, { message: "x", screenshot: "data:image/svg+xml;base64,PHN2Zz4=" }), { code: "invalid" });
	const r = await admin.createFeedback(repo, parent, { message: "Love it", page: "/study/", screenshot: "data:image/png;base64,iVBORw0KGgo=" });
	const learnerFb = await admin.createFeedback(repo, { kind: "learner", learnerId: "L1", accountUserId: "parent" }, { message: "too hard" });
	assert.ok(learnerFb.id);
	const a = await actorFor(repo, "admin");
	const list = await admin.listFeedback(repo, a);
	assert.equal(list.count, 2);
	assert.match(await admin.getFeedbackScreenshot(repo, a, r.id), /^data:image\/png/);
	await admin.updateFeedback(repo, a, r.id, { status: "resolved", adminNote: "thanks" });
	assert.equal((await repo.getFeedback(r.id)).status, "resolved");
	await assert.rejects(admin.updateFeedback(repo, a, r.id, { status: "deleted" }), { code: "invalid" });
});

test("presence heartbeat and admin view", async () => {
	const repo = setup();
	await admin.touchPresence(repo, await actorFor(repo, "parent"), "/family/");
	await admin.touchPresence(repo, { kind: "learner", learnerId: "L1", accountUserId: "parent" }, "/study/");
	await admin.touchPresence(repo, await actorFor(repo, "parent"), "/print/");
	const p = await admin.listPresence(repo, await actorFor(repo, "admin"));
	assert.equal(p.users, 1);
	assert.equal(p.learners, 1);
	await assert.rejects(admin.touchPresence(repo, null, "/"), { status: 401 });
});
