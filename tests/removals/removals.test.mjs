// Student removal requests: an instructor ASKS, an administrator decides, and approval removes exactly one
// instructor link. In-memory repo only: no database is touched and no migration is needed to run these.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ServiceError } from "../../lib/mastery/service.js";
import { createRequest, listMine, listAll, getOne, decide, removalEligibility } from "../../lib/removals/service.js";
import { REASONS, REASON_CODES, STATUSES } from "../../lib/removals/reasons.js";
import { world, ID, actor, snapshotProtected } from "./memoryRepo.mjs";

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const A = actor(ID.instA, "instructor");
const B = actor(ID.instB, "instructor");
const ADMIN = actor(ID.admin, "admin");
const fails = (p, status, code) => assert.rejects(p, (e) => e instanceof ServiceError && e.status === status && (!code || e.code === code), `expected ${status} ${code || ""}`);
const ask = (repo, who, learnerId, reasonCode = "no_longer_belongs", comments = "") => createRequest(repo, who, { learnerId, reasonCode, comments });
const nm = (id) => Object.keys(ID).find((k) => ID[k] === id) || id;
const guardians = (repo) => repo.db.guardians.map((g) => `${nm(g.learner_id)}:${nm(g.user_id)}:${g.relation}`).sort();

// ---------------------------------------------------------------- requesting
test("an instructor can request removal of a learner they are linked to; it is pending and audited", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1, "duplicate_profile", "  Same child, two profiles  ");
	assert.equal(request.status, "pending");
	assert.equal(request.learnerName, "Kid One");
	assert.equal(request.reason, "Duplicate learner profile");
	assert.equal(request.comments, "Same child, two profiles");
	const row = repo.db.requests[0];
	assert.deepEqual([row.instructor_id, row.learner_id, row.student_user_id, row.relation, row.status, row.pending_key], [ID.instA, ID.L1, ID.studentAcct, "instructor_link", "pending", `${ID.instA}:${ID.L1}`]);
	assert.deepEqual(repo.db.audit.map((a) => [a.action, a.actor_user_id, a.learner_id]), [["student_removal.request", ID.instA, ID.L1]]);
});

test("requesting changes nothing but the request, its audit entry and notifications; the link stays until an admin approves", async () => {
	const repo = world();
	const before = snapshotProtected(repo);
	const links = guardians(repo);
	await ask(repo, A, ID.L1);
	assert.equal(snapshotProtected(repo), before);
	assert.deepEqual(guardians(repo), links);
});

test("an instructor cannot request removal of another instructor's learner, or of a learner they have no link to", async () => {
	const repo = world();
	await fails(ask(repo, A, ID.L4), 404, "not_found"); // only Ben is linked to L4
	await fails(ask(repo, B, ID.L2), 404, "not_found"); // only Ann is linked to L2
	await fails(ask(repo, A, "99999999-9999-4999-8999-999999999999"), 404, "not_found");
	await fails(ask(repo, A, "not-a-uuid"), 400, "bad_request");
	assert.equal(repo.db.requests.length, 0);
});

test("a profile the instructor OWNS, or is only a parent of, is not removable", async () => {
	const repo = world();
	await fails(ask(repo, A, ID.L3), 422, "not_removable"); // owned by Ann
	await fails(ask(repo, actor(ID.parent, "instructor"), ID.L1), 404); // a 'parent' link is not a teaching link
	assert.equal(repo.db.requests.length, 0);
});

test("a client-supplied instructor id is ignored: the request is always for the authenticated instructor", async () => {
	const repo = world();
	await createRequest(repo, A, { learnerId: ID.L1, reasonCode: "other", comments: "because", instructorId: ID.instB, instructor_id: ID.instB, userId: ID.instB });
	assert.equal(repo.db.requests[0].instructor_id, ID.instA);
});

test("only instructors can request: students, parents, admins, learners and anonymous callers cannot", async () => {
	const repo = world();
	await fails(ask(repo, actor(ID.parent, "student"), ID.L1), 403);
	await fails(ask(repo, ADMIN, ID.L1), 403);
	await fails(ask(repo, { kind: "learner", learnerId: ID.L1 }, ID.L1), 401);
	await fails(ask(repo, null, ID.L1), 401);
	assert.equal(repo.db.requests.length, 0);
});

test("a reason is mandatory and must be one of the offered reasons", async () => {
	const repo = world();
	await fails(createRequest(repo, A, { learnerId: ID.L1 }), 422, "invalid_reason");
	await fails(createRequest(repo, A, { learnerId: ID.L1, reasonCode: "" }), 422, "invalid_reason");
	await fails(createRequest(repo, A, { learnerId: ID.L1, reasonCode: "because i said so" }), 422, "invalid_reason");
	await fails(createRequest(repo, A, { learnerId: ID.L1, reasonCode: "other" }), 422, "invalid_comments"); // "Other" needs an explanation
	await fails(createRequest(repo, A, { learnerId: ID.L1, reasonCode: "other", comments: "  " }), 422, "invalid_comments");
	await createRequest(repo, A, { learnerId: ID.L1, reasonCode: "other", comments: "Left the programme" }); // fine
	assert.equal(REASON_CODES.length, 5);
	assert.deepEqual(REASONS.map((r) => r.label), ["Student registered incorrectly", "Duplicate learner profile", "Student no longer belongs to this instructor", "Incorrect student assignment", "Other"]);
});

test("comments are optional for the named reasons, trimmed and capped", async () => {
	const repo = world();
	const { request } = await createRequest(repo, A, { learnerId: ID.L1, reasonCode: "incorrect_assignment", comments: "x".repeat(5000) });
	assert.equal(request.comments.length, 1000);
	const none = await createRequest(repo, A, { learnerId: ID.L2, reasonCode: "registered_incorrectly" });
	assert.equal(none.request.comments, "");
});

// ---------------------------------------------------------------- duplicates
test("a second pending request for the same instructor and learner is rejected; another learner or instructor is fine", async () => {
	const repo = world();
	await ask(repo, A, ID.L1);
	await fails(ask(repo, A, ID.L1, "other", "again please"), 409, "duplicate_pending");
	await ask(repo, A, ID.L2); // a different learner
	await ask(repo, B, ID.L1); // a different instructor, same learner
	assert.equal(repo.db.requests.length, 3);
});

test("the database-level guard also stops a race between two submissions", async () => {
	const repo = world();
	const row = { id: "r1", instructor_id: ID.instA, learner_id: ID.L1, status: "pending", pending_key: `${ID.instA}:${ID.L1}` };
	await repo.transaction((tx) => tx.insertRequest(row));
	await assert.rejects(repo.transaction((tx) => tx.insertRequest({ ...row, id: "r2" })), (e) => e.status === 409 && e.code === "duplicate_pending");
	assert.equal(repo.db.requests.length, 1);
});

test("after a rejection the instructor may ask again; after an approval the link is gone so they cannot", async () => {
	const repo = world();
	const first = (await ask(repo, A, ID.L1)).request.id;
	await decide(repo, ADMIN, first, { action: "reject", note: "Please keep teaching this learner" });
	const second = (await ask(repo, A, ID.L1)).request.id; // pending_key was cleared by the decision
	await decide(repo, ADMIN, second, { action: "approve" });
	await fails(ask(repo, A, ID.L1), 404, "not_found");
});

// ---------------------------------------------------------------- approval: only the right link, nothing else
test("approval removes exactly the requesting instructor's link and nothing else", async () => {
	const repo = world();
	const protectedBefore = snapshotProtected(repo);
	const linksBefore = guardians(repo);
	const { request } = await ask(repo, A, ID.L1);
	const out = await decide(repo, ADMIN, request.id, { action: "approve" });
	assert.equal(out.linksRemoved, 1);
	assert.equal(out.request.status, "approved");
	const removed = linksBefore.filter((l) => !guardians(repo).includes(l));
	assert.deepEqual(removed, ["L1:instA:instructor"], "exactly one link disappeared");
	assert.equal(snapshotProtected(repo), protectedBefore, "accounts, profiles, enrolments, assignments, attempts, progress, certificates and attendance are untouched");
});

test("other instructors' links, the parents' links and the same instructor's other learners all remain", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1);
	await decide(repo, ADMIN, request.id, { action: "approve" });
	const has = (l, u, rel) => repo.db.guardians.some((g) => g.learner_id === l && g.user_id === u && g.relation === rel);
	assert.ok(has(ID.L1, ID.instB, "instructor"), "Ben still teaches Kid One");
	assert.ok(has(ID.L1, ID.parent, "parent") && has(ID.L1, ID.parent2, "parent"), "parents keep access");
	assert.ok(has(ID.L2, ID.instA, "instructor"), "Ann still teaches Kid Two");
	assert.ok(has(ID.L4, ID.instB, "instructor"));
	assert.ok(!has(ID.L1, ID.instA, "instructor"));
	// the learner keeps their data even though one instructor was removed; if every instructor were removed the learner would remain too
	assert.equal(repo.db.learners.length, 4);
	assert.equal(repo.db.assignments.length, 2, "assignments Ann created are kept");
});

test("removing the LAST instructor leaves the learner profile and all learning history in place", async () => {
	const repo = world();
	const r1 = (await ask(repo, A, ID.L1)).request.id;
	const r2 = (await ask(repo, B, ID.L1)).request.id;
	const before = snapshotProtected(repo);
	await decide(repo, ADMIN, r1, { action: "approve" });
	await decide(repo, ADMIN, r2, { action: "approve" });
	assert.equal(repo.db.guardians.filter((g) => g.learner_id === ID.L1 && g.relation === "instructor").length, 0);
	assert.equal(snapshotProtected(repo), before);
});

test("paid-course enrolments are never modified by an approval", async () => {
	const repo = world();
	const enrolments = JSON.stringify([repo.db.enrolments, repo.db.courseEnrolments]);
	const { request } = await ask(repo, A, ID.L1);
	await decide(repo, ADMIN, request.id, { action: "approve" });
	assert.equal(JSON.stringify([repo.db.enrolments, repo.db.courseEnrolments]), enrolments);
});

test("approval records who decided, when, and an audit entry; the request is closed to new decisions", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1);
	const when = new Date("2026-11-02T10:00:00Z");
	await decide(repo, ADMIN, request.id, { action: "approve", note: "Confirmed with the parent" }, { now: when, ip: "10.0.0.1" });
	const row = repo.db.requests[0];
	assert.deepEqual([row.status, row.decided_by, row.decision_note, row.pending_key], ["approved", ID.admin, "Confirmed with the parent", null]);
	assert.equal(new Date(row.decided_at).toISOString(), when.toISOString());
	const audit = repo.db.audit.at(-1);
	assert.deepEqual([audit.action, audit.actor_user_id, audit.learner_id, audit.ip], ["student_removal.approve", ID.admin, ID.L1, "10.0.0.1"]);
	assert.deepEqual([audit.details.linksRemoved, audit.details.instructorId, audit.details.requestId], [1, ID.instA, request.id]);
});

// ---------------------------------------------------------------- rejection
test("rejection keeps every relationship and record, and needs an explanation", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1);
	const before = snapshotProtected(repo);
	const links = guardians(repo);
	await fails(decide(repo, ADMIN, request.id, { action: "reject" }), 422, "note_required");
	await fails(decide(repo, ADMIN, request.id, { action: "reject", note: "  " }), 422, "note_required");
	await fails(decide(repo, ADMIN, request.id, { action: "reject", note: "no" }), 422, "note_required");
	assert.equal(repo.db.requests[0].status, "pending", "a refused rejection changed nothing");
	const out = await decide(repo, ADMIN, request.id, { action: "reject", note: "Ann is still this learner's tutor." });
	assert.equal(out.request.status, "rejected");
	assert.equal(out.linksRemoved, 0);
	assert.deepEqual(guardians(repo), links);
	assert.equal(snapshotProtected(repo), before);
	assert.deepEqual([repo.db.requests[0].decided_by, repo.db.requests[0].decision_note], [ID.admin, "Ann is still this learner's tutor."]);
});

test("decisions cannot be changed or repeated, by anyone", async () => {
	const repo = world();
	const a = (await ask(repo, A, ID.L1)).request.id;
	const b = (await ask(repo, A, ID.L2)).request.id;
	await decide(repo, ADMIN, a, { action: "approve" });
	await fails(decide(repo, ADMIN, a, { action: "reject", note: "changed my mind" }), 409, "already_decided");
	await fails(decide(repo, actor(ID.admin2, "admin"), a, { action: "approve" }), 409, "already_decided");
	await decide(repo, ADMIN, b, { action: "reject", note: "keep" });
	await fails(decide(repo, ADMIN, b, { action: "approve" }), 409, "already_decided");
	assert.equal(repo.db.requests.find((r) => r.id === b).status, "rejected");
	assert.ok(repo.db.guardians.some((g) => g.learner_id === ID.L2 && g.user_id === ID.instA), "the rejected request's link survived the attempted approval");
});

// ---------------------------------------------------------------- permissions on decisions
test("only administrators can approve or reject", async () => {
	const repo = world();
	const id = (await ask(repo, A, ID.L1)).request.id;
	for (const who of [A, B, actor(ID.parent, "student"), actor(ID.studentAcct, "student"), { kind: "learner", learnerId: ID.L1 }, null]) {
		await assert.rejects(decide(repo, who, id, { action: "approve" }), (e) => e instanceof ServiceError && (e.status === 403 || e.status === 401));
		await assert.rejects(decide(repo, who, id, { action: "reject", note: "nope nope" }), (e) => e instanceof ServiceError && (e.status === 403 || e.status === 401));
	}
	assert.equal(repo.db.requests[0].status, "pending");
	assert.ok(repo.db.guardians.some((g) => g.learner_id === ID.L1 && g.user_id === ID.instA && g.relation === "instructor"));
});

test("the requesting instructor cannot decide their own request, and invalid ids and actions are refused", async () => {
	const repo = world();
	const id = (await ask(repo, A, ID.L1)).request.id;
	await fails(decide(repo, A, id, { action: "approve" }), 403);
	await fails(decide(repo, ADMIN, "not-a-uuid", { action: "approve" }), 422);
	await fails(decide(repo, ADMIN, id, { action: "delete" }), 422);
	await fails(decide(repo, ADMIN, id, {}), 422);
	await fails(decide(repo, ADMIN, "99999999-9999-4999-8999-999999999999", { action: "approve" }), 404);
});

// ---------------------------------------------------------------- atomicity
test("if the audit write fails, the approval rolls back: the link, the request and its pending guard are unchanged", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1);
	const links = guardians(repo);
	repo.hooks.failAudit = true;
	await assert.rejects(decide(repo, ADMIN, request.id, { action: "approve" }), /audit table unavailable/);
	repo.hooks.failAudit = false;
	assert.deepEqual(guardians(repo), links, "the instructor link was NOT removed");
	const row = repo.db.requests[0];
	assert.deepEqual([row.status, row.pending_key, row.decided_by], ["pending", `${ID.instA}:${ID.L1}`, undefined]);
	assert.equal(repo.db.notifications.filter((n) => n.type !== "student_removal_requested").length, 0, "nobody was told about a change that did not happen");
	// and the request can still be decided afterwards
	await decide(repo, ADMIN, request.id, { action: "approve" });
	assert.equal(repo.db.requests[0].status, "approved");
});

test("if another admin decides first (the status update changes no row), the link removal is rolled back too", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1);
	const links = guardians(repo);
	repo.hooks.loseRace = true;
	await fails(decide(repo, ADMIN, request.id, { action: "approve" }), 409, "already_decided");
	assert.deepEqual(guardians(repo), links);
	assert.equal(repo.db.audit.filter((a) => a.action === "student_removal.approve").length, 0);
});

test("a failure while creating the request leaves no half-written request", async () => {
	const repo = world();
	repo.hooks.failAudit = true;
	await assert.rejects(ask(repo, A, ID.L1), /audit table unavailable/);
	assert.equal(repo.db.requests.length, 0);
	assert.equal(repo.db.requests.some((r) => r.pending_key), false, "the pending guard did not stick, so the instructor can retry");
});

test("approval is refused when the profile no longer exists (reject instead); a rejection still works", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1);
	repo.db.requests[0].learner_id = null; // ON DELETE SET NULL after the family deleted the profile
	await fails(decide(repo, ADMIN, request.id, { action: "approve" }), 409, "profile_gone");
	assert.equal(repo.db.requests[0].status, "pending");
	await decide(repo, ADMIN, request.id, { action: "reject", note: "Profile was deleted by the family." });
	assert.equal(repo.db.requests[0].status, "rejected");
});

test("approving when a parent already removed the link records the decision and removes nothing", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1);
	repo.db.guardians = repo.db.guardians.filter((g) => !(g.learner_id === ID.L1 && g.user_id === ID.instA));
	const detail = await getOne(repo, ADMIN, request.id);
	assert.equal(detail.request.linkActive, false);
	const out = await decide(repo, ADMIN, request.id, { action: "approve" });
	assert.equal(out.linksRemoved, 0);
	assert.equal(out.request.status, "approved");
});

// ---------------------------------------------------------------- who can see what
test("an instructor sees only their own requests, with the administrator's explanation; admins see all", async () => {
	const repo = world();
	const ra = (await ask(repo, A, ID.L1)).request.id;
	await ask(repo, A, ID.L2);
	const rb = (await ask(repo, B, ID.L4)).request.id;
	await decide(repo, ADMIN, ra, { action: "reject", note: "Keep teaching, please." });
	await decide(repo, ADMIN, rb, { action: "approve" });

	const mineA = (await listMine(repo, A)).requests;
	const mineB = (await listMine(repo, B)).requests;
	assert.deepEqual(mineA.map((r) => r.learnerName).sort(), ["Kid One", "Kid Two"]);
	assert.deepEqual(mineB.map((r) => r.learnerName), ["Kid Four"]);
	assert.equal(mineA.find((r) => r.id === ra).decisionNote, "Keep teaching, please.");
	assert.deepEqual(mineA.map((r) => r.status).sort(), ["pending", "rejected"]);
	assert.equal(mineB[0].status, "approved");
	// an instructor's view never carries other people's details
	assert.ok(!JSON.stringify(mineA).includes(ID.instB) && !JSON.stringify(mineA).includes("ben@example.com"));

	const all = (await listAll(repo, ADMIN)).requests;
	assert.equal(all.length, 3);
	assert.deepEqual((await listAll(repo, ADMIN, { status: "pending" })).requests.map((r) => r.learnerName), ["Kid Two"]);
	assert.equal((await listAll(repo, ADMIN, { status: "approved" })).requests.length, 1);
	assert.equal((await listAll(repo, ADMIN, { status: "rejected" })).requests.length, 1);
	await fails(listAll(repo, ADMIN, { status: "deleted" }), 422);
	const row = all.find((r) => r.id === ra);
	assert.deepEqual([row.instructor.email, row.student.email, row.reason, row.status, row.decidedBy.name, row.decisionNote], ["ann@example.com", "stu@example.com", "Student no longer belongs to this instructor", "rejected", "Admin Test", "Keep teaching, please."]);
	assert.ok(STATUSES.every((s) => ["pending", "approved", "rejected"].includes(s)));
});

test("instructors, students and parents cannot use the administrator views", async () => {
	const repo = world();
	const id = (await ask(repo, A, ID.L1)).request.id;
	for (const who of [A, B, actor(ID.parent, "student"), null]) {
		await assert.rejects(listAll(repo, who), (e) => e instanceof ServiceError && [401, 403].includes(e.status));
		await assert.rejects(getOne(repo, who, id), (e) => e instanceof ServiceError && [401, 403].includes(e.status));
	}
	await fails(listMine(repo, ADMIN), 403);
	await fails(listMine(repo, actor(ID.parent, "student")), 403);
});

// ---------------------------------------------------------------- notifications
const notes = (repo, type) => repo.db.notifications.filter((n) => n.type === type);

test("a new request notifies the active administrators (not the instructor), without leaking anything", async () => {
	const repo = world();
	repo.db.users.push({ ...repo.db.users.find((u) => u.id === ID.admin2), id: "a0000000-0000-4000-8000-000000000003", status: false }); // a disabled admin
	await ask(repo, A, ID.L1, "other", "Private detail");
	const n = notes(repo, "student_removal_requested");
	assert.deepEqual(n.map((x) => x.user_id).sort(), [ID.admin, ID.admin2].sort());
	assert.ok(n.every((x) => x.link === "/admin/students/removal-requests/" && x.email_status === "none" && x.ref_id === repo.db.requests[0].id));
	assert.equal(repo.db.notifications.some((x) => x.user_id === ID.instA), false);
});

test("approval notifies the instructor, the profile's owner, the linked student account and the parents; nobody else", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1, "other", "PRIVATE-REASON-TEXT");
	await decide(repo, ADMIN, request.id, { action: "approve" });
	const to = (type) => notes(repo, type).map((x) => x.user_id).sort();
	assert.deepEqual(to("student_removal_approved"), [ID.instA]);
	assert.deepEqual(to("student_link_removed"), [ID.owner, ID.studentAcct, ID.parent, ID.parent2].sort());
	assert.ok(!to("student_link_removed").includes(ID.instB), "the other instructor is not told");
	assert.ok(!to("student_link_removed").includes(ID.admin), "the deciding admin is not notified of their own action");
	const family = notes(repo, "student_link_removed");
	assert.equal(family.find((x) => x.user_id === ID.studentAcct).link, "/study/");
	assert.equal(family.find((x) => x.user_id === ID.parent).link, `/family/?learner=${ID.L1}`);
	assert.ok(family.every((x) => !/PRIVATE-REASON-TEXT/.test(x.body + x.title)), "the instructor's reason is for administrators only");
});

test("rejection notifies only the instructor, with the administrator's explanation", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1);
	await decide(repo, ADMIN, request.id, { action: "reject", note: "Still her tutor." });
	assert.deepEqual(notes(repo, "student_removal_rejected").map((x) => [x.user_id, /Still her tutor\./.test(x.body)]), [[ID.instA, true]]);
	assert.equal(notes(repo, "student_link_removed").length, 0);
});

test("notification type names fit the existing notifications table, and a repeat never notifies twice", async () => {
	const repo = world();
	const { request } = await ask(repo, A, ID.L1);
	await decide(repo, ADMIN, request.id, { action: "approve" });
	assert.ok(repo.db.notifications.every((n) => n.type.length <= 40 && n.title.length <= 200 && n.dedupe_key.length <= 190));
	const { notifyDecision } = await import("../../lib/removals/notify.js");
	const count = repo.db.notifications.length;
	await notifyDecision(repo, "approve", repo.db.requests[0], { removed: 1, recipients: [ID.owner, ID.parent], learner: repo.db.learners[0], adminId: ID.admin });
	assert.equal(repo.db.notifications.length, count, "dedupe_key made the repeat a no-op");
});

test("a notification failure never undoes or fails the request or the decision", async () => {
	const repo = world();
	repo.hooks.failNotification = true;
	const { request } = await ask(repo, A, ID.L1);
	const out = await decide(repo, ADMIN, request.id, { action: "approve" });
	assert.equal(out.request.status, "approved");
	assert.equal(guardians(repo).includes("L1:instA:instructor"), false);
	assert.ok(guardians(repo).includes("L1:instB:instructor"));
});

// ---------------------------------------------------------------- eligibility shown in the directory
test("Request Removal is offered only for instructor-linked learner profiles", () => {
	assert.deepEqual(removalEligibility({ learnerId: ID.L1, relation: "instructor" }), { allowed: true });
	for (const [row, re] of [[{ learnerId: ID.L3, relation: "owner" }, /own this profile/], [{ learnerId: null, relation: null }, /paid course enrolment/], [{ learnerId: ID.L1, relation: "parent" }, /paid course enrolment/], [{ learnerId: ID.L1, relation: "self" }, /own profile/]]) {
		const r = removalEligibility(row);
		assert.equal(r.allowed, false);
		assert.match(r.reason, re);
	}
	assert.match(read("lib/mastery/directory.js"), /removal: removalEligibility\(/);
});

// ---------------------------------------------------------------- the migration, the model and the wiring
const require = (await import("node:module")).createRequire(import.meta.url);
const MIGRATION = "../../database/migrations/20261026000000-create-student-removal-requests.js";
const PARENT_OK = [{ t: "users", ty: "char(36)", cs: "utf8mb4", co: "utf8mb4_bin" }, { t: "ml_learners", ty: "char(36)", cs: "utf8mb4", co: "utf8mb4_bin" }];
const ALL_INDEXES = ["PRIMARY", "uq_removal_pending", "ix_removal_status", "ix_removal_instructor", "ix_removal_learner"];

// A recording stand-in for the query interface: no database is involved.
function fakeInterface({ exists = false, indexes = [], parents = PARENT_OK } = {}) {
	const Sequelize = require("sequelize");
	const calls = { created: null, createOptions: null, indexes: [], dropped: [], selects: [] };
	const qi = {
		sequelize: { QueryTypes: { SELECT: "SELECT" }, query: async (sql) => { calls.selects.push(sql); return parents; } },
		tableExists: async () => exists,
		showIndex: async () => indexes.map((name) => ({ name })), // the real showIndex returns objects with `name` (checked in a later test)
		createTable: async (name, cols, options) => { calls.created = { name, cols }; calls.createOptions = options; },
		addIndex: async (table, cols, opts) => calls.indexes.push({ table, cols, ...opts }),
		dropTable: async (name) => calls.dropped.push(name),
	};
	return { Sequelize, qi, calls };
}

test("the migration creates only student_removal_requests, with the approved columns, keys and indexes", async () => {
	const m = require(MIGRATION);
	const { Sequelize, qi, calls } = fakeInterface();
	await m.up(qi, Sequelize);
	assert.equal(calls.created.name, "student_removal_requests");
	const cols = calls.created.cols;
	assert.deepEqual(Object.keys(cols).sort(), ["comments", "created_at", "decided_at", "decided_by", "decision_note", "id", "instructor_id", "learner_id", "learner_name", "pending_key", "reason_code", "relation", "status", "student_user_id", "updated_at"].sort());
	const fk = (c) => ({ table: cols[c].references.model, key: cols[c].references.key, onDelete: cols[c].onDelete });
	assert.deepEqual(fk("instructor_id"), { table: "users", key: "id", onDelete: "CASCADE" });
	assert.deepEqual(fk("learner_id"), { table: "ml_learners", key: "id", onDelete: "SET NULL" }); // deleting a profile must never be blocked
	assert.deepEqual(fk("student_user_id"), { table: "users", key: "id", onDelete: "SET NULL" });
	assert.deepEqual(fk("decided_by"), { table: "users", key: "id", onDelete: "SET NULL" });
	assert.equal(cols.instructor_id.allowNull, false);
	assert.equal(cols.learner_id.allowNull, true);
	assert.deepEqual(cols.reason_code.type.values, REASON_CODES);
	assert.deepEqual(cols.status.type.values, STATUSES);
	assert.equal(cols.status.defaultValue, "pending");
	assert.equal(cols.relation.defaultValue, "instructor_link");
	assert.equal(cols.pending_key.allowNull, true);
	assert.equal(cols.pending_key.type.options.length, 80);
	assert.equal(calls.dropped.length, 0);
});

test("foreign-key columns match the referenced key columns: same type and length (CHAR(36) BINARY) and the table is pinned to utf8mb4", async () => {
	const m = require(MIGRATION);
	const { Sequelize, qi, calls } = fakeInterface();
	await m.up(qi, Sequelize);
	const cols = calls.created.cols;
	// Sequelize UUID -> CHAR(36) BINARY, which in a utf8mb4 table is utf8mb4_bin: exactly users.id / ml_learners.id
	for (const c of ["id", "instructor_id", "learner_id", "student_user_id", "decided_by"]) assert.equal(String(cols[c].type), String(Sequelize.UUID), c);
	assert.deepEqual(calls.createOptions, { charset: "utf8mb4" }, "the character set is explicit, not whatever the database default happens to be");
	// the live parents were read first, and are what the guard requires
	assert.equal(calls.selects.length, 1);
	assert.match(calls.selects[0], /information_schema\.COLUMNS/);
	assert.match(calls.selects[0], /TABLE_NAME IN \('users', 'ml_learners'\)/);
});

test("the migration refuses to create anything when a referenced key column does not match", async () => {
	const m = require(MIGRATION);
	for (const bad of [
		[{ ...PARENT_OK[0], co: "utf8mb4_0900_ai_ci" }, PARENT_OK[1]],
		[PARENT_OK[0], { ...PARENT_OK[1], cs: "latin1", co: "latin1_bin" }],
		[{ ...PARENT_OK[0], ty: "varchar(36)" }, PARENT_OK[1]],
		[{ ...PARENT_OK[0], ty: "char(40)" }, PARENT_OK[1]],
		[PARENT_OK[0]], // ml_learners.id not found
		[],
	]) {
		const { Sequelize, qi, calls } = fakeInterface({ parents: bad });
		await assert.rejects(m.up(qi, Sequelize), /[Nn]othing was created|so nothing was created/);
		assert.equal(calls.created, null);
		assert.deepEqual(calls.indexes, []);
	}
});

test("every index is created with the right columns; the unique one guards pending_key", async () => {
	const m = require(MIGRATION);
	const { Sequelize, qi, calls } = fakeInterface();
	await m.up(qi, Sequelize);
	const ix = Object.fromEntries(calls.indexes.map((i) => [i.name, i]));
	assert.deepEqual(Object.keys(ix).sort(), ["ix_removal_instructor", "ix_removal_learner", "ix_removal_status", "uq_removal_pending"]);
	assert.deepEqual([ix.uq_removal_pending.cols, ix.uq_removal_pending.unique], [["pending_key"], true]);
	assert.deepEqual(ix.ix_removal_status.cols, ["status", "created_at"]);
	assert.deepEqual(ix.ix_removal_instructor.cols, ["instructor_id", "created_at"]);
	assert.deepEqual(ix.ix_removal_learner.cols, ["learner_id"]);
	assert.ok(["ix_removal_status", "ix_removal_instructor", "ix_removal_learner"].every((n) => !ix[n].unique));
	assert.ok(calls.indexes.every((i) => i.table === "student_removal_requests"));
});

test("the migration is repeatable: running it again after it was applied changes nothing", async () => {
	const m = require(MIGRATION);
	const again = fakeInterface({ exists: true, indexes: ALL_INDEXES });
	await m.up(again.qi, again.Sequelize);
	assert.equal(again.calls.created, null, "no CREATE TABLE");
	assert.deepEqual(again.calls.indexes, [], "no ADD INDEX for an index that already exists");
	assert.equal(again.calls.selects.length, 0, "the parent check is only needed when creating");
	// twice in a row on a fresh database: the second run is a no-op
	const first = fakeInterface();
	await m.up(first.qi, first.Sequelize);
	const created = first.calls.indexes.map((i) => i.name);
	const second = fakeInterface({ exists: true, indexes: ["PRIMARY", ...created] });
	await m.up(second.qi, second.Sequelize);
	assert.deepEqual([second.calls.created, second.calls.indexes], [null, []]);
});

test("after a partial earlier run, only the missing indexes are added (an existing index never makes it fail)", async () => {
	const m = require(MIGRATION);
	const partial = fakeInterface({ exists: true, indexes: ["PRIMARY", "uq_removal_pending", "ix_removal_status"] });
	await m.up(partial.qi, partial.Sequelize);
	assert.equal(partial.calls.created, null);
	assert.deepEqual(partial.calls.indexes.map((i) => i.name).sort(), ["ix_removal_instructor", "ix_removal_learner"]);
	const onlyOne = fakeInterface({ exists: true, indexes: ["PRIMARY"] });
	await m.up(onlyOne.qi, onlyOne.Sequelize);
	assert.deepEqual(onlyOne.calls.indexes.map((i) => i.name).sort(), ["ix_removal_instructor", "ix_removal_learner", "ix_removal_status", "uq_removal_pending"]);
});

test("the index check reads the real SHOW INDEX result shape (Sequelize's own parser returns `name`)", () => {
	const Query = require("sequelize/lib/dialects/mysql/query");
	// rows exactly as MySQL 8 returns them: one row per column, composite indexes repeat the Key_name
	const rows = [
		{ Table: "student_removal_requests", Non_unique: 0, Key_name: "PRIMARY", Seq_in_index: 1, Column_name: "id", Collation: "A", Index_type: "BTREE" },
		{ Table: "student_removal_requests", Non_unique: 0, Key_name: "uq_removal_pending", Seq_in_index: 1, Column_name: "pending_key", Collation: "A", Index_type: "BTREE" },
		{ Table: "student_removal_requests", Non_unique: 1, Key_name: "ix_removal_status", Seq_in_index: 1, Column_name: "status", Collation: "A", Index_type: "BTREE" },
		{ Table: "student_removal_requests", Non_unique: 1, Key_name: "ix_removal_status", Seq_in_index: 2, Column_name: "created_at", Collation: "A", Index_type: "BTREE" },
	];
	const parsed = Query.prototype.handleShowIndexesQuery.call({}, rows);
	assert.deepEqual(parsed.map((i) => i.name), ["PRIMARY", "uq_removal_pending", "ix_removal_status"]);
	assert.equal(parsed.find((i) => i.name === "uq_removal_pending").unique, true);
	assert.deepEqual(parsed.find((i) => i.name === "ix_removal_status").fields.map((f) => f.attribute), ["status", "created_at"]);
});

test("down() drops only student_removal_requests and issues no other statement", async () => {
	const m = require(MIGRATION);
	const down = fakeInterface({ exists: true, indexes: ALL_INDEXES });
	await m.down(down.qi);
	assert.deepEqual(down.calls.dropped, ["student_removal_requests"]);
	assert.equal(down.calls.created, null);
	assert.deepEqual(down.calls.indexes, []);
	assert.equal(down.calls.selects.length, 0);
	const src = read("database/migrations/20261026000000-create-student-removal-requests.js");
	assert.doesNotMatch(src, /removeColumn|changeColumn|addColumn|renameTable|renameColumn|removeIndex|bulkDelete|bulkInsert|truncate|DELETE FROM|UPDATE /i);
	assert.equal((src.match(/dropTable\(/g) || []).length, 1);
	// nothing references the new table, so dropping it cannot cascade into another table
	assert.doesNotMatch(read("database/models/mastery.js") + read("database/models/user.js"), /student_removal_requests/);
});

test("pending_key is set only while pending and cleared by BOTH decisions (what the unique index relies on)", async () => {
	const repo = world();
	const r1 = (await ask(repo, A, ID.L1)).request.id;
	assert.equal(repo.db.requests[0].pending_key, `${ID.instA}:${ID.L1}`);
	await decide(repo, ADMIN, r1, { action: "reject", note: "Please keep this learner." });
	assert.equal(repo.db.requests[0].pending_key, null);
	const r2 = (await ask(repo, A, ID.L1)).request.id;
	assert.equal(repo.db.requests.find((r) => r.id === r2).pending_key, `${ID.instA}:${ID.L1}`);
	await decide(repo, ADMIN, r2, { action: "approve" });
	assert.equal(repo.db.requests.find((r) => r.id === r2).pending_key, null);
	assert.equal(repo.db.requests.filter((r) => r.pending_key).length, 0);
	const svc = read("lib/removals/service.js");
	assert.match(svc, /pending_key: `\$\{actor\.userId\}:\$\{learner\.id\}`/);
	assert.match(svc, /pending_key: null \}\)/);
});

test("every database statement of a decision is inside one transaction and carries it", () => {
	const repo = read("lib/removals/repo.js");
	const tx = repo.slice(repo.indexOf("function txApi(t)"), repo.indexOf("const removalRepo"));
	const modelCalls = tx.split("\n").filter((l) => /(StudentRemovalRequest|ML_Learner|ML_Guardian|ML_AuditLog)\.(create|findByPk|findAll|findOne|update|destroy)\(/.test(l));
	assert.ok(modelCalls.length >= 7, `expected the transaction API to contain its queries, found ${modelCalls.length}`);
	for (const line of modelCalls) assert.match(line, /transaction: t/, `a query inside the transaction does not carry it: ${line.trim()}`);
	// the service performs every write through `tx`, never through `repo`, inside repo.transaction(...)
	const svc = read("lib/removals/service.js");
	const decideFn = svc.slice(svc.indexOf("export async function decide"));
	const block = decideFn.slice(decideFn.indexOf("repo.transaction("), decideFn.indexOf("await notifyDecision"));
	for (const w of ["tx.lockRequest", "tx.deleteInstructorLink", "tx.decide", "tx.audit"]) assert.ok(block.includes(w), w + " must run inside the transaction");
	assert.doesNotMatch(decideFn.slice(0, decideFn.indexOf("repo.transaction(")), /repo\.(delete|update|insert|decide|audit)/);
	assert.doesNotMatch(block, /repo\.(delete|update|insert|decide|audit)/, "no write bypasses the transaction");
	// the audit write comes AFTER the link removal and the status change, so a failing audit rolls both back
	assert.ok(block.indexOf("tx.deleteInstructorLink") < block.indexOf("tx.audit") && block.indexOf("tx.decide") < block.indexOf("tx.audit"));
	assert.match(repo, /transaction: \(fn\) => guard\(\(\) => connection\.transaction\(\(t\) => fn\(txApi\(t\)\)\)\)/); // sequelize rolls back automatically when fn throws
});

test("the Sequelize model matches the migration's columns", () => {
	const model = read("database/models/student_removal.js");
	for (const c of ["id", "instructor_id", "learner_id", "learner_name", "student_user_id", "relation", "reason_code", "comments", "status", "pending_key", "decided_by", "decided_at", "decision_note"]) assert.match(model, new RegExp(`\\b${c}:`), c);
	assert.match(model, /tableName: "student_removal_requests"/);
});

test("the real repo: row lock, guarded status update, single-row link delete, and a clear message before the migration is applied", () => {
	const repo = read("lib/removals/repo.js");
	assert.match(repo, /lock: t\.LOCK\.UPDATE/);
	assert.match(repo, /where: \{ id, status: "pending" \}/);
	assert.match(repo, /where: \{ learner_id: learnerId, user_id: instructorId, relation: "instructor" \}/);
	assert.match(repo, /connection\.transaction/);
	assert.match(repo, /ER_NO_SUCH_TABLE/);
	assert.match(repo, /UniqueConstraintError/);
	// approval never deletes users, learners, enrolments or anything else
	assert.doesNotMatch(repo, /User\.destroy|ML_Learner\.destroy|Enrolment|ML_Attempt|ML_Progress|truncate/);
	assert.equal((repo.match(/\.destroy\(/g) || []).length, 1, "the only delete in the module is the single instructor link");
});

test("every API route authenticates by role first; instructors can create and read but never decide", () => {
	const inst = read("pages/api/instructor/student-removals/index.js");
	assert.match(inst, /requireRole\(req, res, \["instructor"\]\)/);
	assert.doesNotMatch(inst, /PATCH|PUT|DELETE/);
	for (const f of ["pages/api/admin/student-removals/index.js", "pages/api/admin/student-removals/[id].js"]) {
		const src = read(f);
		assert.match(src, /requireRole\(req, res, \["admin"\]\)/, f);
		assert.doesNotMatch(src, /DELETE:/, f);
	}
	const decideRoute = read("pages/api/admin/student-removals/[id].js");
	assert.ok(decideRoute.indexOf("requireRole") < decideRoute.indexOf("decide(removalRepo"));
	// ids always come from the verified actor, never the request
	assert.doesNotMatch(inst, /req\.(query|body)\.(instructor|userId)/);
});

test("the UI: Request Removal in the row menu with a required reason, and the admin tab with filters and decisions", () => {
	const dir = read("components/Instructor/StudentDirectory.js");
	assert.match(dir, /Request Removal/);
	assert.match(dir, /Assign Worksheet/);
	assert.match(dir, /View Details/);
	assert.match(dir, /Pending approval/);
	assert.match(dir, /RemovalRequestsPanel/);
	const dlg = read("components/Instructor/RemovalRequestDialog.js");
	for (const t of ["Submit request", "Reason for removal (required)", "Additional comments (optional)", "confirmDisabled={!valid}"]) assert.ok(dlg.includes(t), t);
	const admin = read("pages/admin/students/removal-requests.js");
	for (const t of ["Pending", "Approved", "Rejected", "View Details", "Approve", "Reject", "Removal requests", "Requesting instructor", "Additional comments", "only", "confirmDisabled={note.trim().length < MIN_TEXT}"]) assert.ok(admin.includes(t), t);
	for (const f of ["pages/admin/students/index.js", "pages/admin/students/site-admins.js"]) assert.match(read(f), /removal-requests/, f);
	assert.match(read("components/Notifications/NotificationList.js"), /student_removal_requested/);
});
