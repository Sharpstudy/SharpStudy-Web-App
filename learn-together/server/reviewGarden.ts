import { Op } from "sequelize";
import { ReviewGardenItem } from "./models";

export interface ReviewItem {
  id: string;
  childProfileId: string;
  conceptTag: string;
  activitySlug: string | null;
  nextReviewAt: string;
  interval: number;
  easeFactor: number;
  repetitions: number;
}

export async function getDueItems(childProfileId: string, now: Date): Promise<ReviewItem[]> {
  const rows = await ReviewGardenItem.findAll({
    where: { childProfileId, nextReviewAt: { [Op.lte]: now } },
    order: [["next_review_at", "ASC"]],
    limit: 20,
  });
  return rows.map(toRow);
}

export async function upsertReviewItem(childProfileId: string, conceptTag: string, activitySlug?: string): Promise<ReviewItem> {
  const [row] = await ReviewGardenItem.findOrCreate({
    where: { childProfileId, conceptTag },
    defaults: { childProfileId, conceptTag, activitySlug: activitySlug || null, nextReviewAt: new Date(), interval: 1, easeFactor: 2.5, repetitions: 0 },
  });
  return toRow(row);
}

// SM-2 spaced repetition algorithm
export async function recordReview(itemId: string, outcome: "easy" | "okay" | "hard"): Promise<ReviewItem> {
  const row = await ReviewGardenItem.findByPk(itemId);
  if (!row) throw new Error("Review item not found");

  const q = outcome === "easy" ? 5 : outcome === "okay" ? 3 : 1;
  let ef = parseFloat(String(row.easeFactor));
  let reps = row.repetitions as number;
  let interval = row.interval as number;

  if (q >= 3) {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ef);
    reps += 1;
  } else {
    reps = 0;
    interval = 1;
  }

  ef = Math.max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));

  const nextReviewAt = new Date(Date.now() + interval * 86400000);
  await row.update({ easeFactor: ef, repetitions: reps, interval, nextReviewAt });
  return toRow(row);
}

function toRow(r: any): ReviewItem {
  return {
    id: r.id,
    childProfileId: r.childProfileId,
    conceptTag: r.conceptTag,
    activitySlug: r.activitySlug || null,
    nextReviewAt: new Date(r.nextReviewAt).toISOString(),
    interval: r.interval,
    easeFactor: parseFloat(String(r.easeFactor)),
    repetitions: r.repetitions,
  };
}
