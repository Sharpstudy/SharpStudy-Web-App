// Server-side verification of a Google ID token (OpenID Connect). Nothing the browser says about the person is trusted: the token's
// RS256 signature is checked against Google's published signing keys, and the issuer, audience (OUR client id) and expiry are enforced.
// Uses the already-installed `jsonwebtoken` and Node's `crypto`; no new dependency.
//
// Env: GOOGLE_CLIENT_ID (the OAuth "Web application" client id; public, also exposed to the page as NEXT_PUBLIC_GOOGLE_CLIENT_ID).
// This sign-in flow (Google Identity Services -> ID token) does not need the client SECRET; GOOGLE_CLIENT_SECRET is only for a
// redirect / authorization-code flow, which this project does not use.
import jwt from "jsonwebtoken";
import { createPublicKey } from "node:crypto";

export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

let cache = { keys: null, until: 0 };

// -> { [kid]: jwk }. Cached for Google's max-age (default 1h). `fetchImpl` is injectable for tests.
export async function googleKeys({ fetchImpl = globalThis.fetch, now = Date.now(), force = false } = {}) {
	if (!force && cache.keys && cache.until > now) return cache.keys;
	const res = await fetchImpl(GOOGLE_CERTS_URL);
	if (!res || !res.ok) throw new Error("could not load Google signing keys");
	const body = await res.json();
	const map = {};
	for (const k of body.keys || []) if (k && k.kid) map[k.kid] = k;
	const m = /max-age=(\d+)/.exec((res.headers && res.headers.get && res.headers.get("cache-control")) || "");
	cache = { keys: map, until: now + (m ? Number(m[1]) : 3600) * 1000 };
	return map;
}
export const resetGoogleKeyCache = () => (cache = { keys: null, until: 0 });

// -> { sub, email, email_verified, given_name, family_name } or throws Error("invalid_google_token"). Never returns unverified data.
export async function verifyGoogleIdToken(idToken, { clientId = process.env.GOOGLE_CLIENT_ID, getKeys = googleKeys } = {}) {
	if (!clientId) throw new Error("google_not_configured");
	if (typeof idToken !== "string" || idToken.length < 20 || idToken.length > 4096) throw new Error("invalid_google_token");
	const decoded = jwt.decode(idToken, { complete: true });
	if (!decoded || !decoded.header || decoded.header.alg !== "RS256" || !decoded.header.kid) throw new Error("invalid_google_token");
	let jwk = (await getKeys())[decoded.header.kid];
	if (!jwk) jwk = (await getKeys({ force: true }))[decoded.header.kid]; // keys rotate: one forced refresh before giving up
	if (!jwk) throw new Error("invalid_google_token");
	let payload;
	try {
		const pem = createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "pem" });
		payload = jwt.verify(idToken, pem, { algorithms: ["RS256"], audience: clientId, issuer: GOOGLE_ISSUERS, clockTolerance: 5 });
	} catch (e) {
		throw new Error("invalid_google_token");
	}
	if (!payload.sub || typeof payload.sub !== "string" || typeof payload.email !== "string") throw new Error("invalid_google_token");
	return { sub: payload.sub, email: payload.email, email_verified: payload.email_verified === true || payload.email_verified === "true", given_name: payload.given_name || "", family_name: payload.family_name || "" };
}
