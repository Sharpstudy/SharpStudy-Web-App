import { FamilyValue } from "./models";

export interface ValueEntry {
  valueCategory: string;
  importance: number;
}

export async function getFamilyValues(familyId: string): Promise<ValueEntry[]> {
  const rows = await FamilyValue.findAll({ where: { familyId }, order: [["value_category", "ASC"]] });
  return rows.map((r) => ({ valueCategory: r.valueCategory, importance: r.importance }));
}

export async function saveFamilyValues(familyId: string, values: ValueEntry[]): Promise<void> {
  await FamilyValue.destroy({ where: { familyId } });
  if (values.length === 0) return;
  await FamilyValue.bulkCreate(values.map((v) => ({ familyId, valueCategory: v.valueCategory, importance: v.importance })));
}
