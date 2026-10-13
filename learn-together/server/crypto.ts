import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

// No 0/O/1/I/L to avoid misreads when a child types the code.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function pairingCode(length = 6): string {
  let s = "";
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function secret(): string {
  const s = process.env.LT_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("LT_SECRET or JWT_SECRET must be set");
  return s;
}

export function sign(payload: string): string {
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}

export function verifySigned(value: string | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const payload = value.slice(0, i);
  const expected = Buffer.from(sign(payload).slice(i + 1));
  const got = Buffer.from(value.slice(i + 1));
  return expected.length === got.length && timingSafeEqual(expected, got) ? payload : null;
}

/** Stable pseudonymous key for analytics (distinct-family counts without raw ids). */
export const familyKey = (familyId: string) => createHmac("sha256", secret()).update(`family:${familyId}`).digest("hex").slice(0, 32);
