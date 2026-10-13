import { beforeAll, describe, expect, it } from "vitest";
import { api, call, makeFamily, makeUser, pairDevice, publishActivity, reauthToken } from "./helpers";
import { findParentOnlyKeys } from "@/learn-together/domain/projection";
import {
  AuditLog,
  ChildDevice,
  ChildDeviceProfile,
  ChildProfile,
  ChildResponse,
  ConceptProgress,
  Observation,
  PairingRequest,
  Session,
} from "@/learn-together/server/models";

beforeAll(async () => {
  await publishActivity("snack-budget");
  await publishActivity("paper-shape-coin-lab");
});

describe("feature flag", () => {
  it("returns 404 from every route type when off", async () => {
    const { user } = await makeFamily();
    process.env.FEATURE_LEARN_TOGETHER = "false";
    try {
      expect((await call(await api.me(), { token: user.token })).status).toBe(404);
      expect((await call(await api.kidMe())).status).toBe(404);
      expect((await call(await api.adminActivities(), { token: user.token })).status).toBe(404);
    } finally {
      process.env.FEATURE_LEARN_TOGETHER = "true";
    }
  });
});

describe("parent auth and family scoping", () => {
  it("requires a signed-in parent", async () => {
    expect((await call(await api.me())).status).toBe(401);
    expect((await call(await api.me(), { token: "garbage" })).status).toBe(401);
  });

  it("asks for a family before family endpoints", async () => {
    const u = await makeUser();
    const r = await call(await api.children(), { token: u.token });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("no_family");
  });

  it("child model has no birth date, full name or contact fields, and rejects contact-like nicknames", async () => {
    const attrs = Object.keys(ChildProfile.getAttributes());
    for (const banned of ["birthDate", "dob", "fullName", "lastName", "email", "phone", "address", "location"]) expect(attrs).not.toContain(banned);
    const { user } = await makeFamily([]);
    const r = await call(await api.children(), { method: "POST", token: user.token, body: { nickname: "maya@example.com", avatarKey: "fox", ageBand: "7-8" } });
    expect(r.status).toBe(422);
  });

  it("family A can never read or change family B's data", async () => {
    const a = await makeFamily(["Ann"]);
    const b = await makeFamily(["Bob"]);
    const bChild = b.children[0].id;
    const t = a.user.token;
    expect((await call(await api.child(), { method: "PATCH", token: t, query: { id: bChild }, body: { nickname: "x" } })).status).toBe(404);
    expect((await call(await api.progress(), { token: t, query: { id: bChild } })).status).toBe(404);
    expect((await call(await api.exportChild(), { token: t, query: { id: bChild } })).status).toBe(404);
    expect((await call(await api.concepts(), { method: "PUT", token: t, query: { id: bChild }, body: { conceptTag: "money", status: "confident" } })).status).toBe(404);
    expect((await call(await api.pairing(), { method: "POST", token: t, body: { childProfileIds: [bChild] } })).status).toBe(404);
    expect((await call(await api.groups(), { method: "POST", token: t, body: { activitySlug: "snack-budget", childProfileIds: [bChild], mode: "single_device" } })).status).toBe(404);

    // B's group and device are invisible to A.
    const g = await call(await api.groups(), { method: "POST", token: b.user.token, body: { activitySlug: "snack-budget", childProfileIds: [bChild], mode: "single_device" } });
    expect((await call(await api.group(), { token: t, query: { id: g.body.groupId } })).status).toBe(404);
    expect((await call(await api.groupOp(), { method: "POST", token: t, query: { id: g.body.groupId, op: "action" }, body: { type: "start" } })).status).toBe(404);
    const dev = await pairDevice(b.user.token, [bChild]);
    expect((await call(await api.device(), { method: "DELETE", token: t, query: { id: dev.deviceId } })).status).toBe(404);
    expect((await call(await api.devices(), { token: t })).body.devices).toEqual([]);
    // Export contains only A's data.
    const ex = await call(await api.privacyExport(), { token: t });
    expect(JSON.stringify(ex.body)).not.toContain("Bob");
    expect(ex.body.children.map((c: any) => c.child.nickname)).toEqual(["Ann"]);
  });
});

describe("device pairing", () => {
  it("pairs by typed code, only after approval, and logs every step", async () => {
    const { user, children } = await makeFamily();
    const start = await call(await api.pairing(), { method: "POST", token: user.token, body: { childProfileIds: [children[0].id] } });
    expect(start.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const claim = await call(await api.kidClaim(), { method: "POST", body: { code: start.body.code.slice(0, 3) + "-" + start.body.code.slice(3) } });
    expect(claim.status).toBe(200);
    // Unapproved: no device cookie, no access.
    const waiting = await call(await api.kidStatus(), { cookies: { lt_claim: claim.cookies.lt_claim } });
    expect(waiting.body.status).toBe("waiting_for_approval");
    expect(waiting.cookies.lt_device).toBeUndefined();
    expect((await call(await api.kidMe(), { cookies: { lt_claim: claim.cookies.lt_claim } })).status).toBe(401);
    // The parent sees the request.
    const pending = await call(await api.pairing(), { token: user.token });
    expect(pending.body.pending[0].children[0].nickname).toBe("Maya");
    // Approve → device credential delivered once, as an httpOnly SameSite=Strict cookie.
    await call(await api.pairingOne(), { method: "POST", token: user.token, query: { id: start.body.requestId }, body: { decision: "approve", label: "Maya's iPad" } });
    const done = await call(await api.kidStatus(), { cookies: { lt_claim: claim.cookies.lt_claim } });
    expect(done.body.status).toBe("paired");
    const setCookie = (done.headers["set-cookie"] as string[]).find((c) => c.startsWith("lt_device="))!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    const again = await call(await api.kidStatus(), { cookies: { lt_claim: claim.cookies.lt_claim } });
    expect(again.cookies.lt_device || "").toBe("");
    // The raw token is never stored.
    const dev = await ChildDevice.findOne({ where: { familyId: (await ChildProfile.findByPk(children[0].id))!.familyId } });
    expect(dev!.deviceTokenHash).toHaveLength(64);
    expect(dev!.deviceTokenHash).not.toBe(done.cookies.lt_device);
    const me = await call(await api.kidMe(), { cookies: { lt_device: done.cookies.lt_device } });
    expect(me.status).toBe(200);
    expect(me.body.children.map((c: any) => c.nickname)).toEqual(["Maya"]);
    const actions = (await AuditLog.findAll({ where: { entityId: [start.body.requestId, dev!.id] } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["pairing.started", "pairing.claimed", "pairing.approved", "pairing.delivered"]));
  });

  it("codes are single use and expire", async () => {
    const { user, children } = await makeFamily();
    const start = await call(await api.pairing(), { method: "POST", token: user.token, body: { childProfileIds: [children[0].id] } });
    expect((await call(await api.kidClaim(), { method: "POST", body: { code: start.body.code } })).status).toBe(200);
    expect((await call(await api.kidClaim(), { method: "POST", body: { code: start.body.code }, headers: { "x-forwarded-for": "10.0.0.2" } })).status).toBe(404);
    const second = await call(await api.pairing(), { method: "POST", token: user.token, body: { childProfileIds: [children[0].id] } });
    await PairingRequest.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: second.body.requestId } });
    expect((await call(await api.kidClaim(), { method: "POST", body: { code: second.body.code }, headers: { "x-forwarded-for": "10.0.0.3" } })).status).toBe(404);
  });

  it("denial gives no access", async () => {
    const { user, children } = await makeFamily();
    const start = await call(await api.pairing(), { method: "POST", token: user.token, body: { childProfileIds: [children[0].id] } });
    const claim = await call(await api.kidClaim(), { method: "POST", body: { code: start.body.code }, headers: { "x-forwarded-for": "10.0.0.4" } });
    await call(await api.pairingOne(), { method: "POST", token: user.token, query: { id: start.body.requestId }, body: { decision: "deny" } });
    const s = await call(await api.kidStatus(), { cookies: { lt_claim: claim.cookies.lt_claim } });
    expect(s.body.status).toBe("denied");
    expect(s.cookies.lt_device).toBeUndefined();
  });

  it("locks a client out after 5 wrong codes", async () => {
    const headers = { "x-forwarded-for": "10.9.9.9" };
    for (let i = 0; i < 5; i++) expect((await call(await api.kidClaim(), { method: "POST", body: { code: "ZZZZZZ" }, headers })).status).toBe(404);
    expect((await call(await api.kidClaim(), { method: "POST", body: { code: "ZZZZZZ" }, headers })).status).toBe(429);
  });

  it("blocks cross-site claim attempts", async () => {
    const r = await call(await api.kidClaim(), { method: "POST", body: { code: "ABCDEF" }, headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });

  it("revocation takes effect on the next request", async () => {
    const { user, children } = await makeFamily();
    const dev = await pairDevice(user.token, [children[0].id]);
    expect((await call(await api.kidMe(), { cookies: dev.cookies })).status).toBe(200);
    await call(await api.device(), { method: "DELETE", token: user.token, query: { id: dev.deviceId } });
    const r = await call(await api.kidMe(), { cookies: dev.cookies });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("device_unpaired");
  });

  it("expires devices after the inactivity window", async () => {
    const { user, children } = await makeFamily();
    const dev = await pairDevice(user.token, [children[0].id]);
    await ChildDevice.update({ lastSeenAt: new Date(Date.now() - 91 * 86400000) }, { where: { id: dev.deviceId } });
    expect((await call(await api.kidMe(), { cookies: dev.cookies })).status).toBe(401);
  });

  it("leaving or unpairing on the device needs the family PIN", async () => {
    const { user, children } = await makeFamily();
    const dev = await pairDevice(user.token, [children[0].id]);
    expect((await call(await api.kidExit(), { method: "POST", cookies: dev.cookies, body: { pin: "0000", action: "unpair" } })).status).toBe(401);
    expect((await call(await api.kidMe(), { cookies: dev.cookies })).status).toBe(200);
    expect((await call(await api.kidExit(), { method: "POST", cookies: dev.cookies, body: { pin: "1234", action: "unpair" } })).status).toBe(200);
    expect((await call(await api.kidMe(), { cookies: dev.cookies })).status).toBe(401);
  });
});

describe("child-device scope", () => {
  it("cannot call parent endpoints, other families' groups, or unpaired siblings' data", async () => {
    const fam = await makeFamily(["Maya", "Leo"]);
    const [maya, leo] = fam.children;
    const dev = await pairDevice(fam.user.token, [maya.id]);
    // Device cookie is not a parent credential.
    for (const h of [api.me, api.children, api.home, api.devices, api.pairing]) expect((await call(await h(), { cookies: dev.cookies })).status).toBe(401);
    expect((await call(await api.progress(), { cookies: dev.cookies, query: { id: maya.id } })).status).toBe(401);

    // A group for Leo only is invisible to Maya's device.
    const leoGroup = await call(await api.groups(), { method: "POST", token: fam.user.token, body: { activitySlug: "snack-budget", childProfileIds: [leo.id], mode: "connected" } });
    expect((await call(await api.kidGroup(), { cookies: dev.cookies, query: { id: leoGroup.body.groupId } })).status).toBe(404);
    expect((await call(await api.kidGroupOp(), { method: "POST", cookies: dev.cookies, query: { id: leoGroup.body.groupId, op: "ready" }, body: { childProfileId: leo.id } })).status).toBe(404);

    // Another family's group is invisible too.
    const other = await makeFamily(["Zed"]);
    const og = await call(await api.groups(), { method: "POST", token: other.user.token, body: { activitySlug: "snack-budget", childProfileIds: [other.children[0].id], mode: "single_device" } });
    expect((await call(await api.kidGroup(), { cookies: dev.cookies, query: { id: og.body.groupId } })).status).toBe(404);
    // Selecting a child not paired to this device fails.
    expect((await call(await api.kidSelect(), { method: "POST", cookies: dev.cookies, body: { childProfileId: leo.id } })).status).toBe(404);
  });
});

describe("connected session end to end", () => {
  it("launch → ready → steps → answers → help → reflect → progress", async () => {
    const fam = await makeFamily(["Maya"]);
    const maya = fam.children[0];
    const dev = await pairDevice(fam.user.token, [maya.id]);
    const t = fam.user.token;

    const launch = await call(await api.groups(), { method: "POST", token: t, body: { activitySlug: "snack-budget", childProfileIds: [maya.id], mode: "connected" } });
    expect(launch.status).toBe(200);
    const id = launch.body.groupId;

    // The child's lobby sees the launched group.
    const lobby = await call(await api.kidMe(), { cookies: dev.cookies });
    expect(lobby.body.groups.map((g: any) => g.groupId)).toContain(id);

    const kid = async (op: string, body: unknown) => call(await api.kidGroupOp(), { method: "POST", cookies: dev.cookies, query: { id, op }, body });
    const parentOp = async (op: string, body: unknown) => call(await api.groupOp(), { method: "POST", token: t, query: { id, op }, body });

    expect((await kid("join", { childProfileId: maya.id })).status).toBe(200);
    expect((await kid("ready", { childProfileId: maya.id })).status).toBe(200);
    let ps = await call(await api.group(), { token: t, query: { id } });
    expect(ps.body.children[0]).toMatchObject({ ready: true, joined: true, presence: "online" });

    // Child state is the projection only, asserted at the API level.
    const cs = await call(await api.kidGroup(), { cookies: dev.cookies, query: { id } });
    expect(findParentOnlyKeys(cs.body)).toEqual([]);
    expect(JSON.stringify(cs.body)).not.toContain("parentSays");
    expect(JSON.stringify(cs.body)).not.toMatch(/"correctKey"|"expected"/);

    await parentOp("action", { type: "start" });
    // Answering a step that isn't on screen is rejected.
    expect((await kid("respond", { childProfileId: maya.id, itemKey: "step:first_pick", value: 9 })).status).toBe(409);
    await parentOp("action", { type: "goto", index: 2 });
    expect((await kid("respond", { childProfileId: maya.id, itemKey: "step:first_pick", value: 7 })).status).toBe(200);
    expect((await kid("respond", { childProfileId: maya.id, itemKey: "step:first_pick", value: 9 })).status).toBe(200);
    // Free text is rejected.
    expect((await kid("respond", { childProfileId: maya.id, itemKey: "step:first_pick", value: "my mum spends a lot" })).status).toBe(422);

    // Help signal reaches the parent and can be acknowledged.
    await kid("help", { childProfileId: maya.id });
    ps = await call(await api.group(), { token: t, query: { id } });
    const help = ps.body.children[0].help[0];
    expect(help.acknowledgedAt).toBeNull();
    await parentOp("help-ack", { helpId: help.id });
    expect((await call(await api.kidGroup(), { cookies: dev.cookies, query: { id } })).body.children[0].helpPending).toBe(false);

    // Check phase: child answers check questions, parent records interpretation.
    await parentOp("action", { type: "goto", index: 5 });
    expect((await kid("respond", { childProfileId: maya.id, itemKey: "check:transfer", value: 6 })).status).toBe(200);
    await parentOp("check", { childProfileId: maya.id, questionKey: "near", interpretation: "clear" });
    await parentOp("check", { childProfileId: maya.id, questionKey: "transfer", interpretation: "clear" });
    await parentOp("misconception", { childProfileId: maya.id, misconceptionKey: "counts_items", stepId: "first_pick" });
    await parentOp("action", { type: "next" });
    await parentOp("reflect", { childProfileId: maya.id, outcome: "understood", parentNote: "Used make-ten!", confidence: 4 });
    const seqBefore = ps.body.seq;
    await parentOp("action", { type: "end" });

    ps = await call(await api.group(), { token: t, query: { id } });
    expect(ps.body.state).toBe("ended");
    expect(ps.body.seq).toBeGreaterThan(seqBefore);
    expect(ps.body.children[0].sessionStatus).toBe("completed");
    expect(ps.body.children[0].responses.map((r: any) => r.isCorrect)).toEqual([false, true, true]);
    expect(ps.body.recommendations[maya.id].length).toBeGreaterThan(0);

    // Progress recomputed on completion.
    const rows = await ConceptProgress.findAll({ where: { childProfileId: maya.id } });
    expect(rows.map((r) => r.status)).toEqual(["introduced", "introduced", "introduced"]);
    const prog = await call(await api.progress(), { token: t, query: { id: maya.id } });
    expect(prog.body.thisWeek.sessionsCompleted).toBe(1);
    expect(prog.body.childAnswers[0].items[0].attempts).toEqual(["7 dollars", "9 dollars"]);
    expect(prog.body.misconceptions[0].signal).toMatch(/three snacks/);
    expect(JSON.stringify(prog.body)).not.toMatch(/percent|score|grade|rank|streak/i);

    // Journey on the child device: concepts, no numbers.
    const me = await call(await api.kidMe(), { cookies: dev.cookies });
    expect(me.body.children[0].journey.length).toBe(3);
    expect(Object.keys(me.body.children[0].journey[0]).sort()).toEqual(["conceptTag", "exploredAgain", "isNew"]);
  });

  it("second session on another day with clear transfer → confident; observation edit/delete updates status", async () => {
    const fam = await makeFamily(["Kai"]);
    const kai = fam.children[0];
    const t = fam.user.token;
    const run = async (outcome: string) => {
      const g = await call(await api.groups(), { method: "POST", token: t, body: { activitySlug: "snack-budget", childProfileIds: [kai.id], mode: "single_device" } });
      const id = g.body.groupId;
      const op = async (o: string, body: unknown) => call(await api.groupOp(), { method: "POST", token: t, query: { id, op: o }, body });
      await op("action", { type: "start" });
      await op("action", { type: "goto", index: 6 });
      await op("check", { childProfileId: kai.id, questionKey: "transfer", interpretation: "clear" });
      await op("reflect", { childProfileId: kai.id, outcome });
      await op("action", { type: "end" });
      return id;
    };
    await run("understood");
    await Session.update({ completedAt: new Date(Date.now() - 3 * 86400000) }, { where: { childProfileId: kai.id } });
    await run("understood");
    const money = async () => (await ConceptProgress.findOne({ where: { childProfileId: kai.id, conceptTag: "money" } }))!.status;
    expect(await money()).toBe("confident");

    // Edit the latest observation to practice_again → back to practicing.
    const latest = (await Observation.findAll({ where: { childProfileId: kai.id }, order: [["created_at", "DESC"]] }))[0];
    await call(await api.observation(), { method: "PATCH", token: t, query: { id: latest.id }, body: { outcome: "practice_again" } });
    expect(await money()).toBe("practicing");
    // Delete it → most recent session has no "understood" → practicing.
    await call(await api.observation(), { method: "DELETE", token: t, query: { id: latest.id } });
    expect(await money()).toBe("practicing");

    // Parent override is labelled and audited, and survives recompute.
    await call(await api.concepts(), { method: "PUT", token: t, query: { id: kai.id }, body: { conceptTag: "money", status: "confident" } });
    const row = await ConceptProgress.findOne({ where: { childProfileId: kai.id, conceptTag: "money" } });
    expect(row!.statusSource).toBe("parent_override");
    expect(await AuditLog.count({ where: { action: "progress.override" } })).toBeGreaterThan(0);
  });

  it("multi-child launch makes one session per child; ending early abandons", async () => {
    const fam = await makeFamily(["A1", "B1"]);
    const g = await call(await api.groups(), { method: "POST", token: fam.user.token, body: { activitySlug: "paper-shape-coin-lab", childProfileIds: fam.children.map((c) => c.id), mode: "single_device" } });
    const sessions = await Session.findAll({ where: { groupId: g.body.groupId } });
    expect(sessions.length).toBe(2);
    await call(await api.groupOp(), { method: "POST", token: fam.user.token, query: { id: g.body.groupId, op: "action" }, body: { type: "start" } });
    await call(await api.groupOp(), { method: "POST", token: fam.user.token, query: { id: g.body.groupId, op: "action" }, body: { type: "end" } });
    expect((await Session.findAll({ where: { groupId: g.body.groupId } })).map((s) => s.status)).toEqual(["abandoned", "abandoned"]);
  });

  it("single-device mode lets the child answer on the parent's device", async () => {
    const fam = await makeFamily(["Solo"]);
    const id = (await call(await api.groups(), { method: "POST", token: fam.user.token, body: { activitySlug: "snack-budget", childProfileIds: [fam.children[0].id], mode: "single_device" } })).body.groupId;
    const op = async (o: string, body: unknown) => call(await api.groupOp(), { method: "POST", token: fam.user.token, query: { id, op: o }, body });
    await op("action", { type: "start" });
    await op("action", { type: "goto", index: 2 });
    const r = await op("respond", { childProfileId: fam.children[0].id, itemKey: "step:first_pick", value: 9 });
    expect(r.status).toBe(200);
    expect((await ChildResponse.findAll({ where: { childProfileId: fam.children[0].id } }))[0].childDeviceId).toBeNull();
  });
});

describe("content publishing", () => {
  it("blocks publish without approvals, stops self-review, and requires safety for science", async () => {
    const { RoleAssignment } = await import("@/learn-together/server/models");
    const ed = await makeUser();
    const rev = await makeUser();
    await RoleAssignment.create({ userId: ed.id, role: "lt_editor" });
    await RoleAssignment.create({ userId: rev.id, role: "lt_reviewer" });
    // Plain users can't reach admin.
    const nobody = await makeUser();
    expect((await call(await api.adminActivities(), { token: nobody.token })).status).toBe(403);

    const content = (await import("./content")).raw("weather-watchers");
    const saved = await call(await api.adminActivities(), { method: "POST", token: ed.token, body: { content } });
    const { activityId, versionId } = saved.body;
    const op = async (token: string, body: unknown) => call(await api.adminActivity(), { method: "POST", token, query: { id: activityId }, body });

    expect((await op(ed.token, { op: "publish", versionId })).status).toBe(409);
    await op(ed.token, { op: "request_reviews", versionId });
    // Editors can't record reviews; a reviewer can't approve their own draft.
    expect((await op(ed.token, { op: "review", versionId, reviewType: "subject", decision: "approved" })).status).toBe(403);
    for (const t of ["subject", "developmental", "accessibility", "editorial"]) await op(rev.token, { op: "review", versionId, reviewType: t, decision: "approved" });
    const blocked = await op(ed.token, { op: "publish", versionId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/safety/);
    await op(rev.token, { op: "review", versionId, reviewType: "safety", decision: "approved" });
    expect((await op(ed.token, { op: "publish", versionId })).status).toBe(200);

    const selfAuthored = await call(await api.adminActivities(), { method: "POST", token: rev.token, body: { content: { ...content, title: "Weather Watchers 2" } } });
    expect(selfAuthored.status).toBe(403); // reviewer-only role can't author

    // Someone holding both roles still can't approve their own draft.
    const both = await makeUser();
    await RoleAssignment.create({ userId: both.id, role: "lt_editor" });
    await RoleAssignment.create({ userId: both.id, role: "lt_reviewer" });
    const own = await call(await api.adminActivities(), { method: "POST", token: both.token, body: { content: (await import("./content")).raw("shape-hunt") } });
    const ownOp = async (body: unknown) => call(await api.adminActivity(), { method: "POST", token: both.token, query: { id: own.body.activityId }, body });
    await ownOp({ op: "request_reviews", versionId: own.body.versionId });
    const selfReview = await ownOp({ op: "review", versionId: own.body.versionId, reviewType: "subject", decision: "approved" });
    expect(selfReview.status).toBe(403);
    expect(selfReview.body.message).toMatch(/own draft/);
  });

  it("rejects invalid content at save time", async () => {
    const { RoleAssignment } = await import("@/learn-together/server/models");
    const ed = await makeUser();
    await RoleAssignment.create({ userId: ed.id, role: "lt_editor" });
    const content = (await import("./content")).raw("sink-or-float");
    delete content.safety;
    const r = await call(await api.adminActivities(), { method: "POST", token: ed.token, body: { content } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body.errors)).toMatch(/safety/);
  });

  it("rollback restores the previous version immediately for new launches", async () => {
    const v1 = await publishActivity("make-ten-cards");
    const v2 = await publishActivity("make-ten-cards", (c) => (c.title = "Make Ten v2"));
    const fam = await makeFamily(["R"]);
    const launchTitle = async () => {
      const g = await call(await api.groups(), { method: "POST", token: fam.user.token, body: { activitySlug: "make-ten-cards", childProfileIds: [fam.children[0].id], mode: "single_device" } });
      return (await call(await api.group(), { token: fam.user.token, query: { id: g.body.groupId } })).body.content.title;
    };
    expect(await launchTitle()).toBe("Make Ten v2");
    const admin = await makeUser({ role: "admin" });
    const auditBefore = await AuditLog.count({ where: { action: "content.rolled_back", entityId: v2.activityId } });
    const rb = await call(await api.adminActivity(), { method: "POST", token: admin.token, query: { id: v2.activityId }, body: { op: "rollback", versionId: v1.versionId } });
    expect(rb.status).toBe(200);
    expect(await launchTitle()).toBe("Make Ten Card Game");
    expect(await AuditLog.count({ where: { action: "content.rolled_back", entityId: v2.activityId } })).toBe(auditBefore + 1);
  });

  it("parents only ever see published versions", async () => {
    const fam = await makeFamily(["P"]);
    const list = await call(await api.activities(), { token: fam.user.token });
    const slugs = list.body.activities.map((a: any) => a.slug);
    expect(slugs).toContain("snack-budget");
    expect(slugs).not.toContain("shape-hunt"); // seeded as draft only
    expect((await call(await api.activity(), { token: fam.user.token, query: { slug: "shape-hunt" } })).status).toBe(404);
  });
});

describe("privacy", () => {
  it("deleting a child removes all their rows and unpairs devices only they used", async () => {
    const fam = await makeFamily(["Del", "Keep"]);
    const [del, keep] = fam.children;
    const solo = await pairDevice(fam.user.token, [del.id], "Del's tablet");
    const shared = await pairDevice(fam.user.token, [del.id, keep.id], "Shared");
    const id = (await call(await api.groups(), { method: "POST", token: fam.user.token, body: { activitySlug: "snack-budget", childProfileIds: [del.id], mode: "connected" } })).body.groupId;
    await call(await api.groupOp(), { method: "POST", token: fam.user.token, query: { id, op: "action" }, body: { type: "start" } });
    await call(await api.groupOp(), { method: "POST", token: fam.user.token, query: { id, op: "reflect" }, body: { childProfileId: del.id, outcome: "understood" } });

    // Needs re-auth.
    expect((await call(await api.child(), { method: "DELETE", token: fam.user.token, query: { id: del.id } })).status).toBe(401);
    const reauth = await reauthToken(fam.user.token);
    const r = await call(await api.child(), { method: "DELETE", token: fam.user.token, query: { id: del.id }, headers: { "x-lt-reauth": reauth } });
    expect(r.status).toBe(200);
    expect(r.body.revokedDevices).toBe(1);
    expect(await ChildProfile.count({ where: { id: del.id } })).toBe(0);
    expect(await Session.count({ where: { childProfileId: del.id } })).toBe(0);
    expect(await Observation.count({ where: { childProfileId: del.id } })).toBe(0);
    expect(await ChildDeviceProfile.count({ where: { childProfileId: del.id } })).toBe(0);
    expect((await call(await api.kidMe(), { cookies: solo.cookies })).status).toBe(401);
    expect((await call(await api.kidMe(), { cookies: shared.cookies })).status).toBe(200);
    expect(await AuditLog.count({ where: { action: "child.deleted", entityId: del.id } })).toBe(1);
  });

  it("family PIN change requires re-auth", async () => {
    const fam = await makeFamily([]);
    expect((await call(await api.pin(), { method: "POST", token: fam.user.token, body: { pin: "5678" } })).status).toBe(401);
    const reauth = await reauthToken(fam.user.token);
    expect((await call(await api.pin(), { method: "POST", token: fam.user.token, body: { pin: "5678" }, headers: { "x-lt-reauth": reauth } })).status).toBe(200);
  });

  it("deleting family data removes everything", async () => {
    const fam = await makeFamily(["Gone"]);
    const dev = await pairDevice(fam.user.token, [fam.children[0].id]);
    const reauth = await reauthToken(fam.user.token);
    expect((await call(await api.privacyDelete(), { method: "POST", token: fam.user.token, headers: { "x-lt-reauth": reauth } })).status).toBe(200);
    expect(await ChildProfile.count({ where: { id: fam.children[0].id } })).toBe(0);
    expect((await call(await api.kidMe(), { cookies: dev.cookies })).status).toBe(401);
    expect((await call(await api.me(), { token: fam.user.token })).body.family).toBeNull();
  });
});

describe("admin metrics", () => {
  it("is role-gated and suppresses small cells", async () => {
    const fam = await makeFamily([]);
    expect((await call(await api.adminMetrics(), { token: fam.user.token })).status).toBe(403);
    const admin = await makeUser({ role: "admin" });
    const r = await call(await api.adminMetrics(), { token: admin.token });
    expect(r.status).toBe(200);
    expect(r.body.minFamilies).toBe(5);
    for (const row of r.body.perActivity) if (row.families < 5) expect(row.launched).toMatchObject({ value: null, suppressed: true });
  });
});
