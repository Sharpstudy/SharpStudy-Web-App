import bcrypt from "bcrypt";
import { z } from "zod";
import { Op, QueryTypes } from "sequelize";
import {
  CaregiverInvite,
  ChildDevice,
  ChildDeviceProfile,
  ChildProfile,
  Family,
  FamilyMember,
  sequelize,
} from "./models";
import { HttpError, notFound } from "./errors";
import type { ParentPrincipal } from "./auth";
import { audit } from "./audit";
import { track } from "./analytics";
import { randomToken, sha256 } from "./crypto";
import { publish, makeEvent } from "./realtime";
import { channels } from "@/learn-together/domain/sync";

export const AVATARS = ["fox", "owl", "cat", "bear", "panda", "frog", "rabbit", "tiger", "koala", "penguin", "lion", "whale"] as const;
export const PICTURE_ICONS = ["star", "moon", "sun", "apple", "fish", "tree", "car", "ball", "heart"] as const;
export const INTERESTS = ["math", "science", "building", "nature", "cooking", "shopping", "sports", "art"] as const;

// Nicknames only: no emails, phone numbers or long digit strings.
const nickname = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((s) => !/@/.test(s) && !/\d{5,}/.test(s), "Use a first name or nickname only");

export const childInput = z.object({
  nickname,
  avatarKey: z.enum(AVATARS),
  ageBand: z.enum(["6-7", "7-8", "8-9"]),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("en"),
  readAloud: z.boolean().default(false),
  largeText: z.boolean().default(false),
  reducedMotion: z.boolean().default(false),
  subjectInterests: z.array(z.enum(INTERESTS)).max(8).default([]),
});
export const childPatch = childInput.partial();

export const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits");

export function publicChild(c: any) {
  return {
    id: c.id,
    nickname: c.nickname,
    avatarKey: c.avatarKey,
    ageBand: c.ageBand,
    language: c.language,
    readAloud: !!c.readAloud,
    largeText: !!c.largeText,
    reducedMotion: !!c.reducedMotion,
    subjectInterests: c.subjectInterests || [],
    hasPictureCode: !!c.pictureCodeHash,
  };
}

export async function getFamilyOverview(p: ParentPrincipal) {
  if (!p.familyId) return { family: null, children: [], members: [], invites: [] };
  const [family, children, members, invites] = await Promise.all([
    Family.findByPk(p.familyId),
    ChildProfile.findAll({ where: { familyId: p.familyId }, order: [["created_at", "ASC"]] }),
    FamilyMember.findAll({ where: { familyId: p.familyId } }),
    CaregiverInvite.findAll({ where: { familyId: p.familyId, acceptedAt: null, revokedAt: null, expiresAt: { [Op.gt]: new Date() } } }),
  ]);
  const users = members.length
    ? ((await sequelize.query("SELECT id, first_name, email FROM users WHERE id IN (?)", { replacements: [members.map((m) => m.userId)], type: QueryTypes.SELECT })) as any[])
    : [];
  return {
    family: family && { id: family.id, name: family.name, hasPin: !!family.familyPinHash },
    children: children.map(publicChild),
    members: members.map((m) => {
      const u = users.find((x) => x.id === m.userId);
      return { userId: m.userId, role: m.role, firstName: u?.first_name || "", email: u?.email || "", isYou: m.userId === p.userId };
    }),
    invites: invites.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt })),
  };
}

export async function createFamily(p: ParentPrincipal, name: string) {
  if (p.familyId) throw new HttpError(409, "You already have a family");
  const t = await sequelize.transaction();
  try {
    const family = await Family.create({ name: name.trim().slice(0, 80) || `${p.firstName}'s family`, createdByUserId: p.userId }, { transaction: t });
    await FamilyMember.create({ familyId: family.id, userId: p.userId, role: "owner", joinedAt: new Date() }, { transaction: t });
    await t.commit();
    await audit({ type: "user", id: p.userId }, "family.created", "lt_family", family.id);
    return family.id as string;
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

export async function setFamilyPin(p: ParentPrincipal, pin: string, opts: { reauthed: boolean }) {
  const family = await Family.findByPk(p.familyId);
  if (!family) throw notFound();
  const hadPin = !!family.familyPinHash;
  if (hadPin && !opts.reauthed) throw new HttpError(401, "Please confirm your password to change the PIN", "reauth_required");
  await family.update({ familyPinHash: await bcrypt.hash(pinSchema.parse(pin), 10), pinFailedAttempts: 0, pinLockedUntil: null });
  await audit({ type: "user", id: p.userId }, hadPin ? "family.pin_changed" : "family.pin_set", "lt_family", family.id);
}

const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;

/** Checks the family PIN (used on child devices to leave child mode). */
export async function verifyFamilyPin(familyId: string, pin: string): Promise<boolean> {
  const family = await Family.findByPk(familyId);
  if (!family || !family.familyPinHash) return false;
  if (family.pinLockedUntil && new Date(family.pinLockedUntil).getTime() > Date.now())
    throw new HttpError(429, "Too many tries. Ask your grown-up to wait a few minutes.", "pin_locked");
  const ok = await bcrypt.compare(String(pin), family.familyPinHash);
  if (ok) await family.update({ pinFailedAttempts: 0, pinLockedUntil: null });
  else {
    const fails = (family.pinFailedAttempts || 0) + 1;
    await family.update({ pinFailedAttempts: fails >= PIN_MAX_FAILS ? 0 : fails, pinLockedUntil: fails >= PIN_MAX_FAILS ? new Date(Date.now() + PIN_LOCK_MS) : null });
  }
  return ok;
}

export async function getChildForFamily(familyId: string, childId: string) {
  const c = await ChildProfile.findOne({ where: { id: childId, familyId } });
  if (!c) throw notFound();
  return c;
}

export async function createChild(p: ParentPrincipal, input: unknown) {
  const data = childInput.parse(input);
  const count = await ChildProfile.count({ where: { familyId: p.familyId } });
  if (count >= 8) throw new HttpError(422, "A family can have up to 8 children");
  const c = await ChildProfile.create({ ...data, familyId: p.familyId });
  await audit({ type: "user", id: p.userId }, "child.created", "lt_child_profile", c.id);
  await track("lt_child_profile_created", {}, { familyId: p.familyId });
  return publicChild(c);
}

export async function updateChild(p: ParentPrincipal, childId: string, input: unknown) {
  const c = await getChildForFamily(p.familyId, childId);
  await c.update(childPatch.parse(input));
  await audit({ type: "user", id: p.userId }, "child.updated", "lt_child_profile", c.id);
  return publicChild(c);
}

export async function setPictureCode(p: ParentPrincipal, childId: string, code: string[] | null) {
  const c = await getChildForFamily(p.familyId, childId);
  if (code === null) await c.update({ pictureCodeHash: null, pictureCodeFailed: 0, pictureCodeLockedUntil: null });
  else {
    const parsed = z.array(z.enum(PICTURE_ICONS)).length(3).parse(code);
    await c.update({ pictureCodeHash: await bcrypt.hash(parsed.join("-"), 10), pictureCodeFailed: 0, pictureCodeLockedUntil: null });
  }
  await audit({ type: "user", id: p.userId }, code ? "child.picture_code_set" : "child.picture_code_cleared", "lt_child_profile", c.id);
}

/**
 * Deletes a child and everything about them. FK cascades remove sessions, responses, observations,
 * progress, signals and device links. Devices left with no children are revoked.
 */
export async function deleteChild(p: ParentPrincipal, childId: string) {
  const c = await getChildForFamily(p.familyId, childId);
  const links = await ChildDeviceProfile.findAll({ where: { childProfileId: c.id } });
  const deviceIds = links.map((l) => l.childDeviceId);
  await c.destroy();
  const revoked: string[] = [];
  for (const deviceId of deviceIds) {
    const remaining = await ChildDeviceProfile.count({ where: { childDeviceId: deviceId } });
    if (remaining === 0) {
      await ChildDevice.update({ revokedAt: new Date(), deviceTokenHash: null }, { where: { id: deviceId } });
      revoked.push(deviceId);
      await publish(channels.child(c.id), makeEvent("device.revoked", 0, { deviceId }));
    }
  }
  await audit({ type: "user", id: p.userId }, "child.deleted", "lt_child_profile", c.id, null, { revokedDevices: revoked.length });
  return { revokedDevices: revoked.length };
}

export async function listDevices(familyId: string) {
  const devices = await ChildDevice.findAll({ where: { familyId, revokedAt: null, deviceTokenHash: { [Op.ne]: null } }, order: [["paired_at", "DESC"]] });
  const links = devices.length ? await ChildDeviceProfile.findAll({ where: { childDeviceId: devices.map((d) => d.id) } }) : [];
  const now = Date.now();
  return devices.map((d) => ({
    id: d.id,
    label: d.label,
    pairedAt: d.pairedAt,
    lastSeenAt: d.lastSeenAt,
    online: !!d.lastSeenAt && now - new Date(d.lastSeenAt).getTime() < ONLINE_WINDOW_MS,
    childProfileIds: links.filter((l) => l.childDeviceId === d.id).map((l) => l.childProfileId),
  }));
}

export const ONLINE_WINDOW_MS = 45 * 1000;

export async function revokeDevice(p: ParentPrincipal, deviceId: string) {
  const d = await ChildDevice.findOne({ where: { id: deviceId, familyId: p.familyId } });
  if (!d) throw notFound();
  if (d.revokedAt) return;
  const links = await ChildDeviceProfile.findAll({ where: { childDeviceId: d.id } });
  await d.update({ revokedAt: new Date(), deviceTokenHash: null });
  await audit({ type: "user", id: p.userId }, "device.revoked", "lt_child_device", d.id);
  await track("lt_device_revoked", {}, { familyId: p.familyId });
  for (const l of links) await publish(channels.child(l.childProfileId), makeEvent("device.revoked", 0, { deviceId: d.id }));
}

// ---------- Caregiver invites ----------
const INVITE_TTL_MS = 7 * 86400000;

export async function createInvite(p: ParentPrincipal, email: string) {
  const parsed = z.string().trim().toLowerCase().email().parse(email);
  const token = randomToken(24);
  const invite = await CaregiverInvite.create({
    familyId: p.familyId,
    email: parsed,
    tokenHash: sha256(token),
    invitedByUserId: p.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  await audit({ type: "user", id: p.userId }, "caregiver.invited", "lt_caregiver_invite", invite.id);
  return { inviteId: invite.id as string, token, email: parsed };
}

export async function acceptInvite(p: ParentPrincipal, token: string) {
  const invite = await CaregiverInvite.findOne({ where: { tokenHash: sha256(token), acceptedAt: null, revokedAt: null } });
  if (!invite || new Date(invite.expiresAt).getTime() < Date.now()) throw new HttpError(410, "This invite has expired or was already used");
  if (p.familyId && p.familyId !== invite.familyId) throw new HttpError(409, "You're already part of another family");
  if (invite.email !== p.email.toLowerCase()) throw new HttpError(403, "This invite was sent to a different email address");
  if (!p.familyId) await FamilyMember.create({ familyId: invite.familyId, userId: p.userId, role: "caregiver", invitedAt: invite.created_at, joinedAt: new Date() });
  await invite.update({ acceptedAt: new Date(), acceptedByUserId: p.userId });
  await audit({ type: "user", id: p.userId }, "caregiver.joined", "lt_family", invite.familyId);
  return invite.familyId as string;
}

export async function revokeInvite(p: ParentPrincipal, inviteId: string) {
  const n = await CaregiverInvite.update({ revokedAt: new Date() }, { where: { id: inviteId, familyId: p.familyId } });
  if (!n[0]) throw notFound();
  await audit({ type: "user", id: p.userId }, "caregiver.invite_revoked", "lt_caregiver_invite", inviteId);
}

export async function removeMember(p: ParentPrincipal, userId: string) {
  if (userId === p.userId) throw new HttpError(422, "You can't remove yourself as the owner");
  const n = await FamilyMember.destroy({ where: { familyId: p.familyId, userId, role: "caregiver" } });
  if (!n) throw notFound();
  await audit({ type: "user", id: p.userId }, "caregiver.removed", "lt_family", p.familyId, { userId });
}
