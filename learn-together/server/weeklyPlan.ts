import { Op } from "sequelize";
import { WeeklyPlan } from "./models";

export interface WeekPlanItem {
  id: string;
  subject: string;
  dayOfWeek: number;
  lessonSlug: string | null;
  position: number;
  completedAt: string | null;
}

export async function getWeekPlan(
  familyId: string,
  childProfileId: string,
  weekStart: string
): Promise<WeekPlanItem[]> {
  const rows = await WeeklyPlan.findAll({
    where: { familyId, childProfileId, weekStart },
    order: [["day_of_week", "ASC"], ["position", "ASC"]],
  });
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    dayOfWeek: r.dayOfWeek,
    lessonSlug: r.lessonSlug || null,
    position: r.position,
    completedAt: r.completedAt || null,
  }));
}

export async function saveWeekPlan(
  familyId: string,
  childProfileId: string,
  weekStart: string,
  items: { subject: string; dayOfWeek: number; lessonSlug?: string | null; position?: number }[]
): Promise<void> {
  await WeeklyPlan.destroy({ where: { familyId, childProfileId, weekStart } });
  if (items.length === 0) return;
  await WeeklyPlan.bulkCreate(
    items.map((it, i) => ({
      familyId,
      childProfileId,
      weekStart,
      subject: it.subject,
      dayOfWeek: it.dayOfWeek,
      lessonSlug: it.lessonSlug || null,
      position: it.position ?? i,
    }))
  );
}
