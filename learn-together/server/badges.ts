import { FamilyBadge } from "./models";

export interface BadgeRow {
  id: string;
  familyId: string;
  childProfileId: string | null;
  badgeKey: string;
  earnedAt: string;
  metadata: Record<string, unknown> | null;
}

export async function getFamilyBadges(familyId: string): Promise<BadgeRow[]> {
  const rows = await FamilyBadge.findAll({ where: { familyId }, order: [["earned_at", "DESC"]] });
  return rows.map(toRow);
}

export async function awardBadge(
  familyId: string,
  badgeKey: string,
  childProfileId?: string | null,
  metadata?: Record<string, unknown>
): Promise<BadgeRow> {
  const row = await FamilyBadge.create({
    familyId,
    badgeKey,
    childProfileId: childProfileId || null,
    earnedAt: new Date(),
    metadata: metadata || null,
  });
  return toRow(row);
}

function toRow(r: any): BadgeRow {
  return {
    id: r.id,
    familyId: r.familyId,
    childProfileId: r.childProfileId || null,
    badgeKey: r.badgeKey,
    earnedAt: new Date(r.earnedAt).toISOString(),
    metadata: r.metadata || null,
  };
}
