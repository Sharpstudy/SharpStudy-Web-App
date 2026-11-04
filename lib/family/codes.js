// Pairing codes and device secrets. Everything random comes from node:crypto.
//
// A pairing code is 6 characters from a 32-symbol alphabet with no I, O, 0 or 1 (nothing to mix up
// when a child types it): 32^6 ~ 1.07e9 codes. Only an HMAC of the code is stored, so a database
// leak does not reveal live codes. Guessing is bounded by the short expiry, single use, rate
// limits on redeeming, and the fact that a redeemed code still needs a parent's approval.

import crypto from "node:crypto";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

const secret = () => {
	const s = process.env.JWT_SECRET;
	if (!s) throw new Error("JWT_SECRET is not configured");
	return s;
};

export function generateCode() {
	let out = "";
	for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
	return out;
}

// "k7q-4m2", " K7Q 4M2 " -> "K7Q4M2"; anything else -> null.
export function normalizeCode(input) {
	if (typeof input !== "string" || input.length > 32) return null;
	const c = input.toUpperCase().replace(/[\s-]/g, "");
	if (c.length !== CODE_LENGTH) return null;
	for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
	return c;
}

export const formatCode = (code) => `${code.slice(0, 3)}-${code.slice(3)}`;

export const hashCode = (code) => crypto.createHmac("sha256", secret()).update(`fam-code:${code}`).digest("hex");

// A device proves itself with "<deviceId>.<secret>"; only sha256(secret) is stored (the secret is 256 random bits).
export function newDeviceSecret() {
	const sec = crypto.randomBytes(32).toString("base64url");
	return { secret: sec, hash: hashSecret(sec) };
}
export const hashSecret = (sec) => crypto.createHash("sha256").update(String(sec)).digest("hex");

export function parseDeviceToken(token) {
	if (typeof token !== "string" || token.length > 200) return null;
	const i = token.indexOf(".");
	if (i < 30 || i > 40) return null;
	return { id: token.slice(0, i), secret: token.slice(i + 1) };
}

export function safeEqualHex(a, b) {
	const x = Buffer.from(String(a), "hex");
	const y = Buffer.from(String(b), "hex");
	return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// "iPad · Safari" from a User-Agent. Coarse on purpose: it is a label for the parent, not a fingerprint.
export function deviceLabel(ua) {
	const s = String(ua || "").slice(0, 300);
	const os = /iPad/.test(s) ? "iPad" : /iPhone/.test(s) ? "iPhone" : /Android/.test(s) ? (/Mobile/.test(s) ? "Android phone" : "Android tablet") : /Windows/.test(s) ? "Windows PC" : /Macintosh|Mac OS X/.test(s) ? "Mac" : /CrOS/.test(s) ? "Chromebook" : /Linux/.test(s) ? "Linux PC" : "Device";
	const browser = /Edg\//.test(s) ? "Edge" : /CriOS|Chrome\//.test(s) ? "Chrome" : /FxiOS|Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "";
	return browser ? `${os} · ${browser}` : os;
}

// ---- parent link codes (instructor/admin -> parent) ----
// 8 characters from the same alphabet (32^8 ~ 1.1e12), valid for days rather than minutes, so they are longer
// than pairing codes and hashed under a different label (a pairing code can never be redeemed as a link code).
export const LINK_CODE_LENGTH = 8;

export function generateLinkCode() {
	let out = "";
	for (let i = 0; i < LINK_CODE_LENGTH; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
	return out;
}

export function normalizeLinkCode(input) {
	if (typeof input !== "string" || input.length > 40) return null;
	const c = input.toUpperCase().replace(/[\s-]/g, "");
	if (c.length !== LINK_CODE_LENGTH) return null;
	for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
	return c;
}

export const formatLinkCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

export const hashLinkCode = (code) => crypto.createHmac("sha256", secret()).update(`fam-link:${code}`).digest("hex");
