// Parent data controls: export and delete everything Learn Together holds for a family.
import { Op } from "sequelize";
import { AnalyticsEvent, ChildDevice, ChildProfile, DismissedActivity, Family, FamilyMember, Feedback, KitInterest, SavedActivity } from "./models";
import { HttpError } from "./errors";
import type { ParentPrincipal } from "./auth";
import { exportChild } from "./progress";
import { audit } from "./audit";
import { familyKey } from "./crypto";
import { channels } from "@/learn-together/domain/sync";
import { makeEvent, publish } from "./realtime";

export async function exportFamily(p: ParentPrincipal) {
  const [family, members, children, devices, saved, dismissed, kits, feedback] = await Promise.all([
    Family.findByPk(p.familyId),
    FamilyMember.findAll({ where: { familyId: p.familyId } }),
    ChildProfile.findAll({ where: { familyId: p.familyId } }),
    ChildDevice.findAll({ where: { familyId: p.familyId } }),
    SavedActivity.findAll({ where: { familyId: p.familyId } }),
    DismissedActivity.findAll({ where: { familyId: p.familyId } }),
    KitInterest.findAll({ where: { userId: p.userId } }),
    Feedback.findAll({ where: { userId: p.userId } }),
  ]);
  await audit({ type: "user", id: p.userId }, "family.exported", "lt_family", p.familyId);
  return {
    exportedAt: new Date().toISOString(),
    family: { name: family?.name, createdAt: family?.created_at, hasPin: !!family?.familyPinHash },
    members: members.map((m) => ({ role: m.role, isYou: m.userId === p.userId, joinedAt: m.joinedAt })),
    devices: devices.map((d) => ({ label: d.label, pairedAt: d.pairedAt, lastSeenAt: d.lastSeenAt, revokedAt: d.revokedAt })),
    children: await Promise.all(children.map((c) => exportChild(p, c.id))),
    savedActivities: saved.map((s) => s.activityId),
    dismissedActivities: dismissed.map((s) => s.activityId),
    yourKitInterest: kits.map((k) => ({ kit: k.kitKey, at: k.at })),
    yourFeedback: feedback.map((f) => ({ kind: f.kind, rating: f.rating, note: f.note, at: f.created_at })),
  };
}

/** Deletes the whole family's Learn Together data (owner only, after re-auth). Cascades via FKs. */
export async function deleteFamilyData(p: ParentPrincipal) {
  if (p.familyRole !== "owner") throw new HttpError(403, "Only the family owner can delete family data");
  const children = await ChildProfile.findAll({ where: { familyId: p.familyId }, attributes: ["id"] });
  const memberIds = (await FamilyMember.findAll({ where: { familyId: p.familyId } })).map((m) => m.userId);
  await Family.destroy({ where: { id: p.familyId } });
  await KitInterest.destroy({ where: { userId: { [Op.in]: memberIds } } });
  await Feedback.destroy({ where: { userId: { [Op.in]: memberIds } } });
  await AnalyticsEvent.destroy({ where: { familyKey: familyKey(p.familyId) } });
  for (const c of children) await publish(channels.child(c.id), makeEvent("device.revoked", 0, {}));
  await audit({ type: "user", id: p.userId }, "family.deleted", "lt_family", p.familyId, null, { children: children.length });
}
