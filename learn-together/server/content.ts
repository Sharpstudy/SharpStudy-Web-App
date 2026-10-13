// Content catalog (published only, cached per instance) and the admin review/publish workflow.
import { Op, QueryTypes } from "sequelize";
import { Activity, ActivityVersion, ContentReview, Feedback, sequelize } from "./models";
import { HttpError, notFound } from "./errors";
import { audit } from "./audit";
import { validateActivity, type ActivityContent } from "@/learn-together/domain/schema";
import type { CatalogEntry } from "@/learn-together/domain/recommend";

export interface PublishedActivity {
  activityId: string;
  versionId: string;
  version: number;
  slug: string;
  tier: "free" | "paid";
  content: ActivityContent;
}

const CACHE_MS = 60 * 1000;
let cache: { at: number; items: PublishedActivity[] } | null = null;
export const invalidateCatalog = () => {
  cache = null;
};

export async function publishedCatalog(): Promise<PublishedActivity[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  const acts = await Activity.findAll({ where: { status: "published", currentPublishedVersionId: { [Op.ne]: null } } });
  const versions = acts.length ? await ActivityVersion.findAll({ where: { id: acts.map((a) => a.currentPublishedVersionId) } }) : [];
  const items: PublishedActivity[] = [];
  for (const a of acts) {
    const v = versions.find((x) => x.id === a.currentPublishedVersionId);
    if (!v) continue;
    items.push({ activityId: a.id, versionId: v.id, version: v.version, slug: a.slug, tier: a.tier, content: v.content as ActivityContent });
  }
  items.sort((x, y) => x.content.difficulty - y.content.difficulty || x.slug.localeCompare(y.slug));
  cache = { at: Date.now(), items };
  return items;
}

export async function publishedBySlug(slug: string) {
  const a = (await publishedCatalog()).find((x) => x.slug === slug);
  if (!a) throw notFound("Activity not found");
  return a;
}

export async function versionContent(versionId: string): Promise<{ content: ActivityContent; activityId: string; version: number }> {
  const v = await ActivityVersion.findByPk(versionId);
  if (!v) throw notFound();
  return { content: v.content as ActivityContent, activityId: v.activityId, version: v.version };
}

export function toCatalogEntry(a: PublishedActivity): CatalogEntry {
  return {
    activityId: a.activityId,
    slug: a.slug,
    title: a.content.title,
    subject: a.content.subject,
    ageBands: a.content.ageBands,
    tier: a.tier,
    difficulty: a.content.difficulty,
    conceptTags: a.content.conceptTags,
    prerequisites: a.content.prerequisites,
    pathway: a.content.pathway || {},
  };
}

/** Parent-facing summary card (no script). */
export function activitySummary(a: PublishedActivity) {
  const c = a.content;
  return {
    activityId: a.activityId,
    slug: a.slug,
    tier: a.tier,
    title: c.title,
    subject: c.subject,
    activityType: c.activityType,
    ageBands: c.ageBands,
    estimatedMinutes: c.estimatedMinutes,
    learningGoal: c.learningGoal,
    conceptTags: c.conceptTags,
    realWorldHook: c.realWorldHook,
    materialsNeed: c.optionalKit ? "kit_optional" : c.materials.length ? "household" : "none",
    lowMess: c.filters.lowMess,
    setting: c.filters.setting,
    hasOptionalKit: !!c.optionalKit,
  };
}

// ---------- Admin workflow ----------
export const REVIEW_TYPES = ["subject", "developmental", "accessibility", "safety", "editorial"] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export function requiredReviews(content: ActivityContent): ReviewType[] {
  const base: ReviewType[] = ["subject", "developmental", "accessibility", "editorial"];
  return content.subject === "science" || content.safety ? [...base, "safety"] : base;
}

type ActorId = string;

export async function reviewStatus(versionId: string, content: ActivityContent) {
  const reviews = await ContentReview.findAll({ where: { activityVersionId: versionId }, order: [["at", "ASC"], ["id", "ASC"]] });
  const latest: Partial<Record<ReviewType, any>> = {};
  for (const r of reviews) latest[r.reviewType as ReviewType] = r;
  const required = requiredReviews(content);
  return {
    required,
    latest: Object.fromEntries(
      Object.entries(latest).map(([k, r]) => [k, { decision: r.decision, reviewerUserId: r.reviewerUserId, notes: r.notes, at: r.at }])
    ),
    history: reviews.map((r) => ({ type: r.reviewType, decision: r.decision, reviewerUserId: r.reviewerUserId, notes: r.notes, at: r.at })),
    ready: required.every((t) => latest[t]?.decision === "approved"),
  };
}

export async function adminList() {
  const acts = await Activity.findAll({ order: [["slug", "ASC"]] });
  const versions = await ActivityVersion.findAll({ attributes: ["id", "activityId", "version", "reviewState", "updated_at", "content"] });
  const fb = (await sequelize.query(
    "SELECT v.activity_id AS activityId, f.kind, COUNT(*) AS n FROM lt_feedback f JOIN lt_activity_versions v ON v.id = f.activity_version_id WHERE f.kind <> 'usefulness_rating' GROUP BY v.activity_id, f.kind",
    { type: QueryTypes.SELECT }
  )) as { activityId: string; kind: string; n: number }[];
  return acts.map((a) => {
    const vs = versions.filter((v) => v.activityId === a.id).sort((x, y) => y.version - x.version);
    return {
      id: a.id,
      slug: a.slug,
      subject: a.subject,
      tier: a.tier,
      status: a.status,
      title: (vs[0]?.content as ActivityContent | undefined)?.title || a.slug,
      currentPublishedVersionId: a.currentPublishedVersionId,
      latestVersion: vs[0] ? { id: vs[0].id, version: vs[0].version, reviewState: vs[0].reviewState } : null,
      confusionReports: Number(fb.find((f) => f.activityId === a.id && f.kind === "confusion")?.n || 0),
      safetyConcerns: Number(fb.find((f) => f.activityId === a.id && f.kind === "safety_concern")?.n || 0),
    };
  });
}

export async function adminDetail(activityId: string) {
  const a = await Activity.findByPk(activityId);
  if (!a) throw notFound();
  const versions = await ActivityVersion.findAll({ where: { activityId }, order: [["version", "DESC"]] });
  const feedback = await Feedback.findAll({ where: { activityVersionId: versions.map((v) => v.id), kind: ["confusion", "safety_concern"] }, order: [["created_at", "DESC"]], limit: 100 });
  return {
    activity: { id: a.id, slug: a.slug, subject: a.subject, tier: a.tier, status: a.status, currentPublishedVersionId: a.currentPublishedVersionId },
    versions: await Promise.all(
      versions.map(async (v) => ({
        id: v.id,
        version: v.version,
        locale: v.locale,
        reviewState: v.reviewState,
        createdBy: v.createdBy,
        publishedAt: v.publishedAt,
        updatedAt: v.updated_at,
        content: v.content,
        reviews: await reviewStatus(v.id, v.content as ActivityContent),
      }))
    ),
    feedback: feedback.map((f) => ({ kind: f.kind, note: f.note, versionId: f.activityVersionId, at: f.created_at })),
  };
}

function validOrThrow(content: unknown): ActivityContent {
  const r = validateActivity(content);
  if (!r.ok) throw Object.assign(new HttpError(422, "Content does not match the schema"), { errors: r.errors });
  return r.content;
}

/** Creates a new activity (if the slug is new) and a draft version. Used by admin and the seed script. */
export async function saveDraft(actor: ActorId | null, input: unknown, opts: { tier?: "free" | "paid" } = {}) {
  const content = validOrThrow(input);
  let a = await Activity.findOne({ where: { slug: content.slug } });
  if (!a) a = await Activity.create({ slug: content.slug, subject: content.subject, activityType: content.activityType, tier: opts.tier || "free" });
  else if (a.subject !== content.subject) throw new HttpError(422, "Subject can't change for an existing activity");

  // Editing the newest unpublished draft updates it in place; otherwise a new version is created.
  const latest = await ActivityVersion.findOne({ where: { activityId: a.id }, order: [["version", "DESC"]] });
  let v;
  if (latest && latest.reviewState === "draft") {
    await latest.update({ content });
    v = latest;
  } else {
    v = await ActivityVersion.create({ activityId: a.id, version: (latest?.version || 0) + 1, locale: "en", content, reviewState: "draft", createdBy: actor });
  }
  await audit(actor ? { type: "user", id: actor } : { type: "system" }, "content.draft_saved", "lt_activity_version", v.id);
  return { activityId: a.id as string, versionId: v.id as string, version: v.version as number };
}

export async function requestReviews(actor: ActorId, versionId: string) {
  const v = await ActivityVersion.findByPk(versionId);
  if (!v) throw notFound();
  if (!["draft", "rejected"].includes(v.reviewState)) throw new HttpError(409, "This version is already in review or published");
  const content = validOrThrow(v.content);
  await v.update({ reviewState: "in_review" });
  for (const t of requiredReviews(content)) await ContentReview.create({ activityVersionId: v.id, reviewType: t, decision: "requested", at: new Date() });
  await audit({ type: "user", id: actor }, "content.review_requested", "lt_activity_version", v.id);
}

export async function recordReview(actor: ActorId, versionId: string, reviewType: ReviewType, decision: "approved" | "changes_requested", notes?: string) {
  const v = await ActivityVersion.findByPk(versionId);
  if (!v) throw notFound();
  if (v.reviewState !== "in_review" && v.reviewState !== "approved") throw new HttpError(409, "Request reviews before recording a decision");
  if (v.createdBy && v.createdBy === actor) throw new HttpError(403, "You can't review your own draft");
  await ContentReview.create({ activityVersionId: v.id, reviewType, reviewerUserId: actor, decision, notes: notes || null, at: new Date() });
  const status = await reviewStatus(v.id, v.content as ActivityContent);
  await v.update({ reviewState: decision === "changes_requested" ? "rejected" : status.ready ? "approved" : "in_review" });
  await audit({ type: "user", id: actor }, `content.review_${decision}`, "lt_activity_version", v.id, null, { reviewType });
  return status;
}

export async function publishVersion(actor: ActorId, versionId: string) {
  const v = await ActivityVersion.findByPk(versionId);
  if (!v) throw notFound();
  const content = validOrThrow(v.content);
  const status = await reviewStatus(v.id, content);
  if (!status.ready) throw new HttpError(409, `Publishing needs approved reviews: ${status.required.filter((t) => status.latest[t]?.decision !== "approved").join(", ")}`, "reviews_pending");
  const a = await Activity.findByPk(v.activityId);
  if (!a) throw notFound();
  const before = a.currentPublishedVersionId;
  const t = await sequelize.transaction();
  try {
    if (before && before !== v.id) await ActivityVersion.update({ reviewState: "superseded" }, { where: { id: before }, transaction: t });
    await v.update({ reviewState: "published", publishedAt: v.publishedAt || new Date() }, { transaction: t });
    await a.update({ currentPublishedVersionId: v.id, status: "published", activityType: content.activityType }, { transaction: t });
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }
  invalidateCatalog();
  await audit({ type: "user", id: actor }, "content.published", "lt_activity", a.id, { versionId: before }, { versionId: v.id });
}

/** Re-points the activity at a previously published version. Takes effect for the next launch. */
export async function rollback(actor: ActorId, activityId: string, versionId: string) {
  const a = await Activity.findByPk(activityId);
  const v = await ActivityVersion.findOne({ where: { id: versionId, activityId } });
  if (!a || !v) throw notFound();
  if (!v.publishedAt) throw new HttpError(409, "You can only roll back to a version that was published before");
  const before = a.currentPublishedVersionId;
  if (before && before !== v.id) await ActivityVersion.update({ reviewState: "superseded" }, { where: { id: before } });
  await v.update({ reviewState: "published" });
  await a.update({ currentPublishedVersionId: v.id, status: "published" });
  invalidateCatalog();
  await audit({ type: "user", id: actor }, "content.rolled_back", "lt_activity", a.id, { versionId: before }, { versionId: v.id });
}

export async function retire(actor: ActorId, activityId: string) {
  const a = await Activity.findByPk(activityId);
  if (!a) throw notFound();
  await a.update({ status: "retired" });
  invalidateCatalog();
  await audit({ type: "user", id: actor }, "content.retired", "lt_activity", a.id);
}

export async function setTier(actor: ActorId, activityId: string, tier: "free" | "paid") {
  const a = await Activity.findByPk(activityId);
  if (!a) throw notFound();
  const before = a.tier;
  await a.update({ tier });
  invalidateCatalog();
  await audit({ type: "user", id: actor }, "content.tier_changed", "lt_activity", a.id, { tier: before }, { tier });
}
