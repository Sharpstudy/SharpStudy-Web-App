// Live session groups. Server state is authoritative: every change is written in a transaction
// that increments the group's `seq`, then broadcast. Clients that miss events refetch by seq.
import { Op, Transaction } from "sequelize";
import { z } from "zod";
import {
  ChildDevice,
  ChildDeviceProfile,
  ChildProfile,
  ChildResponse,
  HelpSignal,
  MisconceptionSeen,
  Observation,
  ParentConfidence,
  Session,
  SessionCheck,
  SessionGroup,
  SessionParticipant,
  StepEvent,
  sequelize,
  type Row,
} from "./models";
import { HttpError, notFound } from "./errors";
import type { DevicePrincipal, ParentPrincipal } from "./auth";
import { publishedBySlug, versionContent } from "./content";
import { canAccessTier } from "@/learn-together/domain/entitlements";
import { timelineFor, type ActivityContent, type Interaction } from "@/learn-together/domain/schema";
import { checkAnswer, isValidAnswerShape, projectActivity } from "@/learn-together/domain/projection";
import { transition, type GroupAction, type GroupSnapshot } from "@/learn-together/domain/session";
import { channels, type SyncEventType } from "@/learn-together/domain/sync";
import { makeEvent, publish } from "./realtime";
import { audit } from "./audit";
import { track } from "./analytics";
import { recomputeChildProgress } from "./progress";
import { ONLINE_WINDOW_MS } from "./family";
import type { IncomingMessage } from "http";

const STALE_GROUP_MS = 6 * 3600 * 1000;
const STEP_TIME_CAP_S = 15 * 60;

// ---------- helpers ----------
async function familyGroup(familyId: string, groupId: string, t?: Transaction) {
  const g = await SessionGroup.findOne({ where: { id: groupId, familyId }, transaction: t, lock: t ? t.LOCK.UPDATE : undefined });
  if (!g) throw notFound();
  return g;
}

/** Group visible to a child device: it must have a participant that is one of the device's children. */
type ChildActor = Pick<DevicePrincipal, "familyId" | "childProfileIds"> & { deviceId: string | null };

/** In single-device mode the parent's device submits on the child's behalf. */
export async function parentDeviceActor(p: ParentPrincipal, childProfileId: string): Promise<ChildActor> {
  const c = await ChildProfile.findOne({ where: { id: childProfileId, familyId: p.familyId } });
  if (!c) throw notFound();
  return { familyId: p.familyId, childProfileIds: [childProfileId], deviceId: null };
}

async function deviceGroup(d: ChildActor, groupId: string, t?: Transaction) {
  const g = await SessionGroup.findOne({ where: { id: groupId, familyId: d.familyId }, transaction: t, lock: t ? t.LOCK.UPDATE : undefined });
  if (!g) throw notFound();
  const parts = await SessionParticipant.findAll({ where: { groupId, childProfileId: d.childProfileIds }, transaction: t });
  if (!parts.length) throw notFound();
  return { g, parts };
}

const snapshot = (g: Row): GroupSnapshot => ({ state: g.state, currentStepIndex: g.currentStepIndex, stepCount: g.stepCount, seq: g.seq });

/** Publish a group event: full payload to the parent group channel; child channels get a child-safe payload. */
async function broadcast(g: Row, type: SyncEventType, seq: number, parentPayload: Record<string, unknown>, childPayload: Record<string, unknown> = {}) {
  const parts = await SessionParticipant.findAll({ where: { groupId: g.id } });
  await publish(channels.group(g.id), makeEvent(type, seq, parentPayload, g.id));
  for (const p of parts) await publish(channels.child(p.childProfileId), makeEvent(type, seq, childPayload, g.id));
}

async function bumpSeq(g: Row, t: Transaction) {
  const seq = g.seq + 1;
  await g.update({ seq }, { transaction: t });
  return seq;
}

async function withTx<T>(fn: (t: Transaction) => Promise<T>): Promise<T> {
  return sequelize.transaction(fn);
}

async function closeOpenStepEvents(sessionIds: string[], at: Date, t: Transaction) {
  if (!sessionIds.length) return;
  await StepEvent.update({ exitedAt: at }, { where: { sessionId: sessionIds, exitedAt: null }, transaction: t });
}

async function openStepEvents(sessionIds: string[], stepId: string, stepIndex: number, at: Date, t: Transaction) {
  for (const sessionId of sessionIds) await StepEvent.create({ sessionId, stepId, stepIndex, enteredAt: at }, { transaction: t });
}

async function finishSessions(g: Row, content: ActivityContent, reason: "completed" | "abandoned", t: Transaction) {
  const sessions = await Session.findAll({ where: { groupId: g.id, status: "in_progress" }, transaction: t });
  const timeline = timelineFor(content, g.durationMode);
  const reachedReflect = timeline.slice(0, g.maxStepIndex + 1).some((s) => s.parent.phase === "reflect");
  const status = reason === "completed" && reachedReflect ? "completed" : "abandoned";
  const now = new Date();
  for (const s of sessions) {
    const evs = await StepEvent.findAll({ where: { sessionId: s.id }, transaction: t });
    const active = evs.reduce((sum, e) => {
      const end = e.exitedAt ? new Date(e.exitedAt).getTime() : now.getTime();
      return sum + Math.min(STEP_TIME_CAP_S, Math.max(0, Math.round((end - new Date(e.enteredAt).getTime()) / 1000)));
    }, 0);
    await s.update({ status, completedAt: status === "completed" ? now : null, activeSeconds: active }, { transaction: t });
  }
  return { status, sessions };
}

/** Lazily ends groups nobody touched for hours so they don't linger as "in progress". */
async function expireStaleGroups(familyId: string) {
  const stale = await SessionGroup.findAll({ where: { familyId, state: { [Op.ne]: "ended" }, updated_at: { [Op.lt]: new Date(Date.now() - STALE_GROUP_MS) } } });
  for (const g of stale) await endGroup(g.id, familyId, "abandoned", null).catch(() => undefined);
}

// ---------- launch ----------
export const launchInput = z.object({
  activitySlug: z.string().min(1).max(80),
  childProfileIds: z.array(z.string().uuid()).min(1).max(8),
  mode: z.enum(["connected", "single_device"]),
  durationMode: z.enum(["full", "short"]).default("full"),
});

export async function launch(p: ParentPrincipal, input: unknown, req?: IncomingMessage) {
  const data = launchInput.parse(input);
  const activity = await publishedBySlug(data.activitySlug);
  if (!canAccessTier(p, activity.tier)) throw new HttpError(403, "This activity is included in full pathways", "not_entitled");
  const ids = [...new Set(data.childProfileIds)];
  const kids = await ChildProfile.findAll({ where: { id: ids, familyId: p.familyId } });
  if (kids.length !== ids.length) throw notFound();

  await expireStaleGroups(p.familyId);

  // A child is in at most one live group: end any other open group they're in.
  const openParts = await SessionParticipant.findAll({ where: { childProfileId: ids } });
  const openGroupIds = [...new Set(openParts.map((x) => x.groupId))];
  if (openGroupIds.length) {
    const open = await SessionGroup.findAll({ where: { id: openGroupIds, state: { [Op.ne]: "ended" } } });
    for (const og of open) await endGroup(og.id, p.familyId, "abandoned", p.userId);
  }

  // Devices for connected mode: the child's most recently seen paired device.
  const deviceFor = new Map<string, string>();
  if (data.mode === "connected") {
    const links = await ChildDeviceProfile.findAll({ where: { childProfileId: ids } });
    const devices = links.length ? await ChildDevice.findAll({ where: { id: links.map((l) => l.childDeviceId), revokedAt: null, deviceTokenHash: { [Op.ne]: null } }, order: [["last_seen_at", "DESC"]] }) : [];
    for (const kid of kids) {
      const dev = devices.find((d) => links.some((l) => l.childDeviceId === d.id && l.childProfileId === kid.id));
      if (dev) deviceFor.set(kid.id, dev.id);
    }
  }

  const timeline = timelineFor(activity.content, data.durationMode);
  const now = new Date();
  const g = await withTx(async (t) => {
    const g = await SessionGroup.create(
      {
        familyId: p.familyId,
        hostUserId: p.userId,
        activityVersionId: activity.versionId,
        mode: data.mode,
        state: "lobby",
        currentStepIndex: 0,
        maxStepIndex: 0,
        stepCount: timeline.length,
        seq: 1,
        durationMode: data.durationMode,
        startedAt: now,
      },
      { transaction: t }
    );
    for (const kid of kids) {
      await Session.create({ groupId: g.id, childProfileId: kid.id, status: "in_progress", startedAt: now }, { transaction: t });
      await SessionParticipant.create({ groupId: g.id, childProfileId: kid.id, childDeviceId: deviceFor.get(kid.id) || null, presence: "offline" }, { transaction: t });
    }
    return g;
  });

  await publish(channels.group(g.id), makeEvent("session.launched", 1, { activitySlug: activity.slug }, g.id));
  for (const kid of kids)
    if (deviceFor.has(kid.id)) await publish(channels.child(kid.id), makeEvent("session.launched", 1, { title: activity.content.title, childProfileId: kid.id }, g.id));

  await track(
    "lt_session_launched",
    { activityId: activity.activityId, activityVersionId: activity.versionId, subject: activity.content.subject, mode: data.mode, durationMode: data.durationMode, childCount: kids.length },
    { familyId: p.familyId, req }
  );
  return { groupId: g.id as string };
}

// ---------- parent controls ----------
export const actionInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("prev") }),
  z.object({ type: z.literal("goto"), index: z.number().int().min(0) }),
  z.object({ type: z.literal("repeat") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("end"), reason: z.enum(["completed", "abandoned"]).optional() }),
]);

export async function act(p: ParentPrincipal, groupId: string, input: unknown) {
  const action = actionInput.parse(input) as GroupAction;
  if (action.type === "end") return endGroup(groupId, p.familyId, action.reason || "completed", p.userId);

  const result = await withTx(async (t) => {
    const g = await familyGroup(p.familyId, groupId, t);
    const { content } = await versionContent(g.activityVersionId);
    const timeline = timelineFor(content, g.durationMode);
    const { next, event } = transition(snapshot(g), action);
    const now = new Date();
    const sessions = await Session.findAll({ where: { groupId: g.id, status: "in_progress" }, transaction: t });
    const sids = sessions.map((s) => s.id);

    if (event.type === "session.step_changed" && !(event.payload as { repeat?: boolean }).repeat) {
      await closeOpenStepEvents(sids, now, t);
      await openStepEvents(sids, timeline[next.currentStepIndex].id, next.currentStepIndex, now, t);
    } else if (event.type === "session.paused") {
      await closeOpenStepEvents(sids, now, t);
    } else if (event.type === "session.resumed") {
      await openStepEvents(sids, timeline[next.currentStepIndex].id, next.currentStepIndex, now, t);
    }
    await g.update(
      {
        state: next.state,
        currentStepIndex: next.currentStepIndex,
        maxStepIndex: Math.max(g.maxStepIndex, next.currentStepIndex),
        seq: next.seq,
        stepChangedAt: event.type === "session.step_changed" ? now : g.stepChangedAt,
      },
      { transaction: t }
    );
    return { g, event, seq: next.seq };
  });

  const payload = { ...result.event.payload, state: result.g.state, stepIndex: result.g.currentStepIndex };
  await broadcast(result.g, result.event.type, result.seq, payload, payload);
  return { seq: result.seq };
}

export async function endGroup(groupId: string, familyId: string, reason: "completed" | "abandoned", actorUserId: string | null) {
  const result = await withTx(async (t) => {
    const g = await familyGroup(familyId, groupId, t);
    if (g.state === "ended") return null;
    const { content, activityId } = await versionContent(g.activityVersionId);
    const { next, event } = transition(snapshot(g), { type: "end", reason });
    const now = new Date();
    const open = await Session.findAll({ where: { groupId: g.id, status: "in_progress" }, transaction: t });
    await closeOpenStepEvents(open.map((s) => s.id), now, t);
    const fin = await finishSessions(g, content, reason, t);
    await g.update({ state: next.state, seq: next.seq, endedAt: now }, { transaction: t });
    return { g, event, seq: next.seq, fin, content, activityId };
  });
  if (!result) return { seq: null };
  const { g, event, seq, fin, content, activityId } = result;
  await broadcast(g, event.type, seq, { ...event.payload, status: fin.status }, { ...event.payload });

  const timeline = timelineFor(content, g.durationMode);
  for (const s of fin.sessions) {
    if (fin.status === "completed") await recomputeChildProgress(s.childProfileId, { familyId });
    await track(
      fin.status === "completed" ? "lt_session_completed" : "lt_session_abandoned",
      { activityId, activityVersionId: g.activityVersionId, subject: content.subject, mode: g.mode, durationMode: g.durationMode, lastStepIndex: g.maxStepIndex, sessionId: s.id, reason: timeline[g.maxStepIndex]?.parent.phase || null },
      { familyId }
    );
  }
  return { seq };
}

// ---------- state views ----------
function presenceOf(part: Row) {
  return part.lastPresenceAt && Date.now() - new Date(part.lastPresenceAt).getTime() < ONLINE_WINDOW_MS ? "online" : "offline";
}

export async function parentState(p: ParentPrincipal, groupId: string) {
  const g = await familyGroup(p.familyId, groupId);
  const { content, activityId } = await versionContent(g.activityVersionId);
  const [parts, sessions] = await Promise.all([SessionParticipant.findAll({ where: { groupId } }), Session.findAll({ where: { groupId } })]);
  const sids = sessions.map((s) => s.id);
  const [kids, responses, help, checks, observations, misc, confidence, devices] = await Promise.all([
    ChildProfile.findAll({ where: { id: parts.map((x) => x.childProfileId) } }),
    ChildResponse.findAll({ where: { sessionId: sids }, order: [["submitted_at", "ASC"]] }),
    HelpSignal.findAll({ where: { sessionId: sids }, order: [["raised_at", "ASC"]] }),
    SessionCheck.findAll({ where: { sessionId: sids } }),
    Observation.findAll({ where: { sessionId: sids, deletedAt: null } }),
    MisconceptionSeen.findAll({ where: { sessionId: sids } }),
    ParentConfidence.findAll({ where: { sessionId: sids, userId: p.userId } }),
    ChildDevice.findAll({ where: { id: parts.map((x) => x.childDeviceId).filter(Boolean) } }),
  ]);

  return {
    groupId: g.id,
    seq: g.seq,
    state: g.state,
    mode: g.mode,
    durationMode: g.durationMode,
    currentStepIndex: g.currentStepIndex,
    maxStepIndex: g.maxStepIndex,
    stepChangedAt: g.stepChangedAt,
    activityId,
    activityVersionId: g.activityVersionId,
    content,
    timeline: timelineFor(content, g.durationMode).map((s) => s.id),
    children: parts.map((part) => {
      const kid = kids.find((k) => k.id === part.childProfileId)!;
      const session = sessions.find((s) => s.childProfileId === part.childProfileId)!;
      const dev = devices.find((d) => d.id === part.childDeviceId);
      return {
        childProfileId: part.childProfileId,
        nickname: kid?.nickname,
        avatarKey: kid?.avatarKey,
        sessionId: session?.id,
        sessionStatus: session?.status,
        device: dev ? { id: dev.id, label: dev.label } : null,
        presence: part.childDeviceId ? presenceOf(part) : "this_device",
        joined: !!part.joinedAt,
        ready: !!part.readyAt,
        lastAckSeq: part.lastAckSeq,
        responses: responses.filter((r) => r.sessionId === session?.id).map((r) => ({ id: r.id, itemKey: r.itemKey, value: r.value, isCorrect: r.isCorrect, at: r.submittedAt })),
        help: help.filter((h) => h.sessionId === session?.id).map((h) => ({ id: h.id, stepId: h.stepId, raisedAt: h.raisedAt, acknowledgedAt: h.acknowledgedAt })),
        checks: Object.fromEntries(checks.filter((c) => c.sessionId === session?.id).map((c) => [c.questionKey, c.parentInterpretation])),
        observation: (() => {
          const o = observations.find((x) => x.sessionId === session?.id);
          return o ? { id: o.id, outcome: o.outcome, parentNote: o.parentNote } : null;
        })(),
        misconceptionsSeen: misc.filter((m) => m.sessionId === session?.id).map((m) => ({ key: m.misconceptionKey, stepId: m.stepId })),
        confidence: confidence.find((c) => c.sessionId === session?.id)?.rating || null,
      };
    }),
  };
}

export async function childState(d: DevicePrincipal, groupId: string) {
  const { g, parts } = await deviceGroup(d, groupId);
  const { content } = await versionContent(g.activityVersionId);
  const kids = await ChildProfile.findAll({ where: { id: parts.map((x) => x.childProfileId) } });
  const sessions = await Session.findAll({ where: { groupId, childProfileId: parts.map((x) => x.childProfileId) } });
  const [responses, help] = await Promise.all([
    ChildResponse.findAll({ where: { sessionId: sessions.map((s) => s.id) }, attributes: ["childProfileId", "itemKey"] }),
    HelpSignal.findAll({ where: { sessionId: sessions.map((s) => s.id), acknowledgedAt: null }, attributes: ["childProfileId"] }),
  ]);
  return {
    groupId: g.id,
    seq: g.seq,
    state: g.state,
    currentStepIndex: g.currentStepIndex,
    activity: projectActivity(content, g.durationMode),
    children: parts.map((part) => {
      const kid = kids.find((k) => k.id === part.childProfileId)!;
      return {
        id: part.childProfileId,
        nickname: kid.nickname,
        avatarKey: kid.avatarKey,
        readAloud: !!kid.readAloud,
        largeText: !!kid.largeText,
        reducedMotion: !!kid.reducedMotion,
        ready: !!part.readyAt,
        answered: responses.filter((r) => r.childProfileId === part.childProfileId).map((r) => r.itemKey),
        helpPending: help.some((h) => h.childProfileId === part.childProfileId),
      };
    }),
  };
}

// ---------- child device actions ----------
async function childAction(
  d: ChildActor,
  groupId: string,
  childProfileId: string,
  fn: (ctx: { g: Row; part: Row; session: Row; t: Transaction }) => Promise<{ type: SyncEventType; parent: Record<string, unknown>; child?: Record<string, unknown> } | null>
) {
  if (!d.childProfileIds.includes(childProfileId)) throw notFound();
  const out = await withTx(async (t) => {
    const { g, parts } = await deviceGroup(d, groupId, t);
    const part = parts.find((x) => x.childProfileId === childProfileId);
    if (!part) throw notFound();
    const session = await Session.findOne({ where: { groupId, childProfileId }, transaction: t });
    const ev = await fn({ g, part, session: session!, t });
    if (!ev) return null;
    const seq = await bumpSeq(g, t);
    return { g, seq, ev };
  });
  if (out) await broadcast(out.g, out.ev.type, out.seq, { childProfileId, ...out.ev.parent }, { childProfileId, ...(out.ev.child || {}) });
  return { seq: out?.seq ?? null };
}

export async function childJoin(d: DevicePrincipal, groupId: string, childProfileId: string) {
  return childAction(d, groupId, childProfileId, async ({ part, t }) => {
    const now = new Date();
    const first = !part.joinedAt;
    await part.update({ joinedAt: part.joinedAt || now, childDeviceId: d.deviceId, presence: "online", lastPresenceAt: now }, { transaction: t });
    return first ? { type: "child.joined", parent: {} } : null;
  });
}

export async function childReady(d: ChildActor, groupId: string, childProfileId: string) {
  const r = await childAction(d, groupId, childProfileId, async ({ part, t }) => {
    if (part.readyAt) return null;
    await part.update({ readyAt: new Date() }, { transaction: t });
    return { type: "child.ready", parent: {} };
  });
  await track("lt_child_ready", {}, { familyId: d.familyId });
  return r;
}

export async function heartbeat(d: DevicePrincipal, groupId: string | null, ackSeq?: number) {
  const now = new Date();
  await ChildDevice.update({ lastSeenAt: now }, { where: { id: d.deviceId } });
  if (!groupId) return { now: now.getTime() };
  const parts = await SessionParticipant.findAll({ where: { groupId, childProfileId: d.childProfileIds } });
  for (const part of parts) {
    const wasOffline = presenceOf(part) === "offline";
    await part.update({ lastPresenceAt: now, presence: "online", childDeviceId: part.childDeviceId || d.deviceId, lastAckSeq: Math.max(part.lastAckSeq, ackSeq || 0) });
    if (wasOffline && part.joinedAt) {
      const g = await SessionGroup.findByPk(groupId);
      if (g && g.state !== "ended") {
        const seq = await withTx(async (t) => {
          const locked = await SessionGroup.findByPk(groupId, { transaction: t, lock: t.LOCK.UPDATE });
          return bumpSeq(locked!, t);
        });
        await broadcast(g, "presence.changed", seq, { childProfileId: part.childProfileId, presence: "online" }, { childProfileId: part.childProfileId });
      }
    }
  }
  return { now: now.getTime() };
}

export const responseInput = z.object({
  childProfileId: z.string().uuid(),
  itemKey: z.string().regex(/^(step:[a-z0-9_-]+|check:(near|transfer))$/),
  value: z.union([z.boolean(), z.number(), z.string().max(80), z.array(z.string().max(80)).max(6)]),
});

function interactionFor(content: ActivityContent, timelineIds: string[], currentIndex: number, itemKey: string): Interaction | undefined {
  const [kind, key] = itemKey.split(":");
  const current = content.scriptSteps.find((s) => s.id === timelineIds[currentIndex]);
  if (kind === "step") {
    if (!current || current.id !== key) throw new HttpError(409, "That step isn't on screen any more", "stale_step");
    return current.child.interaction;
  }
  if (current?.parent.phase !== "check") throw new HttpError(409, "Check questions aren't open right now", "stale_step");
  return content.checkQuestions.find((c) => c.key === key)?.child?.interaction;
}

export async function childRespond(d: ChildActor, groupId: string, input: unknown, req?: IncomingMessage) {
  const data = responseInput.parse(input);
  let isCorrect: boolean | null = null;
  const r = await childAction(d, groupId, data.childProfileId, async ({ g, session, t }) => {
    if (g.state !== "active") throw new HttpError(409, "The activity isn't running", "not_active");
    const { content } = await versionContent(g.activityVersionId);
    const ids = timelineFor(content, g.durationMode).map((s) => s.id);
    const inter = interactionFor(content, ids, g.currentStepIndex, data.itemKey);
    if (!inter || !isValidAnswerShape(inter, data.value)) throw new HttpError(422, "That answer doesn't fit this question");
    isCorrect = checkAnswer(inter, data.value);
    await ChildResponse.create(
      { sessionId: session.id, childProfileId: data.childProfileId, childDeviceId: d.deviceId, itemKey: data.itemKey, value: data.value, isCorrect, submittedAt: new Date() },
      { transaction: t }
    );
    return { type: "child.response_submitted", parent: { itemKey: data.itemKey, value: data.value, isCorrect }, child: { itemKey: data.itemKey } };
  });
  await track("lt_child_response_submitted", { isCorrect }, { familyId: d.familyId, req });
  return r;
}

export async function childHelp(d: ChildActor, groupId: string, childProfileId: string) {
  const r = await childAction(d, groupId, childProfileId, async ({ g, session, t }) => {
    const pending = await HelpSignal.count({ where: { sessionId: session.id, acknowledgedAt: null }, transaction: t });
    if (pending) return null;
    const { content } = await versionContent(g.activityVersionId);
    const stepId = timelineFor(content, g.durationMode)[g.currentStepIndex]?.id || "lobby";
    const h = await HelpSignal.create({ sessionId: session.id, childProfileId, stepId, raisedAt: new Date() }, { transaction: t });
    return { type: "child.help_raised", parent: { helpId: h.id, stepId } };
  });
  await track("lt_child_help_raised", {}, { familyId: d.familyId });
  return r;
}

export async function acknowledgeHelp(p: ParentPrincipal, groupId: string, helpId: string) {
  const out = await withTx(async (t) => {
    const g = await familyGroup(p.familyId, groupId, t);
    const h = await HelpSignal.findByPk(helpId, { transaction: t });
    const s = h && (await Session.findOne({ where: { id: h.sessionId, groupId }, transaction: t }));
    if (!h || !s) throw notFound();
    if (h.acknowledgedAt) return null;
    await h.update({ acknowledgedAt: new Date() }, { transaction: t });
    return { g, seq: await bumpSeq(g, t), childProfileId: h.childProfileId };
  });
  if (out) await broadcast(out.g, "child.help_acknowledged", out.seq, { helpId, childProfileId: out.childProfileId }, { childProfileId: out.childProfileId });
  return { seq: out?.seq ?? null };
}

// ---------- parent recording ----------
async function sessionInGroup(p: ParentPrincipal, groupId: string, childProfileId: string) {
  const g = await familyGroup(p.familyId, groupId);
  const s = await Session.findOne({ where: { groupId, childProfileId } });
  if (!s) throw notFound();
  if (g.state === "ended" && g.endedAt && Date.now() - new Date(g.endedAt).getTime() > 7 * 86400000)
    throw new HttpError(409, "This session is closed. Edit observations from the Progress page.");
  return { g, s };
}

export const checkInput = z.object({ childProfileId: z.string().uuid(), questionKey: z.enum(["near", "transfer"]), interpretation: z.enum(["clear", "partial", "not_yet"]) });
export async function recordCheck(p: ParentPrincipal, groupId: string, input: unknown) {
  const data = checkInput.parse(input);
  const { g, s } = await sessionInGroup(p, groupId, data.childProfileId);
  const existing = await SessionCheck.findOne({ where: { sessionId: s.id, questionKey: data.questionKey } });
  if (existing) await existing.update({ parentInterpretation: data.interpretation, recordedByUserId: p.userId });
  else await SessionCheck.create({ sessionId: s.id, questionKey: data.questionKey, parentInterpretation: data.interpretation, recordedByUserId: p.userId });
  await track("lt_check_recorded", { questionKey: data.questionKey, interpretation: data.interpretation, activityVersionId: g.activityVersionId }, { familyId: p.familyId });
  if (s.status === "completed") await recomputeChildProgress(data.childProfileId, { familyId: p.familyId });
}

export const misconceptionInput = z.object({ childProfileId: z.string().uuid(), misconceptionKey: z.string().max(80), stepId: z.string().max(80).optional() });
export async function recordMisconception(p: ParentPrincipal, groupId: string, input: unknown) {
  const data = misconceptionInput.parse(input);
  const { g, s } = await sessionInGroup(p, groupId, data.childProfileId);
  const { content } = await versionContent(g.activityVersionId);
  if (!content.misconceptions.some((m) => m.key === data.misconceptionKey)) throw new HttpError(422, "Unknown misconception");
  await MisconceptionSeen.create({ sessionId: s.id, childProfileId: data.childProfileId, misconceptionKey: data.misconceptionKey, stepId: data.stepId || null, at: new Date() });
  await track("lt_misconception_observed", { activityVersionId: g.activityVersionId }, { familyId: p.familyId });
}

export const reflectInput = z.object({
  childProfileId: z.string().uuid(),
  outcome: z.enum(["understood", "practice_again", "not_sure"]),
  parentNote: z.string().max(1000).optional().nullable(),
  confidence: z.number().int().min(1).max(5).optional().nullable(),
});
export async function recordReflection(p: ParentPrincipal, groupId: string, input: unknown) {
  const data = reflectInput.parse(input);
  const { g, s } = await sessionInGroup(p, groupId, data.childProfileId);
  const { content } = await versionContent(g.activityVersionId);
  const existing = await Observation.findOne({ where: { sessionId: s.id, deletedAt: null } });
  const note = data.parentNote?.trim() || null;
  if (existing) await existing.update({ outcome: data.outcome, parentNote: note, editedAt: new Date() });
  else await Observation.create({ sessionId: s.id, childProfileId: data.childProfileId, conceptTags: content.conceptTags, outcome: data.outcome, parentNote: note, recordedByUserId: p.userId });
  await track("lt_reflection_recorded", { outcome: data.outcome, activityVersionId: g.activityVersionId }, { familyId: p.familyId });
  if (data.confidence) {
    const c = await ParentConfidence.findOne({ where: { sessionId: s.id, userId: p.userId } });
    if (c) await c.update({ rating: data.confidence });
    else await ParentConfidence.create({ sessionId: s.id, userId: p.userId, rating: data.confidence });
    await track("lt_parent_confidence_rated", { rating: data.confidence }, { familyId: p.familyId });
  }
  if (s.status === "completed") await recomputeChildProgress(data.childProfileId, { familyId: p.familyId });
}

/** Move a child whose device dropped onto the parent's device (single-device for that child). */
export async function useThisDeviceFor(p: ParentPrincipal, groupId: string, childProfileId: string) {
  const out = await withTx(async (t) => {
    const g = await familyGroup(p.familyId, groupId, t);
    const part = await SessionParticipant.findOne({ where: { groupId, childProfileId }, transaction: t });
    if (!part) throw notFound();
    await part.update({ childDeviceId: null }, { transaction: t });
    return { g, seq: await bumpSeq(g, t) };
  });
  await broadcast(out.g, "presence.changed", out.seq, { childProfileId, presence: "this_device" }, { childProfileId, movedToParentDevice: true });
  await audit({ type: "user", id: p.userId }, "session.child_moved_to_parent_device", "lt_session_group", groupId);
  return { seq: out.seq };
}

// ---------- lobby / home ----------
export async function openGroupsForFamily(familyId: string) {
  await expireStaleGroups(familyId);
  const groups = await SessionGroup.findAll({ where: { familyId, state: { [Op.ne]: "ended" } }, order: [["updated_at", "DESC"]] });
  const parts = groups.length ? await SessionParticipant.findAll({ where: { groupId: groups.map((g) => g.id) } }) : [];
  return Promise.all(
    groups.map(async (g) => {
      const { content } = await versionContent(g.activityVersionId);
      return { groupId: g.id, state: g.state, mode: g.mode, title: content.title, slug: content.slug, currentStepIndex: g.currentStepIndex, stepCount: g.stepCount, childProfileIds: parts.filter((x) => x.groupId === g.id).map((x) => x.childProfileId) };
    })
  );
}

/** What a paired device should show: its children and any live group launched to them. */
export async function lobbyForDevice(d: DevicePrincipal) {
  const parts = await SessionParticipant.findAll({ where: { childProfileId: d.childProfileIds, childDeviceId: d.deviceId } });
  const groups = parts.length ? await SessionGroup.findAll({ where: { id: parts.map((x) => x.groupId), state: { [Op.ne]: "ended" } }, order: [["created_at", "DESC"]] }) : [];
  const fresh = groups.filter((g) => Date.now() - new Date(g.updated_at).getTime() < STALE_GROUP_MS);
  return fresh.map((g) => ({ groupId: g.id, seq: g.seq, state: g.state, childProfileIds: parts.filter((x) => x.groupId === g.id).map((x) => x.childProfileId) }));
}
