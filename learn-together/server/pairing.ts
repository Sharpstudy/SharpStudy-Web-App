// Parent-approved device pairing. Child devices never hold a password or an account; the
// credential they receive is an opaque token whose hash is the only thing stored.
import type { IncomingMessage, ServerResponse } from "http";
import { z } from "zod";
import { Op } from "sequelize";
import { ChildDevice, ChildDeviceProfile, ChildProfile, PairingRequest, sequelize } from "./models";
import { HttpError, notFound } from "./errors";
import { CLAIM_COOKIE, DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, clearCookie, readCookie, setCookie, type ParentPrincipal } from "./auth";
import { normalizeCode, pairingCode, randomToken, sha256 } from "./crypto";
import { clientIp, rateLimit } from "./rateLimit";
import { audit } from "./audit";
import { track } from "./analytics";
import { makeEvent, publish } from "./realtime";
import { channels } from "@/learn-together/domain/sync";

export const PAIRING_TTL_MS = 10 * 60 * 1000;
const APPROVAL_GRACE_MS = 10 * 60 * 1000;
export const MAX_WRONG_CODES = 5;

export async function startPairing(p: ParentPrincipal, childProfileIds: string[]) {
  const ids = z.array(z.string().uuid()).min(1).max(8).parse(childProfileIds);
  const owned = await ChildProfile.count({ where: { id: ids, familyId: p.familyId } });
  if (owned !== new Set(ids).size) throw notFound();
  await rateLimit(`pair-start:${p.userId}`, 10, 3600);

  let code = pairingCode();
  for (let i = 0; i < 5; i++) {
    const clash = await PairingRequest.count({ where: { codeHash: sha256(code), expiresAt: { [Op.gt]: new Date() }, claimedAt: null } });
    if (!clash) break;
    code = pairingCode();
  }
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const r = await PairingRequest.create({ familyId: p.familyId, codeHash: sha256(code), childProfileIds: [...new Set(ids)], createdByUserId: p.userId, expiresAt });
  await audit({ type: "user", id: p.userId }, "pairing.started", "lt_pairing_request", r.id, null, { children: ids.length });
  await track("lt_pairing_started", { childCount: ids.length }, { familyId: p.familyId });
  return { requestId: r.id as string, code, expiresAt };
}

function guessDeviceLabel(req: IncomingMessage) {
  const ua = String(req.headers["user-agent"] || "");
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/CrOS/.test(ua)) return "Chromebook";
  return "Computer";
}

/**
 * Child device enters a code. A wrong code can't be attributed to a specific request, so wrong
 * attempts are limited per client (5 per 15 minutes); a request is also locked once it has been
 * claimed, so a code works exactly once.
 */
export async function claimPairing(req: IncomingMessage, res: ServerResponse, rawCode: string) {
  const ip = clientIp(req as never);
  await rateLimit(`pair-claim:${ip}`, 30, 600);
  const code = normalizeCode(z.string().max(20).parse(rawCode));
  const r = code.length === 6
    ? await PairingRequest.findOne({ where: { codeHash: sha256(code), expiresAt: { [Op.gt]: new Date() }, claimedAt: null, deniedAt: null, lockedAt: null } })
    : null;
  if (!r) {
    await rateLimit(`pair-wrong:${ip}`, MAX_WRONG_CODES, 900);
    throw new HttpError(404, "That code didn't work. Check it with your grown-up.", "bad_code");
  }
  const claimToken = randomToken();
  await r.update({ claimTokenHash: sha256(claimToken), claimedAt: new Date(), claimedDeviceLabel: guessDeviceLabel(req) });
  setCookie(req, res, CLAIM_COOKIE, claimToken, Math.ceil((PAIRING_TTL_MS + APPROVAL_GRACE_MS) / 1000));
  await audit({ type: "system" }, "pairing.claimed", "lt_pairing_request", r.id);
  await publish(channels.family(r.familyId), makeEvent("pairing.claimed", 0, { requestId: r.id }));
  return { status: "waiting_for_approval" as const };
}

export async function pendingApprovals(familyId: string) {
  const rows = await PairingRequest.findAll({
    where: { familyId, claimedAt: { [Op.ne]: null }, approvedAt: null, deniedAt: null, expiresAt: { [Op.gt]: new Date(Date.now() - APPROVAL_GRACE_MS) } },
    order: [["claimed_at", "DESC"]],
  });
  const childIds = [...new Set(rows.flatMap((r) => r.childProfileIds as string[]))];
  const children = childIds.length ? await ChildProfile.findAll({ where: { id: childIds, familyId } }) : [];
  return rows.map((r) => ({
    requestId: r.id,
    claimedAt: r.claimedAt,
    deviceLabelSuggestion: r.claimedDeviceLabel,
    children: (r.childProfileIds as string[]).map((id) => children.find((c) => c.id === id)).filter(Boolean).map((c) => ({ id: c!.id, nickname: c!.nickname, avatarKey: c!.avatarKey })),
  }));
}

export async function getPairingStatus(familyId: string, requestId: string) {
  const r = await PairingRequest.findOne({ where: { id: requestId, familyId } });
  if (!r) throw notFound();
  const status = r.deniedAt ? "denied" : r.approvedAt ? (r.deliveredAt ? "paired" : "approved") : r.claimedAt ? "claimed" : new Date(r.expiresAt).getTime() < Date.now() ? "expired" : "waiting";
  return { status, expiresAt: r.expiresAt };
}

async function resolvable(p: ParentPrincipal, requestId: string) {
  const r = await PairingRequest.findOne({ where: { id: requestId, familyId: p.familyId } });
  if (!r || !r.claimedAt || r.approvedAt || r.deniedAt) throw notFound();
  if (new Date(r.expiresAt).getTime() + APPROVAL_GRACE_MS < Date.now()) throw new HttpError(410, "This request expired. Start pairing again.");
  return r;
}

export async function approvePairing(p: ParentPrincipal, requestId: string, label: string) {
  const deviceLabel = z.string().trim().min(1).max(60).parse(label);
  const r = await resolvable(p, requestId);
  const t = await sequelize.transaction();
  try {
    const device = await ChildDevice.create({ familyId: p.familyId, label: deviceLabel, pairedByUserId: p.userId }, { transaction: t });
    // Only children that still exist in this family.
    const kids = await ChildProfile.findAll({ where: { id: r.childProfileIds as string[], familyId: p.familyId }, transaction: t });
    for (const k of kids) await ChildDeviceProfile.create({ childDeviceId: device.id, childProfileId: k.id }, { transaction: t });
    await r.update({ approvedAt: new Date(), approvedByUserId: p.userId, childDeviceId: device.id }, { transaction: t });
    await t.commit();
    await audit({ type: "user", id: p.userId }, "pairing.approved", "lt_child_device", device.id, null, { children: kids.length });
    await track("lt_pairing_approved", { childCount: kids.length }, { familyId: p.familyId });
    await publish(channels.family(p.familyId), makeEvent("pairing.resolved", 0, { requestId, approved: true }));
    return { deviceId: device.id as string };
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

export async function denyPairing(p: ParentPrincipal, requestId: string) {
  const r = await resolvable(p, requestId);
  await r.update({ deniedAt: new Date() });
  await audit({ type: "user", id: p.userId }, "pairing.denied", "lt_pairing_request", r.id);
  await track("lt_pairing_denied", {}, { familyId: p.familyId });
  await publish(channels.family(p.familyId), makeEvent("pairing.resolved", 0, { requestId, approved: false }));
}

/** Child device polls with its claim cookie; on approval it receives the device credential once. */
export async function claimStatus(req: IncomingMessage, res: ServerResponse) {
  const claim = readCookie(req, CLAIM_COOKIE);
  if (!claim) return { status: "none" as const };
  const r = await PairingRequest.findOne({ where: { claimTokenHash: sha256(claim) } });
  if (!r) {
    clearCookie(req, res, CLAIM_COOKIE);
    return { status: "none" as const };
  }
  if (r.deniedAt) {
    clearCookie(req, res, CLAIM_COOKIE);
    return { status: "denied" as const };
  }
  if (r.approvedAt && r.childDeviceId && !r.deliveredAt) {
    const token = randomToken();
    const [updated] = await PairingRequest.update({ deliveredAt: new Date() }, { where: { id: r.id, deliveredAt: null } });
    if (!updated) return { status: "none" as const }; // a concurrent poll already took it
    await ChildDevice.update({ deviceTokenHash: sha256(token), pairedAt: new Date(), lastSeenAt: new Date() }, { where: { id: r.childDeviceId, revokedAt: null } });
    clearCookie(req, res, CLAIM_COOKIE);
    setCookie(req, res, DEVICE_COOKIE, token, DEVICE_COOKIE_MAX_AGE);
    await audit({ type: "child_device", id: r.childDeviceId }, "pairing.delivered", "lt_child_device", r.childDeviceId);
    return { status: "paired" as const };
  }
  if (new Date(r.expiresAt).getTime() + APPROVAL_GRACE_MS < Date.now()) {
    clearCookie(req, res, CLAIM_COOKIE);
    return { status: "expired" as const };
  }
  return { status: "waiting_for_approval" as const };
}
