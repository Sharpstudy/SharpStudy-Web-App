// Phase 3: telecaller dashboard, access control, shared visibility, ownership, calls, counts and audit.
// Runs the real service against an in-memory repository (no database, nothing persisted).
import test from "node:test";
import assert from "node:assert/strict";
import { memoryRepo, U, M, profile } from "./memoryRepo.mjs";
import * as svc from "../../lib/followups/service.js";

const NOW = new Date("2026-11-04T10:00:00Z");
const ADMIN = U(1, { role: "admin", first_name: "Ada", last_name: "Admin" });
const T1 = U(2, { first_name: "Tia", last_name: "One" });
const T2 = U(3, { first_name: "Tom", last_name: "Two" });
const T3 = U(4, { first_name: "Tess", last_name: "Inactive" });
const PENDING = U(5); // applied, not approved: no profile
const STUDENT = U(6);
const INSTRUCTOR = U(7, { role: "instructor" });
const CHILD = U(8); // a child's learner login that somehow has a profile
const DISABLED = U(9, { status: false });

function setup(meetings = [M(1), M(2), M(3)]) {
	const repo = memoryRepo({
		users: [ADMIN, T1, T2, T3, PENDING, STUDENT, INSTRUCTOR, CHILD, DISABLED],
		profiles: [profile(T1.id), profile(T2.id), profile(T3.id, { status: "inactive" }), profile(CHILD.id), profile(DISABLED.id)],
		learners: [CHILD.id],
		meetings,
	});
	const audits = [];
	const clock = { now: new Date(NOW) };
	const deps = { repo, now: () => new Date(clock.now), audit: async (action, userId, details) => audits.push({ action, userId, details }) };
	const as = (u) => ({ userId: u.id, role: u.role });
	return { repo, deps, audits, clock, as, m: meetings };
}
const code = async (p) => { try { await p; return "ok"; } catch (e) { return e.code || e.message; } };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const FUTURE = (h) => new Date(NOW.getTime() + h * 3600000).toISOString();
const claimAs = (ctx, u, m = ctx.m[0]) => svc.claimMeeting(ctx.deps, ctx.as(u), m.id);
const callBody = (over = {}) => ({ version: 1, answered: true, outcome: "spoke_to_customer", notes: "Spoke, interested in a demo", ...over });

// ------------------------------------------------------------------ access control

test("an active approved telecaller can open the dashboard, the list and a meeting", async () => {
	const c = setup();
	assert.equal((await svc.getDashboard(c.deps, c.as(T1), {})).access, "telecaller");
	assert.equal((await svc.listMeetings(c.deps, c.as(T1), {})).total, 3);
	assert.equal((await svc.getMeeting(c.deps, c.as(T1), c.m[0].id)).meeting.reference, "MR-0001");
});

test("pending / rejected applicants (no profile), inactive telecallers and ordinary accounts are all refused, on every read and write", async () => {
	const c = setup();
	const calls = (u) => [
		() => svc.getDashboard(c.deps, c.as(u), {}),
		() => svc.listMeetings(c.deps, c.as(u), {}),
		() => svc.getMeeting(c.deps, c.as(u), c.m[0].id),
		() => svc.listTelecallerOptions(c.deps, c.as(u)),
		() => svc.claimMeeting(c.deps, c.as(u), c.m[0].id),
		() => svc.recordCall(c.deps, c.as(u), c.m[0].id, callBody()),
		() => svc.changeStatus(c.deps, c.as(u), c.m[0].id, { version: 0, status: "contacted" }),
		() => svc.transferMeeting(c.deps, c.as(u), c.m[0].id, { version: 0, to_user_id: T2.id, reason: "because" }),
	];
	for (const u of [PENDING, STUDENT, INSTRUCTOR, T3, CHILD]) {
		for (const call of calls(u)) assert.equal(await status(call()), 403, `${u.first_name}${u.id}`);
	}
	assert.equal(await code(svc.getDashboard(c.deps, c.as(PENDING), {})), "telecaller_access_denied");
	assert.equal(await code(svc.getDashboard(c.deps, c.as(T3), {})), "telecaller_inactive");
	assert.equal(c.repo.state.followups.size, 0, "a refused caller changed nothing");
});

test("unauthenticated and disabled accounts get 401", async () => {
	const c = setup();
	assert.equal(await status(svc.getDashboard(c.deps, null, {})), 401);
	assert.equal(await status(svc.getDashboard(c.deps, {}, {})), 401);
	assert.equal(await status(svc.getDashboard(c.deps, c.as(DISABLED), {})), 401);
	assert.equal(await status(svc.getDashboard(c.deps, { userId: "99999999-0000-4000-8000-000000000000" }, {})), 401);
});

test("access is read from the database on every request: deactivating a telecaller takes effect on their next call", async () => {
	const c = setup();
	assert.equal(await code(svc.listMeetings(c.deps, c.as(T1), {})), "ok");
	c.repo.state.profiles.get(T1.id).status = "inactive";
	assert.equal(await status(svc.listMeetings(c.deps, c.as(T1), {})), 403);
	c.repo.state.profiles.get(T1.id).status = "active";
	assert.equal(await code(svc.listMeetings(c.deps, c.as(T1), {})), "ok");
	c.repo.state.users.get(T1.id).status = false; // account disabled
	assert.equal(await status(svc.listMeetings(c.deps, c.as(T1), {})), 401);
});

test("the role claimed by the caller is ignored: a student cannot pass as an admin or telecaller", async () => {
	const c = setup();
	assert.equal(await status(svc.listActivity(c.deps, { userId: STUDENT.id, role: "admin" }, {})), 403);
	assert.equal(await status(svc.adminAssign(c.deps, { userId: T1.id, role: "admin" }, c.m[0].id, { to_user_id: T2.id, reason: "because", version: 0 })), 403);
	assert.equal(await status(svc.getDashboard(c.deps, { userId: STUDENT.id, role: "telecaller" }, {})), 403);
});

test("admins keep access (read) but are not telecallers: personal follow-up actions are refused for them", async () => {
	const c = setup();
	assert.equal((await svc.getDashboard(c.deps, c.as(ADMIN), {})).access, "admin");
	assert.equal((await svc.listMeetings(c.deps, c.as(ADMIN), {})).total, 3);
	assert.equal(await code(svc.claimMeeting(c.deps, c.as(ADMIN), c.m[0].id)), "admin_not_telecaller");
	assert.equal(await code(svc.recordCall(c.deps, c.as(ADMIN), c.m[0].id, callBody({ version: 0 }))), "admin_not_telecaller");
});

test("accessSummary reports access without throwing (page gate / nav helper)", async () => {
	const c = setup();
	assert.deepEqual(await svc.accessSummary(c.deps, T1.id), { allowed: true, mode: "telecaller" });
	assert.equal((await svc.accessSummary(c.deps, ADMIN.id)).mode, "admin");
	assert.equal((await svc.accessSummary(c.deps, STUDENT.id)).allowed, false);
	assert.equal((await svc.accessSummary(c.deps, T3.id)).allowed, false);
});

// ------------------------------------------------------------------ shared visibility + privacy

test("every active telecaller sees ALL meetings and the same customer details", async () => {
	const c = setup();
	await claimAs(c, T1, c.m[0]);
	const a = await svc.listMeetings(c.deps, c.as(T1), {});
	const b = await svc.listMeetings(c.deps, c.as(T2), {});
	assert.equal(a.total, 3);
	assert.deepEqual(a.meetings.map((r) => r.meeting.id), b.meetings.map((r) => r.meeting.id));
	const seen = b.meetings.find((r) => r.meeting.id === c.m[0].id);
	for (const k of ["name", "phone", "email", "purpose", "requested_at", "status", "reference", "message", "organization"]) assert.ok(seen.meeting[k] !== undefined, k);
	assert.equal(seen.followup.owner_name, "Tia One");
	assert.equal(seen.followup.status, "not_contacted");
	// the other telecaller can also read the call history
	await svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: 1 }));
	const detail = await svc.getMeeting(c.deps, c.as(T2), c.m[0].id);
	assert.equal(detail.calls.length, 1);
	assert.equal(detail.calls[0].telecaller_name, "Tia One");
	assert.equal(detail.can.record_call, false, "but cannot act on a follow-up somebody else owns");
});

test("telecaller views never expose admin notes, the manage-link token, processor, e-mail state or anything private", async () => {
	const c = setup();
	await claimAs(c, T1);
	const all = JSON.stringify([await svc.listMeetings(c.deps, c.as(T2), {}), await svc.getMeeting(c.deps, c.as(T2), c.m[0].id), await svc.getDashboard(c.deps, c.as(T2), {})]);
	for (const bad of ["SECRET admin note", "admin_notes", "manage_token", "deadbeef", "processed_by", "admin_email_status", "visitor_email_status", "resume", "internal_note", "form_snapshot", "password_hash"]) {
		assert.ok(!all.includes(bad), `leaked: ${bad}`);
	}
});

test("applicant and resume data are unreachable from the follow-up service", async () => {
	const { readFileSync, readdirSync } = await import("node:fs");
	const dir = new URL("../../lib/followups/", import.meta.url);
	for (const f of readdirSync(dir)) {
		const src = readFileSync(new URL(f, dir), "utf8");
		assert.doesNotMatch(src, /getResumeWithData|listResumes|TelecallerResume|TelecallerApplication\b|findByUser|form_snapshot|resume/i, f);
	}
});

// ------------------------------------------------------------------ claim / concurrency

test("claiming an unowned follow-up creates it once, records who and when, and writes a history event", async () => {
	const c = setup();
	const r = await claimAs(c, T1);
	assert.equal(r.followup.owner_user_id, T1.id);
	assert.equal(r.followup.version, 1);
	assert.equal(r.followup.status, "not_contacted");
	assert.equal(r.followup.owned_at, NOW.toISOString());
	assert.equal(c.repo.state.followups.size, 1);
	const [e] = c.repo.state.events;
	assert.deepEqual([e.event_type, e.actor_user_id, e.actor_name, e.actor_role, e.to_user_id, e.to_name, e.from_user_id], ["take", T1.id, "Tia One", "telecaller", T1.id, "Tia One", null]);
	assert.equal(r.can.record_call, true);
});

test("a second telecaller cannot claim an owned follow-up, and claiming your own again is refused", async () => {
	const c = setup();
	await claimAs(c, T1);
	assert.equal(await code(claimAs(c, T2)), "already_claimed");
	assert.equal(await code(claimAs(c, T1)), "already_yours");
	assert.equal(c.repo.state.followups.get(c.m[0].id).owner_user_id, T1.id);
	assert.equal(c.repo.state.events.length, 1, "refused claims leave no history");
});

test("simultaneous claims: exactly one wins, one follow-up row, one event", async () => {
	const c = setup();
	const results = await Promise.allSettled([claimAs(c, T1), claimAs(c, T2), claimAs(c, T1), claimAs(c, T2)]);
	const won = results.filter((r) => r.status === "fulfilled");
	assert.equal(won.length, 1);
	for (const r of results.filter((x) => x.status === "rejected")) assert.equal(r.reason.status, 409);
	assert.equal(c.repo.state.followups.size, 1);
	assert.equal(c.repo.state.events.filter((e) => e.event_type === "take").length, 1);
	const owner = c.repo.state.followups.get(c.m[0].id).owner_user_id;
	assert.equal(won[0].value.followup.owner_user_id, owner);
});

test("claim with a stale version is refused; an unknown meeting is 404; a closed follow-up cannot be claimed", async () => {
	const c = setup();
	assert.equal(await code(svc.claimMeeting(c.deps, c.as(T1), c.m[0].id, { version: 5 })), "conflict");
	assert.equal(await status(svc.claimMeeting(c.deps, c.as(T1), "11111111-0000-4000-8000-0000000000ff")), 404);
	assert.equal(await status(svc.claimMeeting(c.deps, c.as(T1), "not-a-uuid")), 404);
	await claimAs(c, T1);
	await svc.changeStatus(c.deps, c.as(T1), c.m[0].id, { version: 1, status: "completed", note: "Meeting held, done" });
	await svc.adminClear(c.deps, c.as(ADMIN), c.m[0].id, { version: 2, reason: "Reset for test" });
	assert.equal(await code(claimAs(c, T2)), "closed");
});

// ------------------------------------------------------------------ transfer / admin override

test("only the owner or an admin can transfer; a reason, a version and an active target are required", async () => {
	const c = setup();
	await claimAs(c, T1);
	const base = { version: 1, to_user_id: T2.id, reason: "Going on leave tomorrow" };
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T2), c.m[0].id, base)), "not_owner");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, reason: "" })), "invalid");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, reason: "ab" })), "invalid");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, reason: "   \n  " })), "invalid");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, version: undefined })), "invalid");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, version: 9 })), "conflict");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, to_user_id: T3.id })), "invalid_target", "inactive telecaller");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, to_user_id: STUDENT.id })), "invalid_target");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, to_user_id: ADMIN.id })), "invalid_target");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, to_user_id: CHILD.id })), "invalid_target");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, to_user_id: T1.id })), "same_owner");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { ...base, to_user_id: "x" })), "invalid");
	assert.equal(c.repo.state.followups.get(c.m[0].id).owner_user_id, T1.id, "nothing above changed the owner");
	assert.equal(c.repo.state.events.length, 1);
});

test("a valid transfer moves ownership, bumps the version, records who / from / to / why, and notifies the new owner without customer data", async () => {
	const c = setup();
	await claimAs(c, T1);
	const r = await svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { version: 1, to_user_id: T2.id, reason: "Going on leave tomorrow" });
	assert.equal(r.followup.owner_user_id, T2.id);
	assert.equal(r.followup.version, 2);
	const e = c.repo.state.events.at(-1);
	assert.deepEqual([e.event_type, e.actor_user_id, e.from_user_id, e.from_name, e.to_user_id, e.to_name, e.reason], ["transfer", T1.id, T1.id, "Tia One", T2.id, "Tom Two", "Going on leave tomorrow"]);
	const n = c.repo.state.notifications;
	assert.equal(n.length, 1);
	assert.equal(n[0].user_id, T2.id);
	assert.match(n[0].link, /^\/telecaller\/\?open=/);
	assert.ok(!JSON.stringify(n[0]).includes("customer1@example.test") && !JSON.stringify(n[0]).includes("+1555"), "no customer contact data in a notification");
	assert.equal(await code(svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { version: 2, to_user_id: T3.id, reason: "no longer the owner" })), "not_owner");
});

test("simultaneous transfers of one follow-up with the same version: one wins", async () => {
	const c = setup();
	await claimAs(c, T1);
	const go = (to) => svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { version: 1, to_user_id: to.id, reason: "Handing over now" });
	const res = await Promise.allSettled([go(T2), svc.adminAssign(c.deps, c.as(ADMIN), c.m[0].id, { version: 1, to_user_id: T2.id, reason: "Admin reassigns" })]);
	assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(c.repo.state.followups.get(c.m[0].id).version, 2);
	assert.equal(c.repo.state.events.filter((e) => e.event_type !== "take").length, 1);
});

test("an admin can assign (override) and clear ownership, each needing a reason, and every change is in the history", async () => {
	const c = setup();
	await claimAs(c, T1);
	assert.equal(await code(svc.adminAssign(c.deps, c.as(ADMIN), c.m[0].id, { version: 1, to_user_id: T2.id, reason: "" })), "invalid");
	assert.equal(await code(svc.adminClear(c.deps, c.as(ADMIN), c.m[0].id, { version: 1, reason: "no" })), "invalid");
	const a = await svc.adminAssign(c.deps, c.as(ADMIN), c.m[0].id, { version: 1, to_user_id: T2.id, reason: "Rebalancing the workload" });
	assert.equal(a.followup.owner_user_id, T2.id);
	const cl = await svc.adminClear(c.deps, c.as(ADMIN), c.m[0].id, { version: 2, reason: "Telecaller left the team" });
	assert.equal(cl.followup.owner_user_id, null);
	assert.equal(cl.followup.owner_name, null);
	assert.deepEqual(c.repo.state.events.map((e) => e.event_type), ["take", "admin_assign", "admin_clear"]);
	const [, assign, clear] = c.repo.state.events;
	assert.deepEqual([assign.actor_role, assign.actor_name, assign.from_name, assign.to_name, assign.reason], ["admin", "Ada Admin", "Tia One", "Tom Two", "Rebalancing the workload"]);
	assert.deepEqual([clear.actor_role, clear.from_name, clear.to_user_id, clear.reason], ["admin", "Tom Two", null, "Telecaller left the team"]);
	assert.equal(await code(svc.adminClear(c.deps, c.as(ADMIN), c.m[0].id, { version: 3, reason: "Nothing to clear" })), "no_owner");
	// the previous owner is told when an admin takes the follow-up away
	assert.ok(c.repo.state.notifications.some((n) => n.user_id === T1.id));
	// cleared: another telecaller can claim it again
	assert.equal((await svc.claimMeeting(c.deps, c.as(T2), c.m[0].id)).followup.owner_user_id, T2.id);
});

test("telecallers cannot use the admin operations; an admin using transfer is recorded as an admin assignment", async () => {
	const c = setup();
	await claimAs(c, T1);
	for (const u of [T1, T2, STUDENT]) {
		assert.equal(await status(svc.adminAssign(c.deps, c.as(u), c.m[0].id, { version: 1, to_user_id: T2.id, reason: "I want it" })), 403);
		assert.equal(await status(svc.adminClear(c.deps, c.as(u), c.m[0].id, { version: 1, reason: "I want it" })), 403);
		assert.equal(await status(svc.listActivity(c.deps, c.as(u), {})), 403);
	}
	await svc.transferMeeting(c.deps, c.as(ADMIN), c.m[0].id, { version: 1, to_user_id: T2.id, reason: "Admin handover" });
	assert.equal(c.repo.state.events.at(-1).event_type, "admin_assign");
});

// ------------------------------------------------------------------ calls: append-only + status separation

test("recording calls appends records; earlier call records are never changed", async () => {
	const c = setup();
	await claimAs(c, T1);
	const r1 = await svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: 1, notes: "First call note", outcome: "no_answer", answered: false }));
	const first = structuredClone(c.repo.state.calls[0]);
	c.clock.now = new Date(NOW.getTime() + 3600000);
	const r2 = await svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: r1.followup.version, notes: "Second call note" }));
	assert.equal(c.repo.state.calls.length, 2);
	assert.deepEqual(c.repo.state.calls[0], first, "the first record is byte-for-byte unchanged");
	assert.deepEqual(r2.calls.map((x) => x.notes), ["Second call note", "First call note"], "newest first, both kept");
	assert.equal(r2.followup.version, r1.followup.version + 1);
});

test("the storage layer has no way to edit or delete a call log or an event", async () => {
	const { readFileSync } = await import("node:fs");
	const repoSrc = readFileSync(new URL("../../lib/followups/repo.js", import.meta.url), "utf8");
	assert.doesNotMatch(repoSrc, /MeetingCallLog\.(update|destroy|upsert|bulkCreate)|MeetingFollowupEvent\.(update|destroy|upsert|bulkCreate)/);
	assert.doesNotMatch(repoSrc, /MeetingRequest\.(create|update|destroy|upsert|bulkCreate|increment)/);
	assert.doesNotMatch(repoSrc, /MeetingFollowup\.destroy/);
	assert.doesNotMatch(repoSrc, /\.query\(|sequelize\.literal|literal\(/, "no raw SQL");
	const memo = memoryRepo();
	for (const k of Object.keys(memo)) assert.doesNotMatch(k, /^(update|delete|remove|edit|destroy)/i, k);
});

test("only the owner may record a call or change the status; an unowned follow-up must be claimed first", async () => {
	const c = setup();
	assert.equal(await code(svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: 0 }))), "claim_first");
	assert.equal(await code(svc.changeStatus(c.deps, c.as(T1), c.m[0].id, { version: 0, status: "contacted" })), "claim_first");
	await claimAs(c, T1);
	assert.equal(await code(svc.recordCall(c.deps, c.as(T2), c.m[0].id, callBody())), "not_owner");
	assert.equal(await code(svc.changeStatus(c.deps, c.as(T2), c.m[0].id, { version: 1, status: "contacted" })), "not_owner");
	assert.equal(c.repo.state.calls.length, 0);
});

test("call validation: outcome, answered, note, future / impossible times, next follow-up, status", async () => {
	const c = setup();
	await claimAs(c, T1);
	const bad = async (over, field) => {
		try { await svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody(over)); assert.fail("accepted " + JSON.stringify(over)); } catch (e) { assert.equal(e.status, 422, JSON.stringify(over)); assert.ok(e.fields[field], `${field} in ${JSON.stringify(e.fields)}`); }
	};
	await bad({ outcome: "teleported" }, "outcome");
	await bad({ outcome: undefined }, "outcome");
	await bad({ answered: "yes" }, "answered");
	await bad({ notes: "" }, "notes");
	await bad({ notes: "  \n " }, "notes");
	await bad({ answered: false, outcome: "spoke_to_customer" }, "outcome");
	await bad({ answered: true, outcome: "no_answer" }, "outcome");
	await bad({ called_at: FUTURE(2) }, "called_at");
	await bad({ called_at: "yesterday" }, "called_at");
	await bad({ called_at: "2020-01-01T00:00:00Z" }, "called_at");
	await bad({ next_follow_up_at: FUTURE(-1) }, "next_follow_up_at");
	await bad({ next_follow_up_at: "2026-13-45" }, "next_follow_up_at");
	await bad({ next_follow_up_at: new Date(NOW.getTime() + 400 * 86400000).toISOString() }, "next_follow_up_at");
	await bad({ follow_up_status_after: "bogus" }, "follow_up_status_after");
	await bad({ follow_up_status_after: "completed" }, "follow_up_status_after");
	await bad({ interest: "extreme" }, "interest");
	assert.equal(c.repo.state.calls.length, 0, "no invalid call was stored");
	assert.equal(await code(svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: undefined }))), "invalid");
	assert.equal(await code(svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: 7 }))), "conflict");
});

test("a call sets the next follow-up, the derived status and last contact; no date clears the old reminder", async () => {
	const c = setup();
	await claimAs(c, T1);
	const next = FUTURE(24);
	let r = await svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: 1, next_follow_up_at: next }));
	assert.equal(r.followup.status, "contacted");
	assert.equal(r.followup.next_follow_up_at, next);
	assert.equal(r.followup.last_contacted_at, NOW.toISOString());
	c.clock.now = new Date(NOW.getTime() + 60000); // a later call (history is ordered by call time)
	r = await svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: r.followup.version, follow_up_status_after: "meeting_confirmed", confirmation_details: "Tue 3pm on Zoom" }));
	assert.equal(r.followup.status, "meeting_confirmed");
	assert.equal(r.followup.next_follow_up_at, null);
	assert.equal(r.calls[0].confirmation_details, "Tue 3pm on Zoom");
	assert.deepEqual(c.repo.state.events.filter((e) => e.event_type === "status_change").map((e) => [e.from_status, e.to_status]), [["not_contacted", "contacted"], ["contacted", "meeting_confirmed"]]);
	// an unanswered first call is "unable to reach"
	const d = setup();
	await claimAs(d, T1);
	assert.equal((await svc.recordCall(d.deps, d.as(T1), d.m[0].id, callBody({ answered: false, outcome: "no_answer" }))).followup.status, "unable_to_reach");
});

test("follow-up status is separate from the meeting status, and time passing completes nothing", async () => {
	const c = setup([M(1, { status: "approved", confirmed_start: new Date("2026-11-04T09:00:00Z"), confirmed_end: new Date("2026-11-04T09:30:00Z") }), M(2)]);
	const before = structuredClone([...c.repo.state.meetings.values()]);
	await claimAs(c, T1, c.m[0]);
	await svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: 1 }));
	await svc.changeStatus(c.deps, c.as(T1), c.m[0].id, { version: 2, status: "not_interested" });
	assert.deepEqual([...c.repo.state.meetings.values()], before, "meeting rows are untouched by every follow-up action");
	// meeting 2 is long past its time and was never followed up: still "not contacted", never "completed"
	c.clock.now = new Date("2027-03-01T00:00:00Z");
	const v = await svc.getMeeting(c.deps, c.as(T2), c.m[1].id);
	assert.equal(v.followup.status, "not_contacted");
	assert.equal(v.meeting.status, "pending");
	assert.equal(c.repo.state.followups.has(c.m[1].id), false, "reading never creates follow-up rows");
	// the meeting's confirmed time passed but its status stays what the admin workflow set
	assert.equal((await svc.getMeeting(c.deps, c.as(T2), c.m[0].id)).meeting.status, "approved");
});

test("completing a follow-up is explicit, owner-only and needs a note; reopening clears the completion", async () => {
	const c = setup();
	await claimAs(c, T1);
	assert.equal(await code(svc.changeStatus(c.deps, c.as(T1), c.m[0].id, { version: 1, status: "completed" })), "invalid");
	assert.equal(await code(svc.changeStatus(c.deps, c.as(T1), c.m[0].id, { version: 1, status: "completed", note: "ok" })), "invalid");
	assert.equal(await code(svc.changeStatus(c.deps, c.as(T1), c.m[0].id, { version: 1, status: "weird" })), "invalid");
	let r = await svc.changeStatus(c.deps, c.as(T1), c.m[0].id, { version: 1, status: "completed", note: "Demo delivered and accepted" });
	assert.equal(r.followup.status, "completed");
	assert.equal(r.followup.completed_by_name, "Tia One");
	assert.equal(r.followup.completion_note, "Demo delivered and accepted");
	assert.equal(c.repo.state.events.at(-1).event_type, "completed");
	assert.equal(await code(svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: 2 }))), "closed");
	r = await svc.changeStatus(c.deps, c.as(T1), c.m[0].id, { version: 2, status: "follow_up_required", next_follow_up_at: FUTURE(48) });
	assert.equal(r.followup.completed_at, null);
	assert.equal(r.followup.completion_note, null);
});

test("no telecaller action can change the meeting request: the API exposes only claim / transfer / call / status", async () => {
	const { readFileSync } = await import("node:fs");
	const route = readFileSync(new URL("../../pages/api/telecaller/meetings/[id].js", import.meta.url), "utf8");
	assert.deepEqual([...route.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]), ["claim", "transfer", "call", "status"]);
	for (const verb of ["approve", "reject", "reschedule", "cancel", "update", "PUT", "DELETE", "PATCH"]) assert.doesNotMatch(route, new RegExp(`case "${verb}"|"${verb}"`), verb);
	assert.match(route, /methodNotAllowed\(req, res, \["GET", "POST"\]\)/);
	const svcSrc = readFileSync(new URL("../../lib/followups/service.js", import.meta.url), "utf8");
	assert.doesNotMatch(svcSrc, /meetings\/service|meetings\/repo|updateIfCurrent|setNotes|changeStatus\(deps, repo/, "does not reach the meeting workflow");
	// and an unknown action is refused with 422
	assert.match(route, /invalid_action/);
});

// ------------------------------------------------------------------ dashboard counts, filters, overdue, time zones

function countsWorld() {
	// "now" = 2026-11-04T10:00Z. In Asia/Kolkata (UTC+5:30) the local day is 2026-11-03T18:30Z .. 2026-11-04T18:30Z.
	const ms = Array.from({ length: 12 }, (_, i) => M(i + 1));
	const c = setup(ms);
	const put = (i, f) => c.repo.state.followups.set(ms[i].id, { meeting_request_id: ms[i].id, follow_up_status: "contacted", owner_user_id: null, owned_at: null, last_contacted_at: null, next_follow_up_at: null, completed_at: null, completed_by: null, completion_note: null, version: 1, ...f });
	const t = (iso) => new Date(iso);
	put(0, { owner_user_id: T1.id, next_follow_up_at: t("2026-11-04T09:00:00Z") }); // overdue (mine T1)
	put(1, { owner_user_id: T1.id, next_follow_up_at: t("2026-11-04T12:00:00Z") }); // due today (T1)
	put(2, { owner_user_id: T2.id, next_follow_up_at: t("2026-11-04T18:29:00Z") }); // due today (T2), last minute of the Kolkata day
	put(3, { owner_user_id: T2.id, next_follow_up_at: t("2026-11-04T18:31:00Z") }); // tomorrow in Kolkata: upcoming
	put(4, { owner_user_id: T1.id, follow_up_status: "completed", next_follow_up_at: t("2026-11-01T00:00:00Z") }); // completed: never overdue
	put(5, { owner_user_id: T1.id, follow_up_status: "not_interested", next_follow_up_at: t("2026-11-01T00:00:00Z") }); // closed: never overdue
	put(6, { owner_user_id: null, follow_up_status: "not_contacted" }); // unclaimed (row exists)
	put(7, { owner_user_id: T2.id, next_follow_up_at: t("2026-11-20T00:00:00Z") }); // beyond 7 days: owned, no bucket
	put(8, { owner_user_id: T1.id, next_follow_up_at: t("2026-11-02T00:00:00Z") }); // overdue (T1)
	// meetings 10, 11 (index 9, 10, 11) have no follow-up row: unclaimed
	return c;
}

test("dashboard counts are exact (Asia/Kolkata day), team-wide and per person", async () => {
	const c = countsWorld();
	const d = await svc.getDashboard(c.deps, c.as(T1), { tz: "Asia/Kolkata" });
	assert.equal(d.time_zone, "Asia/Kolkata");
	assert.deepEqual(d.counts, { total: 12, unclaimed: 4, mine: 3, due_today: 2, overdue: 2, upcoming: 1, completed: 1, mine_due_today: 1, mine_overdue: 2, mine_upcoming: 0 });
	const d2 = await svc.getDashboard(c.deps, c.as(T2), { tz: "Asia/Kolkata" });
	assert.deepEqual([d2.counts.mine, d2.counts.mine_due_today, d2.counts.mine_overdue, d2.counts.mine_upcoming], [3, 1, 0, 1]);
	assert.equal(d2.counts.total, d.counts.total, "team-wide figures agree for everyone");
});

test("the list filters return exactly the rows the counts report", async () => {
	const c = countsWorld();
	const q = { tz: "Asia/Kolkata" };
	const ids = async (u, f, extra = {}) => (await svc.listMeetings(c.deps, c.as(u), { filter: f, ...q, ...extra })).meetings.map((r) => r.meeting.reference).sort();
	assert.deepEqual(await ids(T1, "all"), c.m.map((m) => m.reference).sort());
	assert.deepEqual(await ids(T1, "unclaimed"), ["MR-0007", "MR-0010", "MR-0011", "MR-0012"]);
	assert.deepEqual(await ids(T1, "mine"), ["MR-0001", "MR-0002", "MR-0009"]);
	assert.deepEqual(await ids(T1, "overdue"), ["MR-0001", "MR-0009"]);
	assert.deepEqual(await ids(T1, "due_today"), ["MR-0002", "MR-0003"]);
	assert.deepEqual(await ids(T1, "completed"), ["MR-0005"]);
	assert.deepEqual(await ids(T1, "upcoming"), ["MR-0004"]);
	assert.deepEqual(await ids(T1, "overdue", { mine: "1" }), ["MR-0001", "MR-0009"]);
	assert.deepEqual(await ids(T2, "overdue", { mine: "1" }), []);
	assert.deepEqual(await ids(T1, "bogus-filter"), c.m.map((m) => m.reference).sort(), "an unknown filter means all");
	const over = await svc.listMeetings(c.deps, c.as(T1), { filter: "overdue", ...q });
	assert.deepEqual(over.meetings.map((r) => r.meeting.reference), ["MR-0009", "MR-0001"], "overdue is ordered by the oldest due date first");
});

test("'today' follows the viewer's time zone, overdue follows the clock, closed follow-ups are never due", async () => {
	const c = countsWorld();
	// in UTC the local day ends at 24:00Z, so the 18:31Z follow-up is also due today, not upcoming
	const utc = (await svc.getDashboard(c.deps, c.as(T1), { tz: "UTC" })).counts;
	assert.deepEqual([utc.due_today, utc.overdue, utc.upcoming], [3, 2, 0]);
	// an invalid zone falls back to UTC rather than failing
	const bad = await svc.getDashboard(c.deps, c.as(T1), { tz: "Mars/Olympus" });
	assert.equal(bad.time_zone, "UTC");
	// advance the clock: the 12:00Z follow-up becomes overdue
	c.clock.now = new Date("2026-11-04T12:30:00Z");
	const later = (await svc.getDashboard(c.deps, c.as(T1), { tz: "Asia/Kolkata" })).counts;
	assert.deepEqual([later.due_today, later.overdue], [1, 3]);
	// completed / not_interested never appear in any due bucket
	const all = JSON.stringify((await svc.getDashboard(c.deps, c.as(T1), { tz: "UTC" })).reminders);
	assert.ok(!all.includes("MR-0005") && !all.includes("MR-0006"));
});

test("reminders list the caller's own overdue / due today / upcoming follow-ups with exact totals", async () => {
	const c = countsWorld();
	const r = (await svc.getDashboard(c.deps, c.as(T1), { tz: "Asia/Kolkata" })).reminders;
	assert.deepEqual([r.overdue.total, r.due_today.total, r.upcoming.total], [2, 1, 0]);
	assert.deepEqual(r.overdue.items.map((x) => x.meeting.reference), ["MR-0009", "MR-0001"]);
	assert.equal(r.due_today.items[0].meeting.reference, "MR-0002");
	const r2 = (await svc.getDashboard(c.deps, c.as(T2), { tz: "Asia/Kolkata" })).reminders;
	assert.deepEqual([r2.overdue.total, r2.due_today.total, r2.upcoming.total], [0, 1, 1]);
});

test("recent call activity shows real calls, newest first, without call notes", async () => {
	const c = setup();
	await claimAs(c, T1, c.m[0]);
	await claimAs(c, T2, c.m[1]);
	await svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ called_at: new Date(NOW.getTime() - 7200000).toISOString(), notes: "PRIVATE-NOTE-A" }));
	await svc.recordCall(c.deps, c.as(T2), c.m[1].id, callBody({ called_at: new Date(NOW.getTime() - 3600000).toISOString(), notes: "PRIVATE-NOTE-B" }));
	const d = await svc.getDashboard(c.deps, c.as(T1), {});
	assert.deepEqual(d.recent_calls.map((x) => x.telecaller_name), ["Tom Two", "Tia One"]);
	assert.ok(!JSON.stringify(d.recent_calls).includes("PRIVATE-NOTE"));
	assert.equal((await svc.getDashboard(setup().deps, setup().as(T1), {})).recent_calls.length, 0, "no calls -> no invented activity");
});

test("search narrows the shared list by name, phone, email or reference", async () => {
	const c = setup([M(1, { name: "Zed Zebra" }), M(2), M(3)]);
	const by = async (q) => (await svc.listMeetings(c.deps, c.as(T1), { q })).meetings.map((r) => r.meeting.reference);
	assert.deepEqual(await by("zebra"), ["MR-0001"]);
	assert.deepEqual(await by("MR-0003"), ["MR-0003"]);
	assert.deepEqual(await by("customer2@"), ["MR-0002"]);
	assert.deepEqual(await by("nobody"), []);
});

// ------------------------------------------------------------------ admin activity feed + audit

async function activityWorld() {
	const c = setup();
	await claimAs(c, T1, c.m[0]);
	await svc.recordCall(c.deps, c.as(T1), c.m[0].id, callBody({ version: 1, called_at: "2026-11-03T08:00:00Z", notes: "Call on the 3rd" }));
	c.clock.now = new Date("2026-11-04T11:00:00Z");
	await svc.transferMeeting(c.deps, c.as(T1), c.m[0].id, { version: 2, to_user_id: T2.id, reason: "Leaving early today" });
	await claimAs(c, T2, c.m[1]);
	await svc.recordCall(c.deps, c.as(T2), c.m[1].id, callBody({ version: 1, called_at: "2026-11-04T10:30:00Z", answered: false, outcome: "voicemail_left", notes: "Left a voicemail" }));
	return c;
}

test("admin feed merges calls and ownership events newest first and filters by telecaller, meeting, date, status and type", async () => {
	const c = await activityWorld();
	const feed = (q) => svc.listActivity(c.deps, c.as(ADMIN), { tz: "UTC", ...q });
	const all = await feed({});
	assert.equal(all.total, 7); // 2 calls + 5 events (take, status change, transfer, take, status change)
	assert.deepEqual(all.items.map((i) => i.at), [...all.items.map((i) => i.at)].sort().reverse(), "newest first");
	assert.ok(all.items.some((i) => i.kind === "call") && all.items.some((i) => i.kind === "event"));
	const byTia = await feed({ telecaller: T1.id });
	assert.equal(byTia.total, 4, "Tia: her 1 call + the 3 events she acted in (claim, status change, transfer)");
	assert.ok(!byTia.items.some((i) => i.kind === "call" && i.who_user_id === T2.id));
	const m2 = await feed({ meeting: "MR-0002" });
	assert.ok(m2.items.length > 0 && m2.items.every((i) => i.meeting_reference === "MR-0002"));
	assert.equal((await feed({ meeting: "MR-9999" })).total, 0);
	assert.equal((await feed({ meeting: c.m[1].id })).items.every((i) => i.meeting_id === c.m[1].id), true);
	const day3 = await feed({ from: "2026-11-03", to: "2026-11-03" });
	assert.deepEqual(day3.items.map((i) => i.kind), ["call"]);
	assert.equal((await feed({ type: "calls" })).items.every((i) => i.kind === "call"), true);
	assert.equal((await feed({ type: "ownership" })).items.every((i) => i.kind === "event"), true);
	assert.ok((await feed({ status: "unable_to_reach" })).items.every((i) => i.meeting_id === c.m[1].id), "current follow-up status of the meeting");
	assert.equal(await status(feed({ telecaller: "not-a-user" })), 422);
	// pagination keeps every item exactly once
	const p1 = await feed({ page: 1 });
	assert.equal(p1.pageSize, svc.PAGE_SIZE);
	assert.equal(new Set(all.items.map((i) => i.id)).size, all.items.length);
});

test("the audit trail records who did what, when and why; the audit log gets one entry per change", async () => {
	const c = await activityWorld();
	const ev = c.repo.state.events;
	for (const e of ev) {
		assert.ok(e.id && e.actor_user_id && e.actor_name && e.actor_role && e.created_at, "every event says who and when");
		if (["transfer", "admin_assign", "admin_clear"].includes(e.event_type)) assert.ok(e.reason && e.reason.length >= 5, "ownership changes always carry a reason");
	}
	assert.deepEqual(c.audits.map((a) => a.action), ["meeting_followup.take", "meeting_followup.call", "meeting_followup.transfer", "meeting_followup.take", "meeting_followup.call"]);
	assert.ok(c.audits.every((a) => a.userId && a.details.meetingId));
	// history rows are exactly what happened: nothing was rewritten by later steps
	const before = structuredClone(ev);
	await svc.adminClear(c.deps, c.as(ADMIN), c.m[0].id, { version: 3, reason: "Audit check clear" });
	assert.deepEqual(c.repo.state.events.slice(0, before.length), before);
	assert.equal(c.repo.state.events.length, before.length + 1);
	// an audit-log failure never undoes the change
	c.deps.audit = async () => { throw new Error("audit down"); };
	await svc.adminAssign(c.deps, c.as(ADMIN), c.m[0].id, { version: 4, to_user_id: T2.id, reason: "Audit failure check" });
	assert.equal(c.repo.state.followups.get(c.m[0].id).owner_user_id, T2.id);
});

test("telecaller picker lists active and inactive telecallers by name only", async () => {
	const c = setup();
	const list = await svc.listTelecallerOptions(c.deps, c.as(T1));
	assert.deepEqual(Object.keys(list[0]).sort(), ["name", "status", "user_id"]);
	assert.ok(list.some((t) => t.user_id === T3.id && t.status === "inactive"));
});
