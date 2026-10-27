import { ChildReflection } from "./models";

export interface ReflectionRow {
  id: string;
  childProfileId: string;
  sessionId: string | null;
  text: string;
  mood: "great" | "good" | "okay" | "hard";
  createdAt: string;
}

export async function getReflections(childProfileId: string, limit = 20): Promise<ReflectionRow[]> {
  const rows = await ChildReflection.findAll({
    where: { childProfileId },
    order: [["created_at", "DESC"]],
    limit,
  });
  return rows.map(toRow);
}

export async function addReflection(
  childProfileId: string,
  sessionId: string | null,
  text: string,
  mood: "great" | "good" | "okay" | "hard"
): Promise<ReflectionRow> {
  const row = await ChildReflection.create({ childProfileId, sessionId, text, mood });
  return toRow(row);
}

function toRow(r: any): ReflectionRow {
  return {
    id: r.id,
    childProfileId: r.childProfileId,
    sessionId: r.sessionId || null,
    text: r.text,
    mood: r.mood,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}
