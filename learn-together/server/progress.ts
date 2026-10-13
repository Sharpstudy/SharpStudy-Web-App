// Progress: recompute derived concept status, assemble the parent Progress page, recommendations, export.
import { Op } from "sequelize";
import {
  ChildProfile,
  ChildResponse,
  ConceptProgress,
  DismissedActivity,
  HelpSignal,
  MisconceptionSeen,
  Observation,
  ParentConfidence,
  Session,
  SessionCheck,
  SessionGroup,
  StepEvent,
  type Row,
} from "./models";
import { notFound } from "./errors";
import type { ParentPrincipal } from "./auth";
import { audit } from "./audit";
import { track } from "./analytics";
import { publishedCatalog, toCatalogEntry, versionContent } from "./content";
import { computeConceptProgress, HOW_STATUS_IS_DETERMINED, type CheckInterpretation, type ConceptSessionRecord, type ConceptStatus, type ReflectionOutcome } from "@/learn-together/domain/progress";
import { recommend, type Recommendation } from "@/learn-together/domain/recommend";
import { canAccessTier } from "@/learn-together/domain/entitlements";
import type { ActivityContent } from "@/learn-together/domain/schema";

interface CompletedSession {
  session: Row;
  group: Row;
  content: ActivityContent;
  observation: Row | null;
  checks: Record<string, CheckInterpretation>;
}

async function completedSessions(childProfileId: string, range?: { from?: Date; to?: Date }): Promise<CompletedSession[]> {
  const where: Record<string, unknown> = { childProfileId, status: "completed" };
  if (range?.from || range?.to) where.completedAt = { ...(range.from ? { [Op.gte]: range.from } : {}), ...(range.to ? { [Op.lte]: range.to } : {}) };
  const sessions = await Session.findAll({ where, order: [["completed_at", "ASC"]] });
  if (!sessions.length) return [];
  const sids = sessions.map((s) => s.id);
  const [groups, observations, checks] = await Promise.all([
    SessionGroup.findAll({ where: { id: sessions.map((s) => s.groupId) } }),
    Observation.findAll({ where: { sessionId: sids, deletedAt: null } }),
    SessionCheck.findAll({ where: { sessionId: sids } }),
  ]);
  const contentCache = new Map<string, ActivityContent>();
  const out: CompletedSession[] = [];
  for (const s of sessions) {
    const g = groups.find((x) => x.id === s.groupId)!;
    if (!contentCache.has(g.activityVersionId)) contentCache.set(g.activityVersionId, (await versionContent(g.activityVersionId)).content);
    out.push({
      session: s,
      group: g,
      content: contentCache.get(g.activityVersionId)!,
      observation: observations.find((o) => o.sessionId === s.id) || null,
      checks: Object.fromEntries(checks.filter((c) => c.sessionId === s.id).map((c) => [c.questionKey, c.parentInterpretation])),
    });
  }
  return out;
}

function conceptRecords(sessions: CompletedSession[]) {
  const byConcept = new Map<string, ConceptSessionRecord[]>();
  for (const cs of sessions) {
    const tags = (cs.observation?.conceptTags as string[] | undefined) || cs.content.conceptTags;
    for (const tag of tags) {
      const list = byConcept.get(tag) || [];
      list.push({
        sessionId: cs.session.id,
        completedAt: new Date(cs.session.completedAt),
        outcomes: cs.observation ? [cs.observation.outcome as ReflectionOutcome] : [],
        transferCheck: cs.checks.transfer,
      });
      byConcept.set(tag, list);
    }
  }
  return byConcept;
}

/** Recomputes every concept for a child. Parent overrides are preserved. */
export async function recomputeChildProgress(childProfileId: string, opts: { familyId?: string } = {}) {
  const sessions = await completedSessions(childProfileId);
  const byConcept = conceptRecords(sessions);
  const existing = await ConceptProgress.findAll({ where: { childProfileId } });
  const now = new Date();
  for (const [tag, records] of byConcept) {
    const row = existing.find((r) => r.conceptTag === tag);
    const override = row?.statusSource === "parent_override" ? { status: row.status as ConceptStatus, at: new Date(row.overrideAt || row.updated_at) } : null;
    const r = computeConceptProgress(records, now, override);
    if (!r.status) continue;
    if (row) {
      if (row.status !== r.status) await track("lt_concept_status_changed", { fromStatus: row.status, toStatus: r.status }, { familyId: opts.familyId });
      await row.update({ status: r.status, sessionsCount: r.sessionsCount, lastPracticedAt: r.lastPracticedAt });
    } else {
      await ConceptProgress.create({ childProfileId, conceptTag: tag, status: r.status, statusSource: "computed", sessionsCount: r.sessionsCount, lastPracticedAt: r.lastPracticedAt });
      await track("lt_concept_status_changed", { fromStatus: null, toStatus: r.status }, { familyId: opts.familyId });
    }
  }
  // Concepts that no longer have any completed session (e.g. observation deleted doesn't remove a
  // session, but a deleted child's data is gone) are removed unless a parent set them.
  for (const row of existing) if (!byConcept.has(row.conceptTag) && row.statusSource !== "parent_override") await row.destroy();
}

async function childOf(p: ParentPrincipal, childId: string) {
  const c = await ChildProfile.findOne({ where: { id: childId, familyId: p.familyId } });
  if (!c) throw notFound();
  return c;
}

export async function setOverride(p: ParentPrincipal, childId: string, conceptTag: string, status: ConceptStatus | null) {
  await childOf(p, childId);
  const row = await ConceptProgress.findOne({ where: { childProfileId: childId, conceptTag } });
  if (!row && status === null) return;
  const before = row ? { status: row.status, source: row.statusSource } : null;
  if (status === null) {
    await row!.update({ statusSource: "computed", overrideAt: null });
    await recomputeChildProgress(childId, { familyId: p.familyId });
  } else if (row) await row.update({ status, statusSource: "parent_override", overrideAt: new Date() });
  else await ConceptProgress.create({ childProfileId: childId, conceptTag, status, statusSource: "parent_override", overrideAt: new Date(), sessionsCount: 0 });
  await audit({ type: "user", id: p.userId }, "progress.override", "lt_concept_progress", `${childId}:${conceptTag}`, before, { status, source: status ? "parent_override" : "computed" });
  await track("lt_concept_status_overridden", { toStatus: status }, { familyId: p.familyId });
}

export async function editObservation(p: ParentPrincipal, observationId: string, patch: { outcome?: ReflectionOutcome; parentNote?: string | null }) {
  const o = await Observation.findByPk(observationId);
  if (!o || o.deletedAt) throw notFound();
  await childOf(p, o.childProfileId);
  await o.update({ ...(patch.outcome ? { outcome: patch.outcome } : {}), ...(patch.parentNote !== undefined ? { parentNote: patch.parentNote?.trim() || null } : {}), editedAt: new Date() });
  await audit({ type: "user", id: p.userId }, "observation.edited", "lt_observation", o.id);
  await recomputeChildProgress(o.childProfileId, { familyId: p.familyId });
}

export async function deleteObservation(p: ParentPrincipal, observationId: string) {
  const o = await Observation.findByPk(observationId);
  if (!o || o.deletedAt) throw notFound();
  await childOf(p, o.childProfileId);
  await o.update({ deletedAt: new Date(), parentNote: null });
  await audit({ type: "user", id: p.userId }, "observation.deleted", "lt_observation", o.id);
  await recomputeChildProgress(o.childProfileId, { familyId: p.familyId });
}

// ---------- recommendations ----------
export async function recommendationsFor(p: ParentPrincipal, childId: string, limit = 3): Promise<Recommendation[]> {
  const child = await childOf(p, childId);
  const [catalog, progress, dismissed, lastSessions] = await Promise.all([
    publishedCatalog(),
    ConceptProgress.findAll({ where: { childProfileId: childId } }),
    DismissedActivity.findAll({ where: { familyId: p.familyId, [Op.or]: [{ childProfileId: null }, { childProfileId: childId }] } }),
    completedSessions(childId),
  ]);
  const last = lastSessions[lastSessions.length - 1];
  const now = new Date();
  const revisit = progress
    .filter((r) => r.status === "confident" && r.lastPracticedAt && now.getTime() - new Date(r.lastPracticedAt).getTime() >= 30 * 86400000)
    .map((r) => r.conceptTag);
  return recommend({
    catalog: catalog.map(toCatalogEntry),
    childAgeBand: child.ageBand,
    lastSession: last?.observation ? { slug: last.content.slug, outcome: last.observation.outcome } : null,
    revisitConcepts: revisit,
    exploredConcepts: progress.map((r) => r.conceptTag),
    completedSlugs: [...new Set(lastSessions.map((s) => s.content.slug))],
    dismissedSlugs: catalog.filter((c) => dismissed.some((d) => d.activityId === c.activityId)).map((c) => c.slug),
    canAccess: (e) => canAccessTier(p, e.tier),
    limit,
  });
}

// ---------- progress page ----------
const DAY = 86400000;
function weekStart(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(x.getTime() - dow * DAY);
}

function describeValue(v: unknown, content: ActivityContent, itemKey: string): string {
  const [kind, key] = itemKey.split(":");
  const inter = kind === "step" ? content.scriptSteps.find((s) => s.id === key)?.child.interaction : content.checkQuestions.find((c) => c.key === key)?.child?.interaction;
  if (inter?.type === "choice") return inter.options.find((o) => o.key === v)?.label || String(v);
  if (inter?.type === "ordering" && Array.isArray(v)) return v.map((k) => inter.items.find((i) => i.key === k)?.label || k).join(" → ");
  if (inter?.type === "number_entry") return `${v}${inter.unit ? ` ${inter.unit}` : ""}`;
  if (v === true) return "done";
  return String(v);
}

function itemLabel(content: ActivityContent, itemKey: string) {
  const [kind, key] = itemKey.split(":");
  if (kind === "check") return key === "near" ? "Check question (near)" : "Check question (transfer)";
  return content.scriptSteps.find((s) => s.id === key)?.child.screen || key;
}

export async function progressPage(p: ParentPrincipal, childId: string, range: { from?: Date; to?: Date }) {
  const child = await childOf(p, childId);
  const now = new Date();
  const all = await completedSessions(childId);
  const inRange = all.filter((cs) => {
    const t = new Date(cs.session.completedAt).getTime();
    return (!range.from || t >= range.from.getTime()) && (!range.to || t <= range.to.getTime());
  });
  const sids = inRange.map((cs) => cs.session.id);
  const [responses, misc, steps, confidence, progressRows] = await Promise.all([
    sids.length ? ChildResponse.findAll({ where: { sessionId: sids }, order: [["submitted_at", "ASC"]] }) : [],
    sids.length ? MisconceptionSeen.findAll({ where: { sessionId: sids }, order: [["at", "DESC"]] }) : [],
    sids.length ? StepEvent.findAll({ where: { sessionId: sids } }) : [],
    all.length ? ParentConfidence.findAll({ where: { sessionId: all.map((cs) => cs.session.id), userId: p.userId }, order: [["created_at", "ASC"]] }) : [],
    ConceptProgress.findAll({ where: { childProfileId: childId }, order: [["concept_tag", "ASC"]] }),
  ]);

  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const lastWeek = all.filter((cs) => new Date(cs.session.completedAt) >= weekAgo);
  const thisWeek = {
    sessionsCompleted: lastWeek.length,
    learningMinutes: Math.round(lastWeek.reduce((s, cs) => s + (cs.session.activeSeconds || 0), 0) / 60),
    subjects: [...new Set(lastWeek.map((cs) => cs.content.subject))],
  };

  const currentWeek = weekStart(now);
  const weeklyRhythm = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(currentWeek.getTime() - (7 - i) * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    return { weekStart: start.toISOString().slice(0, 10), sessions: all.filter((cs) => { const t = new Date(cs.session.completedAt); return t >= start && t < end; }).length };
  });

  const byConcept = conceptRecords(all);
  const conceptMap = progressRows.map((row) => {
    const records = byConcept.get(row.conceptTag) || [];
    const override = row.statusSource === "parent_override" ? { status: row.status as ConceptStatus, at: new Date(row.overrideAt || row.updated_at) } : null;
    const r = computeConceptProgress(records, now, override);
    const checkHistory = all
      .filter((cs) => ((cs.observation?.conceptTags as string[]) || cs.content.conceptTags).includes(row.conceptTag))
      .map((cs) => ({ date: cs.session.completedAt, near: cs.checks.near || null, transfer: cs.checks.transfer || null }));
    return { conceptTag: row.conceptTag, status: row.status, source: row.statusSource, sessionsCount: row.sessionsCount, lastPracticedAt: row.lastPracticedAt, revisit: r.revisit, explanation: r.explanation, checkHistory };
  });

  const childAnswers = inRange
    .slice()
    .reverse()
    .map((cs) => {
      const rs = responses.filter((r) => r.sessionId === cs.session.id && r.itemKey !== "step:ready");
      const items = new Map<string, Row[]>();
      for (const r of rs) items.set(r.itemKey, [...(items.get(r.itemKey) || []), r]);
      return {
        sessionId: cs.session.id,
        title: cs.content.title,
        completedAt: cs.session.completedAt,
        items: [...items.entries()]
          .filter(([, list]) => list.some((r) => r.value !== true))
          .map(([itemKey, list]) => ({
            label: itemLabel(cs.content, itemKey),
            attempts: list.map((r) => describeValue(r.value, cs.content, itemKey)),
            matchedExpected: list[list.length - 1].isCorrect, // null = no expected answer
          })),
      };
    })
    .filter((s) => s.items.length);

  const catalog = await publishedCatalog();
  const misconceptions = misc.map((m) => {
    const cs = inRange.find((x) => x.session.id === m.sessionId)!;
    const def = cs.content.misconceptions.find((x) => x.key === m.misconceptionKey);
    const suggested =
      catalog.find((a) => a.slug === def?.suggestedActivitySlug) ||
      catalog.find((a) => a.slug !== cs.content.slug && a.content.conceptTags.some((t) => cs.content.conceptTags.includes(t)));
    return {
      at: m.at,
      activityTitle: cs.content.title,
      signal: def?.signal || m.misconceptionKey,
      supportiveNextQuestion: def?.supportiveNextQuestion || null,
      suggestedActivity: suggested ? { slug: suggested.slug, title: suggested.content.title } : null,
    };
  });

  const timeInsights: string[] = [];
  for (const cs of inRange) {
    for (const step of cs.content.scriptSteps) {
      const spent = steps
        .filter((e) => e.sessionId === cs.session.id && e.stepId === step.id && e.exitedAt)
        .reduce((s, e) => s + (new Date(e.exitedAt).getTime() - new Date(e.enteredAt).getTime()) / 1000, 0);
      if (spent > step.parent.suggestedSeconds * 1.5 && spent - step.parent.suggestedSeconds > 60) {
        timeInsights.push(`In "${cs.content.title}", the step "${step.child.screen}" took about ${Math.round(spent / 60)} min (suggested ${Math.max(1, Math.round(step.parent.suggestedSeconds / 60))} min).`);
      }
    }
  }

  const confidenceTrend = confidence.map((c) => {
    const cs = all.find((x) => x.session.id === c.sessionId);
    return { date: cs?.session.completedAt || c.created_at, rating: c.rating, activityTitle: cs?.content.title || "" };
  });

  const observations = inRange
    .filter((cs) => cs.observation)
    .reverse()
    .map((cs) => ({ id: cs.observation!.id, sessionId: cs.session.id, title: cs.content.title, completedAt: cs.session.completedAt, outcome: cs.observation!.outcome, parentNote: cs.observation!.parentNote, editedAt: cs.observation!.editedAt }));

  return {
    child: { id: child.id, nickname: child.nickname, avatarKey: child.avatarKey, ageBand: child.ageBand },
    thisWeek,
    weeklyRhythm,
    conceptMap,
    howDetermined: HOW_STATUS_IS_DETERMINED,
    childAnswers,
    misconceptions,
    timeInsights: timeInsights.slice(0, 10),
    confidenceTrend,
    observations,
    recommendations: await recommendationsFor(p, childId, 3),
  };
}

// ---------- export ----------
export async function exportChild(p: ParentPrincipal, childId: string) {
  const child = await childOf(p, childId);
  const sessions = await Session.findAll({ where: { childProfileId: childId }, order: [["started_at", "ASC"]] });
  const sids = sessions.map((s) => s.id);
  const groups = sids.length ? await SessionGroup.findAll({ where: { id: sessions.map((s) => s.groupId) } }) : [];
  const q = <T,>(fn: () => Promise<T[]>) => (sids.length ? fn() : Promise.resolve([] as T[]));
  const [responses, checks, observations, misc, help, progress, confidence] = await Promise.all([
    q(() => ChildResponse.findAll({ where: { sessionId: sids } })),
    q(() => SessionCheck.findAll({ where: { sessionId: sids } })),
    q(() => Observation.findAll({ where: { sessionId: sids, deletedAt: null } })),
    q(() => MisconceptionSeen.findAll({ where: { sessionId: sids } })),
    q(() => HelpSignal.findAll({ where: { sessionId: sids } })),
    ConceptProgress.findAll({ where: { childProfileId: childId } }),
    q(() => ParentConfidence.findAll({ where: { sessionId: sids } })),
  ]);
  const titles = new Map<string, string>();
  for (const g of groups) titles.set(g.id, (await versionContent(g.activityVersionId)).content.title);
  await audit({ type: "user", id: p.userId }, "child.exported", "lt_child_profile", childId);
  return {
    exportedAt: new Date().toISOString(),
    child: { nickname: child.nickname, avatarKey: child.avatarKey, ageBand: child.ageBand, language: child.language, readAloud: child.readAloud, largeText: child.largeText, reducedMotion: child.reducedMotion, subjectInterests: child.subjectInterests },
    sessions: sessions.map((s) => ({
      id: s.id,
      activity: titles.get(s.groupId),
      status: s.status,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      activeSeconds: s.activeSeconds,
      checks: checks.filter((c) => c.sessionId === s.id).map((c) => ({ question: c.questionKey, interpretation: c.parentInterpretation })),
      observation: observations.filter((o) => o.sessionId === s.id).map((o) => ({ outcome: o.outcome, note: o.parentNote, concepts: o.conceptTags }))[0] || null,
      responses: responses.filter((r) => r.sessionId === s.id).map((r) => ({ item: r.itemKey, value: r.value, matchedExpected: r.isCorrect, at: r.submittedAt })),
      helpSignals: help.filter((h) => h.sessionId === s.id).map((h) => ({ step: h.stepId, raisedAt: h.raisedAt, acknowledgedAt: h.acknowledgedAt })),
      misconceptionsNoticed: misc.filter((m) => m.sessionId === s.id).map((m) => m.misconceptionKey),
      parentConfidence: confidence.filter((c) => c.sessionId === s.id).map((c) => c.rating),
    })),
    concepts: progress.map((r) => ({ concept: r.conceptTag, status: r.status, source: r.statusSource, sessions: r.sessionsCount, lastPracticedAt: r.lastPracticedAt })),
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // avoid spreadsheet formula injection
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function exportToCsv(data: Awaited<ReturnType<typeof exportChild>>) {
  const header = ["session_id", "activity", "status", "started_at", "completed_at", "active_minutes", "near_check", "transfer_check", "reflection", "parent_note", "responses"];
  const rows = data.sessions.map((s) => [
    s.id,
    s.activity,
    s.status,
    s.startedAt && new Date(s.startedAt).toISOString(),
    s.completedAt && new Date(s.completedAt).toISOString(),
    Math.round((s.activeSeconds || 0) / 60),
    s.checks.find((c) => c.question === "near")?.interpretation,
    s.checks.find((c) => c.question === "transfer")?.interpretation,
    s.observation?.outcome,
    s.observation?.note,
    s.responses.map((r) => `${r.item}=${JSON.stringify(r.value)}`).join("; "),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

