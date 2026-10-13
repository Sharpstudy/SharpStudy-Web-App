// Two separate principals:
//  - Parent: the existing Sharp Study JWT (Authorization header, same as the rest of the app).
//  - Child device: an opaque httpOnly cookie, hashed server-side. Never accepted on parent routes.
import type { IncomingMessage, ServerResponse } from "http";
import jwt from "jsonwebtoken";
import { Op } from "sequelize";
import User from "@/database/models/user";
import { ChildDevice, ChildDeviceProfile, FamilyMember, RoleAssignment } from "./models";
import { sha256, sign, verifySigned } from "./crypto";
import { HttpError } from "./errors";
import { audit } from "./audit";

export type LtRole = "lt_editor" | "lt_reviewer" | "lt_admin";

export interface ParentPrincipal {
  userId: string;
  email: string;
  firstName: string;
  role: string; // users.role
  ltRoles: LtRole[];
  familyId: string; // "" when the user has no family yet (auth: "user")
  familyRole: "owner" | "caregiver" | null;
}

export interface DevicePrincipal {
  deviceId: string;
  familyId: string;
  label: string;
  childProfileIds: string[];
}

export const DEVICE_COOKIE = "lt_device";
export const CLAIM_COOKIE = "lt_claim";
export const ACTIVE_CHILD_COOKIE = "lt_child";
export const REAUTH_HEADER = "x-lt-reauth";

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  return h.startsWith("Bearer ") ? h.slice(7) : h;
}

export async function parentFromToken(token: string | null | undefined, opts: { requireFamily: boolean }): Promise<ParentPrincipal> {
  if (!token) throw new HttpError(401, "Please sign in");
  let claims: { userId?: string };
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET as string) as { userId?: string };
  } catch {
    throw new HttpError(401, "Please sign in again");
  }
  const user = (await (User as any).findOne({ where: { id: claims.userId } })) as any;
  if (!user || user.status === false) throw new HttpError(401, "Please sign in again");

  const [roles, member] = await Promise.all([
    RoleAssignment.findAll({ where: { userId: user.id } }),
    FamilyMember.findOne({ where: { userId: user.id }, order: [["created_at", "ASC"]] }),
  ]);
  const ltRoles = roles.map((r) => r.role as LtRole);
  if (user.role === "admin" && !ltRoles.includes("lt_admin")) ltRoles.push("lt_admin");
  if (opts.requireFamily && !member) throw new HttpError(409, "Set up your family first", "no_family");
  return {
    userId: user.id,
    email: user.email,
    firstName: user.first_name,
    role: user.role,
    ltRoles,
    familyId: member?.familyId || "",
    familyRole: (member?.role as ParentPrincipal["familyRole"]) || null,
  };
}

export function requireParent(req: IncomingMessage, opts: { requireFamily: boolean }) {
  return parentFromToken(bearer(req), opts);
}

export function requireLtRole(p: ParentPrincipal, roles: LtRole[]) {
  if (p.ltRoles.includes("lt_admin")) return;
  if (!roles.some((r) => p.ltRoles.includes(r))) throw new HttpError(403, "You don't have access to this area");
}

export function requireOwner(p: ParentPrincipal) {
  if (p.familyRole !== "owner") throw new HttpError(403, "Only the family owner can do this");
}

// ---------- Re-authentication for sensitive actions ----------
const REAUTH_TTL_MS = 10 * 60 * 1000;
export const issueReauth = (userId: string) => sign(`reauth:${userId}:${Date.now() + REAUTH_TTL_MS}`);
export function requireReauth(req: IncomingMessage, p: ParentPrincipal) {
  const raw = req.headers[REAUTH_HEADER];
  const payload = verifySigned(Array.isArray(raw) ? raw[0] : raw);
  const [, uid, exp] = (payload || "").split(":");
  if (uid !== p.userId || !exp || Number(exp) < Date.now())
    throw new HttpError(401, "Please confirm your password to continue", "reauth_required");
}

// ---------- Cookies ----------
export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function isSecure(req: IncomingMessage) {
  return process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";
}

export function setCookie(req: IncomingMessage, res: ServerResponse, name: string, value: string, maxAgeSeconds: number) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`];
  if (isSecure(req)) parts.push("Secure");
  const prev = res.getHeader("Set-Cookie");
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  res.setHeader("Set-Cookie", [...list, parts.join("; ")]);
}

export const clearCookie = (req: IncomingMessage, res: ServerResponse, name: string) => setCookie(req, res, name, "", 0);

/** CSRF defence for cookie-authenticated child-device requests (in addition to SameSite=Strict). */
export function assertSameOrigin(req: IncomingMessage) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  if (origin) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    try {
      if (new URL(origin).host !== host) throw new Error();
    } catch {
      throw new HttpError(403, "Cross-site request blocked");
    }
  } else if (site && site !== "same-origin" && site !== "none") {
    throw new HttpError(403, "Cross-site request blocked");
  }
}

// ---------- Child device ----------
export const deviceIdleDays = () => Number(process.env.LT_DEVICE_IDLE_DAYS || 90);
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 3600; // browser cap; server-side idle expiry is authoritative

export async function deviceFromCookie(req: IncomingMessage): Promise<DevicePrincipal | null> {
  const token = readCookie(req, DEVICE_COOKIE);
  if (!token) return null;
  const device = await ChildDevice.findOne({ where: { deviceTokenHash: sha256(token), revokedAt: null } });
  if (!device) return null;

  const now = Date.now();
  const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : new Date(device.pairedAt).getTime();
  if (now - lastSeen > deviceIdleDays() * 86400000) {
    await device.update({ revokedAt: new Date(now) });
    await audit({ type: "system" }, "device.expired", "lt_child_device", device.id);
    return null;
  }
  if (now - lastSeen > 60000) await device.update({ lastSeenAt: new Date(now) });

  const links = await ChildDeviceProfile.findAll({ where: { childDeviceId: device.id } });
  return { deviceId: device.id, familyId: device.familyId, label: device.label, childProfileIds: links.map((l) => l.childProfileId) };
}

export async function requireDevice(req: IncomingMessage, res: ServerResponse): Promise<DevicePrincipal> {
  assertSameOrigin(req);
  const d = await deviceFromCookie(req);
  if (!d) {
    if (readCookie(req, DEVICE_COOKIE)) clearCookie(req, res, DEVICE_COOKIE);
    throw new HttpError(401, "This device isn't connected", "device_unpaired");
  }
  return d;
}

export function requireDeviceChild(d: DevicePrincipal, childProfileId: string) {
  if (!d.childProfileIds.includes(childProfileId)) throw new HttpError(404, "Not found");
}

// Active-child selection on shared devices (signed, short-lived).
const ACTIVE_CHILD_TTL_S = 12 * 3600;
export function setActiveChild(req: IncomingMessage, res: ServerResponse, deviceId: string, childId: string) {
  setCookie(req, res, ACTIVE_CHILD_COOKIE, sign(`${deviceId}:${childId}:${Date.now() + ACTIVE_CHILD_TTL_S * 1000}`), ACTIVE_CHILD_TTL_S);
}
export function activeChild(req: IncomingMessage, d: DevicePrincipal): string | null {
  const payload = verifySigned(readCookie(req, ACTIVE_CHILD_COOKIE));
  if (payload) {
    const [deviceId, childId, exp] = payload.split(":");
    if (deviceId === d.deviceId && Number(exp) > Date.now() && d.childProfileIds.includes(childId)) return childId;
  }
  return d.childProfileIds.length === 1 ? d.childProfileIds[0] : null;
}

export const activeDevicesWhere = () => ({ revokedAt: null, deviceTokenHash: { [Op.ne]: null } });
