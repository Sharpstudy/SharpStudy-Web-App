// Business rule: learner profiles are created by instructors/administrators. A parent cannot create a
// profile or claim one; a parent can only be linked to an EXISTING learner with a single-use code issued by an
// authorised adult (or the child themselves), and can then pair devices for exactly that child.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createFamilyRepo } from "./memoryRepo.mjs";
import * as fam from "../../lib/family/service.js";
import { redeemParentLink, getChildLinkStatus, issueLinkCodeForChild, cancelLinkCodeForChild, CODE_LIMITS, LINK_LIMITS } from "../../lib/family/links.js";
import * as linksModule from "../../lib/family/links.js";
import { parentCode } from "./helpers.mjs";
import { generateLinkCode, normalizeLinkCode, hashLinkCode, hashCode, generateCode } from "../../lib/family/codes.js";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions, BUILTIN_ROLE_PERMISSIONS, RETIRED_ROLE_NAMES } from "../../lib/mastery/policy.js";

const account = (userId, role = "student") => ({ kind: "account", userId, role, permissions: resolvePermissions(role, []) });
const T0 = Date.parse("2026-10-24T10:00:00Z");
const ctx = (t = T0) => ({ now: t, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1" });
const HOUR = 3600000;

function world() {
	const repo = createFamilyRepo();
	repo._db.users.push(
		{ id: "teacher", email: "teacher@example.com", role: "instructor", status: true },
		{ id: "teacher2", email: "teacher2@example.com", role: "instructor", status: true },
		{ id: "admin", email: "admin@example.com", role: "admin", status: true },
		{ id: "parentA", email: "a@example.com", role: "student", status: true },
		{ id: "parentB", email: "b@example.com", role: "student", status: true },
		{ id: "student", email: "s@example.com", role: "student", status: true }
	);
	return {
		repo,
		teacher: account("teacher", "instructor"),
		teacher2: account("teacher2", "instructor"),
		admin: account("admin", "admin"),
		A: account("parentA"),
		B: account("parentB"),
		student: account("student"),
	};
}
const newLearner = (w, who = w.teacher, name = "Maya") => svc.createLearner(w.repo, who, { displayName: name, pin: "1234" }, ctx());

// ------------------------------------------------------------------ parents cannot create learners

test("a parent (or any student) cannot create a learner profile through any service", async () => {
	const w = world();
	const m = await newLearner(w);
	const issued = await parentCode(w.repo, m.id, ctx());
	await redeemParentLink(w.repo, w.A, { code: issued.code }, ctx());
	for (const who of [w.A, w.student, { kind: "learner", learnerId: m.id, accountUserId: "parentA" }]) {
		await assert.rejects(svc.createLearner(w.repo, who, { displayName: "New", pin: "1234" }, ctx()), (e) => e.status === 403 || e.status === 401);
	}
	assert.equal(typeof fam.createChild, "undefined");
	assert.equal(typeof fam.enrolParent, "undefined");
	assert.equal(typeof fam.enrolParentAccount, "undefined");
	assert.equal((await w.repo.listLearnersByOwner("parentA")).length, 0, "the parent owns no profile");
});

test("the parent-facing create/enrol/caregiver routes and permission grants are gone", () => {
	const root = new URL("../../", import.meta.url);
	for (const f of ["pages/api/family/children/index.js", "pages/api/family/enroll.js", "pages/api/family/caregivers.js", "components/Family/ChildForm.js"]) {
		assert.equal(existsSync(new URL(f, root)), false, f);
	}
	const src = (p) => readFileSync(new URL(p, root), "utf8");
	assert.doesNotMatch(src("pages/api/users/signup.js"), /account_type|enrolParent|learners\.create/);
	assert.doesNotMatch(src("components/Authentication/RegisterForm.js"), /account_type/);
	for (const f of ["components/Family/Setup.js", "components/Family/ManageFamily.js", "lib/family/client.js"]) assert.doesNotMatch(src(f), /createChild|Add child|Add a child|enrol\(|invite\(/, f);
	assert.deepEqual(BUILTIN_ROLE_PERMISSIONS.student, [], "students never get learners.create");
	assert.ok(RETIRED_ROLE_NAMES.includes("Parent / Family"));
	assert.match(src("lib/mastery-server/repo.js"), /RETIRED_ROLE_NAMES\.includes/, "a leftover Parent / Family role grants nothing");
	assert.match(src("database/migrations/20261024000000-parent-link-codes.js"), /DELETE FROM ml_roles/);
});

test("parent accounts cannot remove learners, reset progress or hand access to others", async () => {
	const w = world();
	const m = await newLearner(w);
	await redeemParentLink(w.repo, w.A, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx());
	await assert.rejects(svc.removeLearner(w.repo, w.A, m.id, "Maya", ctx()), { status: 403 });
	await assert.rejects(svc.resetProgress(w.repo, w.A, m.id, null, "Maya", ctx()), { status: 403 });
	await assert.rejects(svc.addGuardian(w.repo, w.A, m.id, "b@example.com", "parent", ctx()), { status: 403 });
	await assert.rejects(svc.removeGuardian(w.repo, w.A, m.id, "parentA", ctx()), { status: 403 });
	assert.ok(await w.repo.getLearner(m.id));
	// the owning instructor still can (legitimate instructor behaviour is preserved)
	await svc.addGuardian(w.repo, w.teacher, m.id, "b@example.com", "parent", ctx());
	assert.equal((await fam.getFamily(w.repo, w.B, ctx())).children.length, 1);
});

// ------------------------------------------------------------------ parents cannot claim learners

test("linking works only with a valid code, and gives that parent that one learner", async () => {
	const w = world();
	const m = await newLearner(w, w.teacher, "Maya");
	const z = await newLearner(w, w.teacher, "Zed");
	const issued = await parentCode(w.repo, m.id, ctx());
	assert.match(issued.code, /^[A-HJ-NP-Z2-9]{8}$/);
	assert.ok(!JSON.stringify(w.repo._fam.links).includes(issued.code), "only a hash is stored");
	const r = await redeemParentLink(w.repo, w.A, { code: issued.display.toLowerCase() }, ctx(T0 + HOUR));
	assert.equal(r.linked, true);
	assert.equal(r.child.id, m.id);
	assert.deepEqual((await fam.getFamily(w.repo, w.A, ctx())).children.map((c) => c.id), [m.id]);
	await assert.rejects(fam.createPairing(w.repo, w.A, { learnerIds: [z.id] }, ctx()), { status: 404 }, "the other learner stays out of reach");
	await assert.rejects(svc.loadLearner(w.repo, w.A, z.id, "view"), { status: 404 });
});

test("names, e-mails, learner ids and guessed or reused codes cannot claim a learner", async () => {
	const w = world();
	const m = await newLearner(w);
	const issued = await parentCode(w.repo, m.id, ctx());
	const bad = ["Maya", "teacher@example.com", m.id, "", null, undefined, 12345678, {}, "AAAAAAAA", "ZZZZ-9999", issued.code.slice(0, 7), issued.code + "A", "0000-0000"];
	for (const code of bad) await assert.rejects(redeemParentLink(w.repo, w.A, { code }, ctx()), { status: 404, code: "invalid_code" }, String(code));
	await assert.rejects(redeemParentLink(w.repo, w.A, { learnerId: m.id, email: "teacher@example.com", name: "Maya" }, ctx()), { status: 404 });
	await assert.rejects(redeemParentLink(w.repo, null, { code: issued.code }, ctx()), { status: 401 });
	await assert.rejects(redeemParentLink(w.repo, { kind: "learner", learnerId: m.id }, { code: issued.code }, ctx()), { status: 401 });
	assert.equal(w.repo._db.guardians.length, 0, "none of that created a link");

	await redeemParentLink(w.repo, w.A, { code: issued.code }, ctx());
	await assert.rejects(redeemParentLink(w.repo, w.B, { code: issued.code }, ctx()), { status: 404, code: "invalid_code" }, "single use");
	assert.equal((await fam.getFamily(w.repo, w.B, ctx())).children.length, 0);
});

test("a pairing code is not a link code, and expired, replaced or unrelated-user codes fail", async () => {
	const w = world();
	const m = await newLearner(w);
	const first = await parentCode(w.repo, m.id, ctx(T0));
	const second = await parentCode(w.repo, m.id, ctx(T0 + 1000));
	await assert.rejects(redeemParentLink(w.repo, w.A, { code: first.code }, ctx(T0 + 2000)), { status: 404 }, "a new code replaces the old one");
	await assert.rejects(redeemParentLink(w.repo, w.A, { code: second.code }, ctx(T0 + LINK_LIMITS.ttlMs + 5000)), { status: 404 }, "expired");
	assert.notEqual(hashLinkCode("ABCD2345"), hashCode("ABCD2345"));
	assert.equal(normalizeLinkCode(generateCode()), null, "6-character pairing codes are not link codes");
	assert.equal(w.repo._db.guardians.length, 0);
	await redeemParentLink(w.repo, w.A, { code: second.code }, ctx(T0 + 2000));
	assert.equal(w.repo._db.guardians.length, 1);
	assert.match(generateLinkCode(), /^[A-HJ-NP-Z2-9]{8}$/);
});

test("redeeming never transfers ownership, duplicates a learner, or touches progress and enrolments", async () => {
	const w = world();
	const m = await newLearner(w);
	await svc.enrolSubject?.(w.repo, w.teacher, m.id, "math", ctx());
	await w.repo.updateLearner(m.id, { student_user_id: "student" }); // instructor's link, done before the snapshot
	const before = JSON.stringify({ learner: await w.repo.getLearner(m.id), enrol: await w.repo.listEnrolments(m.id) });
	const count = w.repo._db.learners.length;
	const issued = await parentCode(w.repo, m.id, ctx());
	await redeemParentLink(w.repo, w.A, { code: issued.code }, ctx());
	assert.equal(w.repo._db.learners.length, count, "no new learner row");
	assert.equal(JSON.stringify({ learner: await w.repo.getLearner(m.id), enrol: await w.repo.listEnrolments(m.id) }), before, "learner row and enrolments unchanged");
	assert.equal((await w.repo.getLearner(m.id)).owner_user_id, "teacher");
	// the instructor keeps full access and the parent link is the only new row
	assert.equal((await svc.loadLearner(w.repo, w.teacher, m.id, "admin")).learner.id, m.id);
	assert.deepEqual(w.repo._db.guardians.map((g) => [g.user_id, g.relation]), [["parentA", "parent"]]);
	// a second redemption by the same parent (new code) does not duplicate the link
	await redeemParentLink(w.repo, w.A, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx());
	assert.equal(w.repo._db.guardians.length, 1);
});

test("link edge cases: the learner's own student account, an instructor link, the owner", async () => {
	const w = world();
	const m = await newLearner(w);
	await w.repo.updateLearner(m.id, { student_user_id: "student" });
	await assert.rejects(redeemParentLink(w.repo, w.student, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx()), { status: 422 });
	await w.repo.addGuardian({ learner_id: m.id, user_id: "teacher2", relation: "instructor", created_by: "teacher" });
	await assert.rejects(redeemParentLink(w.repo, w.teacher2, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx()), { status: 409 }, "never turn an instructor link into a parent link");
	assert.equal((await w.repo.getGuardian(m.id, "teacher2")).relation, "instructor");
	await assert.rejects(redeemParentLink(w.repo, w.teacher, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx()), { status: 409 }, "the owner needs no link, and the code is not consumed");
	assert.equal(await w.repo.getGuardian(m.id, "teacher"), null, "the owner needs no guardian row");
});

// ------------------------------------------------------------------ parents pair only authorised children

test("a linked parent can set a PIN, pair a device for the linked child, and approve it; nobody else can", async () => {
	const w = world();
	const m = await newLearner(w, w.teacher, "Maya");
	const z = await newLearner(w, w.teacher, "Zed");
	await redeemParentLink(w.repo, w.A, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx());
	await redeemParentLink(w.repo, w.B, { code: (await parentCode(w.repo, z.id, ctx())).code }, ctx());

	// no link, no PIN, no pairing: students, unlinked parents and instructors alike
	await assert.rejects(fam.setFamilyPin(w.repo, w.student, { pin: "2468" }, ctx()), { status: 403 });
	await assert.rejects(fam.createPairing(w.repo, w.student, { learnerIds: [m.id] }, ctx()), { status: 404 });
	await assert.rejects(fam.createPairing(w.repo, w.teacher2, { learnerIds: [m.id] }, ctx()), { status: 404 });
	await assert.rejects(fam.createPairing(w.repo, w.B, { learnerIds: [m.id] }, ctx()), { status: 404 }, "another family's child");
	await assert.rejects(fam.createPairing(w.repo, w.A, { learnerIds: [m.id, z.id] }, ctx()), { status: 404 }, "one unauthorised child blocks the whole request");

	await fam.setFamilyPin(w.repo, w.A, { pin: "2468" }, ctx());
	const p = await fam.createPairing(w.repo, w.A, { learnerIds: [m.id] }, ctx());
	const joined = await fam.redeemPairing(w.repo, { code: p.display }, ctx(T0 + 1000));
	const deviceId = joined.deviceToken.split(".")[0];
	await assert.rejects(fam.decideDevice(w.repo, w.B, deviceId, { action: "approve" }, ctx(T0 + 2000)), { status: 404 }, "another family cannot approve");
	await assert.rejects(fam.decideDevice(w.repo, w.teacher, deviceId, { action: "approve" }, ctx(T0 + 2000)), { status: 404 }, "an instructor is not the parent");
	await fam.decideDevice(w.repo, w.A, deviceId, { action: "approve" }, ctx(T0 + 2000));
	assert.equal((await w.repo.getDevice(deviceId)).owner_user_id, "parentA", "the device belongs to the parent, not to the instructor who owns the profile");

	const status = await fam.deviceStatus(w.repo, joined.deviceToken, ctx(T0 + 3000));
	assert.deepEqual(status.learners.map((l) => l.nickname), ["Maya"]);
	const kid = await fam.startChildSession(w.repo, joined.deviceToken, { learnerId: m.id }, ctx(T0 + 4000));
	assert.equal(kid.learner.id, m.id, "same learner id: progress and courses are the existing ones");
	await assert.rejects(fam.startChildSession(w.repo, joined.deviceToken, { learnerId: z.id }, ctx(T0 + 4000)), { status: 404 });

	// revocation and unlinking both end the device session
	await fam.revokeDevice(w.repo, w.A, deviceId, { confirm: true }, ctx(T0 + 5000));
	assert.equal(await fam.deviceAllowsLearner(w.repo, { learnerId: m.id, accountUserId: "parentA", deviceId }), false);
});

test("removing the parent link (instructor action) ends the family's device access to the child", async () => {
	const w = world();
	const m = await newLearner(w);
	await redeemParentLink(w.repo, w.A, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx());
	await fam.setFamilyPin(w.repo, w.A, { pin: "2468" }, ctx());
	const p = await fam.createPairing(w.repo, w.A, { learnerIds: [m.id] }, ctx());
	const j = await fam.redeemPairing(w.repo, { code: p.display }, ctx(T0 + 1000));
	const deviceId = j.deviceToken.split(".")[0];
	await fam.decideDevice(w.repo, w.A, deviceId, { action: "approve" }, ctx(T0 + 2000));
	assert.equal((await fam.deviceStatus(w.repo, j.deviceToken, ctx(T0 + 3000))).learners.length, 1);
	await svc.removeGuardian(w.repo, w.teacher, m.id, "parentA", ctx());
	assert.equal((await fam.deviceStatus(w.repo, j.deviceToken, ctx(T0 + 4000))).learners.length, 0);
	assert.equal((await fam.getFamily(w.repo, w.A, ctx())).children.length, 0);
	assert.ok(await w.repo.getLearner(m.id), "the learner and its progress remain");
});

// ------------------------------------------------------------------ instructor / admin behaviour is unchanged

test("instructors and administrators still create, manage and are limited to their own learners", async () => {
	const w = world();
	const m = await newLearner(w, w.teacher, "Maya");
	const k = await newLearner(w, w.teacher2, "Kai");
	assert.equal((await w.repo.getLearner(m.id)).owner_user_id, "teacher");
	assert.equal((await svc.loadLearner(w.repo, w.teacher, m.id, "admin")).learner.id, m.id);
	await assert.rejects(svc.loadLearner(w.repo, w.teacher, k.id, "view"), { status: 404 }, "instructor limited to own learners");
	await assert.rejects(svc.loadLearner(w.repo, w.teacher2, m.id, "view"), { status: 404 });
	assert.equal((await svc.loadLearner(w.repo, w.admin, k.id, "admin")).learner.id, k.id);
	// being linked as a parent grants no instructor permission anywhere
	await redeemParentLink(w.repo, w.A, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx());
	assert.ok(!w.A.permissions.has("learners.create"));
	assert.equal(w.A.role, "student");
	await assert.rejects(svc.loadLearner(w.repo, w.A, k.id, "view"), { status: 404 });
	// administrator removal still works
	await svc.removeLearner(w.repo, w.admin, k.id, "Kai", ctx());
	assert.equal(await w.repo.getLearner(k.id), null);
});

// ------------------------------------------------------------------ wiring

test("API wiring: the redeem route authorises on the server and ignore body-supplied identity", () => {
	const root = new URL("../../", import.meta.url);
	const src = (p) => readFileSync(new URL(p, root), "utf8");
	const redeem = src("pages/api/family/link/index.js");
	assert.match(redeem, /getAccountActor\(req\)/);
	assert.match(redeem, /redeemParentLink\(familyRepo, actor, \{ code: body\(req\)\.code \}/, "only the code is read from the body");
	assert.match(redeem, /rateLimit/);
	const child = src("pages/api/family/children/[id].js");
	assert.match(child, /setChildPicture/);
	assert.doesNotMatch(child, /POST|updateChild\b/);
});

// ------------------------------------------------------------------ child-initiated codes (no instructor step, no e-mail)

// A learner profile tied to the child's own sign-in (student_user_id).
async function childWorld() {
	const w = world();
	const m = await newLearner(w, w.teacher, "Maya");
	await w.repo.updateLearner(m.id, { student_user_id: "student" });
	const show = (t = T0 + 1000, who = w.student) => issueLinkCodeForChild(w.repo, who, ctx(t));
	return { w, m, show };
}

test("the child generates the code; it is shown once and only its hash is stored", async () => {
	const { w, m, show } = await childWorld();
	assert.deepEqual(await getChildLinkStatus(w.repo, w.student, ctx()), { eligible: true, learner: { id: m.id, name: "Maya" }, openCode: null, parents: [] });
	assert.equal(w.repo._fam.links.length, 0, "nothing exists until the child asks");
	const c = await show(T0 + HOUR);
	assert.match(c.code, /^[A-HJ-NP-Z2-9]{8}$/);
	assert.equal(new Date(c.expiresAt).getTime() - (T0 + HOUR), 72 * HOUR);
	const row = w.repo._fam.links[0];
	assert.deepEqual([row.learner_id, row.issued_by, row.status], [m.id, "student", "open"]);
	assert.equal(row.code_hash, hashLinkCode(c.code));
	assert.ok(!JSON.stringify(w.repo._fam).includes(c.code), "no plaintext or recoverable form of the code is stored");
	assert.ok(!JSON.stringify(await getChildLinkStatus(w.repo, w.student, ctx())).includes(c.code), "the status never contains a code");

	// the parent redeems it in Family Setup: links the parent to the EXISTING learner, nothing else changes
	const before = JSON.stringify(await w.repo.getLearner(m.id));
	const out = await redeemParentLink(w.repo, w.A, { code: c.display.toLowerCase() }, ctx(T0 + 3 * HOUR));
	assert.equal(out.child.id, m.id);
	assert.equal(JSON.stringify(await w.repo.getLearner(m.id)), before);
	assert.equal(w.repo._db.learners.length, 1, "no learner was created or duplicated");
	assert.deepEqual(w.repo._db.guardians.map((g) => [g.user_id, g.relation]), [["parentA", "parent"]]);
	assert.equal(w.repo._fam.links[0].status, "used");
});

test("generating again replaces the old code", async () => {
	const { w, show } = await childWorld();
	for (const code of ["AAAAAAAA", "22222222", "ZZZZ-9999"]) await assert.rejects(redeemParentLink(w.repo, w.A, { code }, ctx(T0 + 500)), { status: 404 });
	const first = await show(T0 + 1000);
	const second = await show(T0 + 2000);
	assert.notEqual(first.code, second.code);
	await assert.rejects(redeemParentLink(w.repo, w.A, { code: first.code }, ctx(T0 + 3000)), { status: 404 }, "the earlier code stopped working");
	assert.equal((await redeemParentLink(w.repo, w.A, { code: second.code }, ctx(T0 + 3000))).linked, true);
});

test("an e-mail address, name or learner id alone never links", async () => {
	const { w, m, show } = await childWorld();
	await show();
	for (const input of [{ code: "s@example.com" }, { code: m.id }, { code: "Maya" }, { childEmail: "s@example.com" }, { learnerId: m.id }, { email: "s@example.com", learnerId: m.id }]) {
		await assert.rejects(redeemParentLink(w.repo, w.A, input, ctx(T0 + 1000)), { status: 404, code: "invalid_code" });
	}
	assert.equal(w.repo._db.guardians.length, 0);
});

test("only the child's own signed-in account can create a code; parents, other children and staff cannot", async () => {
	const { w } = await childWorld();
	for (const who of [w.A, w.B, w.teacher, w.teacher2, w.admin]) {
		assert.deepEqual(await getChildLinkStatus(w.repo, who), { eligible: false, learner: null, openCode: null, parents: [] });
		await assert.rejects(issueLinkCodeForChild(w.repo, who, ctx(T0 + 1000)), { status: 404, code: "no_profile" });
	}
	for (const who of [null, { kind: "learner", learnerId: "x" }]) {
		await assert.rejects(issueLinkCodeForChild(w.repo, who, ctx()), { status: 401 });
		await assert.rejects(getChildLinkStatus(w.repo, who), { status: 401 });
	}
	// a client-supplied learner id is ignored: the learner is always the one attached to the account
	await assert.rejects(issueLinkCodeForChild(w.repo, w.A, { ...ctx(), learnerId: "anything" }), { status: 404 });
	assert.equal(w.repo._fam.links.length, 0, "nothing was generated for the wrong accounts");
	// another child gets a code for THEIR learner only
	w.repo._db.users.push({ id: "student2", email: "s2@example.com", role: "student", status: true });
	const k = await newLearner(w, w.teacher, "Kai");
	await w.repo.updateLearner(k.id, { student_user_id: "student2" });
	await issueLinkCodeForChild(w.repo, account("student2"), ctx(T0 + 1000));
	assert.deepEqual(w.repo._fam.links.map((l) => [l.learner_id, l.issued_by]), [[k.id, "student2"]]);
});

test("the child typing their own code into the parent form does not use it up", async () => {
	const { w, show } = await childWorld();
	const { code } = await show();
	await assert.rejects(redeemParentLink(w.repo, w.student, { code }, ctx(T0 + 2000)), { status: 422 });
	assert.equal(w.repo._fam.links[0].status, "open", "still open for the real parent");
	assert.equal((await redeemParentLink(w.repo, w.A, { code }, ctx(T0 + 3000))).linked, true);
});

test("a code is single use, redeemable by any signed-in parent holding it, once", async () => {
	const { w, show } = await childWorld();
	const { code } = await show();
	await redeemParentLink(w.repo, w.A, { code }, ctx(T0 + HOUR));
	const again = await redeemParentLink(w.repo, w.A, { code }, ctx(T0 + HOUR + 1000));
	assert.equal(again.linked, true, "repeating the same submission is safe");
	assert.equal(w.repo._db.guardians.length, 1);
	await assert.rejects(redeemParentLink(w.repo, w.B, { code }, ctx(T0 + HOUR + 2000)), { status: 404, code: "invalid_code" }, "a used code is dead for everyone else");
	assert.equal(w.repo._db.guardians.length, 1);
});

test("concurrent redemptions: one link however many simultaneous submissions", async () => {
	const { w, show } = await childWorld();
	const { code } = await show(T0 + 1000);
	const racing = await Promise.allSettled([w.A, w.B, w.A, w.B].map((who) => redeemParentLink(w.repo, who, { code }, ctx(T0 + 2000))));
	assert.ok(racing.every((r) => r.status === "fulfilled" || r.reason.status === 404));
	assert.equal(w.repo._db.guardians.length, 1);
	assert.equal(w.repo._fam.links.filter((l) => l.status === "used").length, 1);
});

test("a code expires 72 hours after it is made", async () => {
	const { w, show } = await childWorld();
	const late = await show(T0 + 60 * HOUR);
	assert.equal(new Date(late.expiresAt).getTime(), T0 + 60 * HOUR + 72 * HOUR);
	await assert.rejects(redeemParentLink(w.repo, w.A, { code: late.code }, ctx(T0 + 60 * HOUR + LINK_LIMITS.ttlMs + 1000)), { status: 404, code: "invalid_code" }, "expired");
	assert.equal(w.repo._db.guardians.length, 0);
	const fresh = await show(T0 + 61 * HOUR);
	assert.equal((await redeemParentLink(w.repo, w.A, { code: fresh.code }, ctx(T0 + 62 * HOUR))).linked, true);
});

test("code creation is throttled per learner", async () => {
	const { w, show } = await childWorld();
	for (let i = 0; i < CODE_LIMITS.perLearnerPerDay; i++) await show(T0 + i * 1000);
	await assert.rejects(show(T0 + HOUR), { status: 429 });
	assert.equal(w.repo._fam.links.length, CODE_LIMITS.perLearnerPerDay);
	assert.ok((await show(T0 + 25 * HOUR)).code, "the window rolls over after a day");
});

test("the error for a bad code is the same for every failure and tells the parent what to do", async () => {
	const { w, show } = await childWorld();
	const good = await show();
	const used = await show(T0 + 2000);
	await redeemParentLink(w.repo, w.A, { code: used.code }, ctx(T0 + 3000));
	const messages = new Set();
	for (const code of ["AAAAAAAA", good.code /* replaced */, used.code /* used, other account */, "x"]) {
		const who = code === used.code ? w.B : w.A;
		const err = await redeemParentLink(w.repo, who, { code }, ctx(T0 + 4000)).catch((e) => e);
		assert.equal(err.status, 404);
		messages.add(err.message);
	}
	assert.equal(messages.size, 1);
	assert.match([...messages][0], /show a new code on their Study page/);
	assert.doesNotMatch([...messages][0], /request/i);
});

test("codes never change the learner, enrolments or ownership, and give parents no new permissions", async () => {
	const { w, m, show } = await childWorld();
	const snap = async () => JSON.stringify({ learner: await w.repo.getLearner(m.id), enrol: await w.repo.listEnrolments(m.id) });
	const before = await snap();
	await redeemParentLink(w.repo, w.A, { code: (await show()).code }, ctx(T0 + HOUR));
	assert.equal(await snap(), before);
	assert.equal((await w.repo.getLearner(m.id)).owner_user_id, "teacher");
	assert.ok(!w.A.permissions.has("learners.create"));
	await assert.rejects(svc.createLearner(w.repo, w.A, { displayName: "X", pin: "1234" }, ctx()), { status: 403 });
	await assert.rejects(svc.removeLearner(w.repo, w.A, m.id, "Maya", ctx()), { status: 403 });
});

// ------------------------------------------------------------------ the instructor button is gone, the parent entry points exist

test("no staff or parent code-generation route exists; instructor learner management is untouched", () => {
	const root = new URL("../../", import.meta.url);
	const src = (p) => readFileSync(new URL(p, root), "utf8");
	assert.equal(existsSync(new URL("pages/api/family/link/issue.js", root)), false);
	assert.equal(typeof linksModule.createParentLink, "undefined");
	assert.deepEqual(Object.keys(linksModule).filter((k) => /create|issue/i.test(k)), ["issueLinkCodeForChild"], "the only way to create a code");
	for (const f of ["components/Instructor/StudentDirectory.js", "pages/family/index.js"]) assert.doesNotMatch(src(f), /canIssueParentLink|Generate Parent Link Code|link\/(issue|code)/, f);
	assert.match(src("components/Instructor/StudentDirectory.js"), /\/api\/instructor\/students\/link/);
	assert.match(src("components/Instructor/StudentDirectory.js"), /Unlink profile/);
	// the only callers of the code creator are the child route and the tests' child-driven helper
	assert.match(src("pages/api/family/link/code.js"), /issueLinkCodeForChild/);
});

test("an instructor, administrator or parent has no way to create a code, even with a learner id", async () => {
	const { w, m } = await childWorld();
	for (const who of [w.A, w.teacher, w.teacher2, w.admin]) {
		await assert.rejects(issueLinkCodeForChild(w.repo, who, { ...ctx(), learnerId: m.id }), { status: 404, code: "no_profile" });
	}
	assert.equal(w.repo._fam.links.length, 0);
});

test("the child can cancel the open code; it stops working at once, and status shows linked parents", async () => {
	const { w, m, show } = await childWorld();
	assert.deepEqual((await getChildLinkStatus(w.repo, w.student, ctx())).openCode, null);
	const c = await show(T0 + 1000);
	const st = await getChildLinkStatus(w.repo, w.student, ctx(T0 + 2000));
	assert.equal(st.openCode.expiresAt, c.expiresAt);
	assert.ok(!JSON.stringify(st).includes(c.code));
	assert.deepEqual(await cancelLinkCodeForChild(w.repo, w.student, ctx(T0 + 3000)), { cancelled: true });
	assert.deepEqual(await cancelLinkCodeForChild(w.repo, w.student, ctx(T0 + 3500)), { cancelled: false });
	await assert.rejects(redeemParentLink(w.repo, w.A, { code: c.code }, ctx(T0 + 4000)), { status: 404, code: "invalid_code" });
	assert.equal((await getChildLinkStatus(w.repo, w.student, ctx(T0 + 4000))).openCode, null);
	// only the child's own account can cancel
	const d = await show(T0 + 5000);
	for (const who of [w.A, w.teacher, w.admin]) await assert.rejects(cancelLinkCodeForChild(w.repo, who, ctx(T0 + 6000)), { status: 404 });
	await assert.rejects(cancelLinkCodeForChild(w.repo, null, ctx()), { status: 401 });
	await redeemParentLink(w.repo, w.A, { code: d.code }, ctx(T0 + 7000));
	const after = await getChildLinkStatus(w.repo, w.student, ctx(T0 + 8000));
	assert.equal(after.openCode, null, "a used code is no longer open");
	assert.equal(after.parents.length, 1);
	assert.equal(m.id, after.learner.id);
});

test("family isolation: a code links exactly its own learner; the other family's child stays unreachable", async () => {
	const w = world();
	const m = await newLearner(w, w.teacher, "Maya");
	const z = await newLearner(w, w.teacher, "Zed");
	const cm = await parentCode(w.repo, m.id, ctx());
	const cz = await parentCode(w.repo, z.id, ctx());
	await redeemParentLink(w.repo, w.A, { code: cm.code }, ctx());
	await redeemParentLink(w.repo, w.B, { code: cz.code }, ctx());
	assert.deepEqual((await fam.getFamily(w.repo, w.A, ctx())).children.map((c) => c.id), [m.id]);
	assert.deepEqual((await fam.getFamily(w.repo, w.B, ctx())).children.map((c) => c.id), [z.id]);
	await assert.rejects(fam.createPairing(w.repo, w.A, { learnerIds: [z.id] }, ctx()), { status: 404 });
	await assert.rejects(svc.loadLearner(w.repo, w.B, m.id, "view"), { status: 404 });
	// the other child's own account cannot touch Maya's code
	await assert.rejects(cancelLinkCodeForChild(w.repo, w.A, ctx()), { status: 404 });
});

test("the e-mail request flow is gone from the API, client, UI and model", () => {
	const root = new URL("../../", import.meta.url);
	const src = (p) => readFileSync(new URL(p, root), "utf8");
	for (const f of ["pages/api/family/link/request.js", "pages/api/family/link/requests.js", "components/Family/ParentLinkRequests.js", "database/migrations/20261025000000-parent-link-requests.js"]) {
		assert.equal(existsSync(new URL(f, root)), false, f);
	}
	for (const f of ["components/Family/LinkChild.js", "lib/family/client.js", "lib/family/links.js", "lib/family/repo.js", "database/models/family.js", "pages/study/index.js"]) {
		assert.doesNotMatch(src(f), /childEmail|requestLink|requestParentLink|listLinkRequests|ParentLinkRequests|requested_by|Parent Linking Request/, f);
	}
	const form = src("components/Family/LinkChild.js");
	assert.doesNotMatch(form, /type="email"|-email|setEmail/, "no e-mail input in the parent form");
	assert.match(form, /Link child/);
	assert.match(form, /Show parent link code/);
	assert.match(src("components/Family/ParentDashboard.js"), /Link my child/);
});

test("UI/API wiring: Link my child, the child's code button; the body is never trusted for identity", () => {
	const root = new URL("../../", import.meta.url);
	const src = (p) => readFileSync(new URL(p, root), "utf8");
	const c = src("components/Family/ParentLinkCode.js");
	assert.match(c, /Show parent link code/);
	assert.match(c, /72 hours/);
	assert.match(c, /navigator\.clipboard\.writeText/);
	assert.match(c, /expiresAt/);
	assert.doesNotMatch(c, /localStorage|sessionStorage|location\.|console\./, "the code never goes to storage, URLs or logs");
	// The code UI lives on the student Family page, not in the Mastery Ladder (Study) page.
	assert.match(src("components/Family/StudentFamily.js"), /<ParentLinkCode \/>/);
	assert.doesNotMatch(src("pages/study/index.js"), /ParentLinkCode|Link my parent|parent link code/i);
	const api = src("pages/api/family/link/code.js");
	assert.match(api, /getAccountActor\(req\)/);
	assert.match(api, /issueLinkCodeForChild\(familyRepo, actor, ctxOf\(req\)\)/, "no learner id or other input reaches the service");
	assert.doesNotMatch(api, /body\(/);
	assert.match(api, /fam-link-show/);
	assert.doesNotMatch(src("lib/family/links.js"), /console\./);
});

// ------------------------------------------------------------------ regression: privacy, unlink, atomic redemption

import { unlinkStudentProfile } from "../../lib/mastery/studentLinks.js";

const linkedStatus = (w, id) => w.repo._fam.links.filter((l) => l.learner_id === id).map((l) => l.status);

test("privacy: a linked parent gets the learning data but no other adult's e-mail and no recorded contact details", async () => {
	const w = world();
	const m = await newLearner(w, w.teacher, "Maya");
	await w.repo.updateLearner(m.id, { birth_date: "2018-03-04", contact_name: "Aunt Rosa", contact_phone: "+15550001111", contact_email: "rosa-private@example.com" });
	await w.repo.addGuardian({ learner_id: m.id, user_id: "teacher2", relation: "instructor", created_by: "teacher" });
	await redeemParentLink(w.repo, w.A, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx());
	await redeemParentLink(w.repo, w.B, { code: (await parentCode(w.repo, m.id, ctx())).code }, ctx());

	const asParent = await svc.learnerDashboard(w.repo, w.A, m.id, { now: T0 });
	assert.equal(asParent.learner.id, m.id, "the child's learning view still works");
	assert.ok(Array.isArray(asParent.subjects) && Array.isArray(asParent.assignments));
	assert.deepEqual(asParent.guardians, [], "no guardian list for a parent");
	assert.equal(asParent.profile, null, "no date of birth or contact details for a parent");
	const text = JSON.stringify(asParent);
	for (const secret of ["b@example.com", "teacher2@example.com", "teacher@example.com", "rosa-private", "+15550001111", "Aunt Rosa", "2018-03-04"]) assert.ok(!text.includes(secret), `parent response must not contain ${secret}`);

	// staff keep the full response: owning instructor, administrator, and a linked instructor
	for (const who of [w.teacher, w.admin, w.teacher2]) {
		const d = await svc.learnerDashboard(w.repo, who, m.id, { now: T0 });
		assert.equal(d.profile.contactEmail, "rosa-private@example.com");
		assert.equal(d.profile.birthDate, "2018-03-04");
	}
	for (const who of [w.teacher, w.admin]) {
		const d = await svc.learnerDashboard(w.repo, who, m.id, { now: T0 });
		assert.deepEqual(d.guardians.map((g) => g.email).sort(), ["a@example.com", "b@example.com", "teacher2@example.com"]);
	}
	// the learner's own student account was never given these either
	await w.repo.updateLearner(m.id, { student_user_id: "student" });
	const self = await svc.learnerDashboard(w.repo, w.student, m.id, { now: T0 });
	assert.deepEqual([self.profile, self.guardians], [null, []]);
});

test("unlinking the student cancels the open parent-link codes", async () => {
	const { w, m, show } = await childWorld();
	const c = await show();
	assert.deepEqual(linkedStatus(w, m.id), ["open"]);
	assert.deepEqual(await unlinkStudentProfile(w.repo, w.teacher, { learnerId: m.id }), { learnerId: m.id, unlinked: true });
	assert.deepEqual(linkedStatus(w, m.id), ["cancelled"]);
	await assert.rejects(redeemParentLink(w.repo, w.A, { code: c.code }, ctx(T0 + HOUR)), { status: 404, code: "invalid_code" });
	assert.equal(w.repo._db.guardians.length, 0);
	// the learner itself is untouched
	assert.equal((await w.repo.getLearner(m.id)).owner_user_id, "teacher");
});

test("redeeming rejects a code whose issuer is no longer the learner's student account, even if it is still open", async () => {
	const { w, m, show } = await childWorld();
	const c = await show();
	// the association changes WITHOUT going through unlink (so nothing cancelled the code)
	await w.repo.updateLearner(m.id, { student_user_id: null });
	assert.deepEqual(linkedStatus(w, m.id), ["open"]);
	await assert.rejects(redeemParentLink(w.repo, w.A, { code: c.code }, ctx(T0 + 1000)), { status: 404, code: "invalid_code" }, "unlinked");
	// another student is linked instead: the code was not issued by them
	w.repo._db.users.push({ id: "student2", email: "s2@example.com", role: "student", status: true });
	await w.repo.updateLearner(m.id, { student_user_id: "student2" });
	await assert.rejects(redeemParentLink(w.repo, w.A, { code: c.code }, ctx(T0 + 2000)), { status: 404, code: "invalid_code" }, "re-linked to someone else");
	// nothing in the request can change the answer
	for (const extra of [{ learnerId: m.id }, { issuedBy: "student2" }, { student_user_id: "student" }]) {
		await assert.rejects(redeemParentLink(w.repo, w.A, { code: c.code, ...extra }, ctx(T0 + 3000)), { status: 404 });
	}
	assert.equal(w.repo._db.guardians.length, 0);
	// the new student account can make its own code, which works
	const fresh = await issueLinkCodeForChild(w.repo, account("student2"), ctx(T0 + 4000));
	assert.equal((await redeemParentLink(w.repo, w.A, { code: fresh.code }, ctx(T0 + 5000))).child.id, m.id);
});

test("rejections do not consume the code: instructor link, owner and the child's own account", async () => {
	const { w, m, show } = await childWorld();
	await w.repo.addGuardian({ learner_id: m.id, user_id: "teacher2", relation: "instructor", created_by: "teacher" });
	const c = await show();
	await assert.rejects(redeemParentLink(w.repo, w.teacher2, { code: c.code }, ctx(T0 + 2000)), { status: 409 }, "instructor link is never turned into a parent link");
	await assert.rejects(redeemParentLink(w.repo, w.teacher, { code: c.code }, ctx(T0 + 2000)), { status: 409 }, "the owner needs no link");
	await assert.rejects(redeemParentLink(w.repo, w.student, { code: c.code }, ctx(T0 + 2000)), { status: 422 }, "the child's own account");
	assert.deepEqual(linkedStatus(w, m.id), ["open"], "still unused");
	assert.equal((await w.repo.getGuardian(m.id, "teacher2")).relation, "instructor");
	assert.equal(w.repo._db.guardians.length, 1, "no guardian row was added or changed");
	assert.equal((await redeemParentLink(w.repo, w.A, { code: c.code }, ctx(T0 + 3000))).linked, true, "the real parent can still use it");
});

test("a failed guardian insert rolls the code back: it is not consumed without a link", async () => {
	const { w, m, show } = await childWorld();
	const c = await show();
	const real = w.repo.addGuardian;
	w.repo.addGuardian = async () => {
		throw new Error("db down");
	};
	await assert.rejects(redeemParentLink(w.repo, w.A, { code: c.code }, ctx(T0 + 2000)), /db down/);
	assert.deepEqual(linkedStatus(w, m.id), ["open"], "the code is still open");
	assert.equal(w.repo._fam.links[0].used_by, null);
	assert.equal(w.repo._db.guardians.length, 0, "and no guardian exists");
	w.repo.addGuardian = real;
	assert.equal((await redeemParentLink(w.repo, w.A, { code: c.code }, ctx(T0 + 3000))).linked, true, "retrying works");
	assert.deepEqual(linkedStatus(w, m.id), ["used"]);
	assert.equal(w.repo._db.guardians.length, 1);
});

test("concurrent redemption by many parents: exactly one wins, one code use, one guardian", async () => {
	const { w, m, show } = await childWorld();
	for (const id of ["p3", "p4", "p5"]) w.repo._db.users.push({ id, email: `${id}@example.com`, role: "student", status: true });
	const parents = [w.A, w.B, account("p3"), account("p4"), account("p5"), w.A, w.B];
	const { code } = await show();
	const res = await Promise.allSettled(parents.map((who) => redeemParentLink(w.repo, who, { code }, ctx(T0 + 2000))));
	const won = res.map((r, i) => (r.status === "fulfilled" ? parents[i].userId : null)).filter(Boolean);
	assert.ok(new Set(won).size === 1, "only one account ends up linked");
	assert.ok(res.filter((r) => r.status === "rejected").every((r) => r.reason.status === 404));
	assert.deepEqual(linkedStatus(w, m.id), ["used"]);
	assert.deepEqual(w.repo._db.guardians.map((g) => g.user_id), [won[0]]);
});

test("wiring: the unlink route uses the repository that can cancel codes, and the real repo redeems in one locked transaction", () => {
	const root = new URL("../../", import.meta.url);
	const src = (p) => readFileSync(new URL(p, root), "utf8");
	assert.match(src("pages/api/instructor/students/link.js"), /unlinkStudentProfile\(familyRepo, actor, b\)/);
	const repoSrc = src("lib/family/repo.js");
	const body = repoSrc.slice(repoSrc.indexOf("async redeemLinkCode"), repoSrc.indexOf("// ---- devices ----"));
	assert.match(body, /connection\.transaction/);
	assert.match(body, /LOCK\.UPDATE/);
	assert.match(body, /learner\.student_user_id !== code\.issued_by/);
	assert.match(body, /ML_Guardian\.create\(.*\{ transaction: t \}\)/);
	assert.doesNotMatch(repoSrc, /claimLinkCode/);
	assert.match(src("lib/mastery/service.js"), /const staff = /);
});

// ------------------------------------------------------------------ the "Something went wrong" failure

import { friendlyDbError, isSchemaMismatch, logLine } from "../../lib/mastery-server/dbErrors.js";

test("a missing fam_link_codes table gives a helpful 503, never SQL, table names or a stack", () => {
	// exactly what Sequelize raises when migration 20261024000000 has not been applied
	const err = Object.assign(new Error("Table 'sharpstudy_dev.fam_link_codes' doesn't exist"), {
		name: "SequelizeDatabaseError",
		original: { code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'sharpstudy_dev.fam_link_codes' doesn't exist", sql: "INSERT INTO `fam_link_codes` ..." },
	});
	assert.equal(isSchemaMismatch(err), true);
	const f = friendlyDbError(err);
	assert.equal(f.status, 503);
	assert.equal(f.body.code, "setup_incomplete");
	assert.match(f.body.message, /migrations/i);
	const text = JSON.stringify(f);
	for (const leak of ["fam_link_codes", "sharpstudy", "INSERT", "ER_NO_SUCH_TABLE", "stack"]) assert.ok(!text.includes(leak), leak);
	assert.equal(logLine(err), "ER_NO_SUCH_TABLE (sharpstudy_dev.fam_link_codes)", "the operator's log names the missing table");
	assert.ok(!logLine(err).includes("INSERT"));
	assert.equal(isSchemaMismatch(Object.assign(new Error("x"), { original: { code: "ER_BAD_FIELD_ERROR" } })), true);
	assert.equal(friendlyDbError(Object.assign(new Error("x"), { name: "SequelizeConnectionRefusedError" })).body.code, "db_unavailable");
	assert.equal(friendlyDbError(new Error("boom")), null, "unknown errors stay a generic 500");
});

test("apiHandler uses the translation, and the migration matches the model the repo writes", () => {
	const root = new URL("../../", import.meta.url);
	const src = (p) => readFileSync(new URL(p, root), "utf8");
	assert.match(src("lib/mastery-server/http.js"), /friendlyDbError\(e\)/);
	const mig = src("database/migrations/20261024000000-parent-link-codes.js");
	const model = src("database/models/family.js");
	assert.match(mig, /createTable\("fam_link_codes"/);
	assert.match(model, /"fam_link_codes"/);
	for (const col of ["learner_id", "issued_by", "code_hash", "status", "expires_at", "used_by", "used_at", "created_at", "updated_at"]) {
		assert.match(mig, new RegExp("(^|[^a-z_])" + col + "([^a-z_]|$)"), `migration has ${col}`);
	}
	for (const col of ["learner_id", "issued_by", "code_hash", "status", "expires_at", "used_by", "used_at"]) assert.match(model, new RegExp("(^|[^a-z_])" + col + "([^a-z_]|$)"), `model has ${col}`);
});

test("issuing a code end to end through the service writes exactly one open, hashed, 72-hour row", async () => {
	const w = world();
	const m = await newLearner(w);
	const r = await parentCode(w.repo, m.id, ctx());
	assert.equal(w.repo._fam.links.length, 1);
	const row = w.repo._fam.links[0];
	assert.deepEqual([row.learner_id, row.issued_by, row.status], [m.id, `child-of-${m.id}`, "open"]);
	assert.equal(new Date(row.expires_at).getTime() - T0, 72 * HOUR);
	assert.equal(new Date(r.expiresAt).getTime(), new Date(row.expires_at).getTime());
	assert.ok(!JSON.stringify(row).includes(r.code));
});
