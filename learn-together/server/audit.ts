import { AuditLog } from "./models";

export type Actor = { type: "user"; id: string } | { type: "child_device"; id: string } | { type: "system" };

/** Records who did what. Never pass nicknames, notes or response values in before/after. */
export async function audit(actor: Actor, action: string, entityType: string, entityId?: string | null, before?: unknown, after?: unknown) {
  await AuditLog.create({
    actorType: actor.type,
    actorId: "id" in actor ? actor.id : null,
    action,
    entityType,
    entityId: entityId || null,
    before: before ?? null,
    after: after ?? null,
    at: new Date(),
  });
}
