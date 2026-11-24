// Forgot / reset password, sign-in guard (generic errors, lockout), token revocation, password policy, and Google sign-in.
// The real modules run against an in-memory repository and a locally generated RSA key standing in for Google's signing key:
// no database, no network, no e-mail, no Google account is involved. (A real Google login is NOT covered by this file.)
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { credentialsRepo, USER } from "./memoryRepo.mjs";
import { requestPasswordReset, resetPassword, hashToken, RESET_TTL_MS, RESET_MIN_INTERVAL_MS, GENERIC_REQUEST_MESSAGE } from "../../lib/auth/passwordReset.js";
import { authenticate, MAX_FAILURES, LOCK_MS, GENERIC_LOGIN_MESSAGE } from "../../lib/auth/signinGuard.js";
import { passwordProblem } from "../../lib/auth/passwordPolicy.js";
import { isTokenRevoked } from "../../lib/auth/tokenRevocation.js";
import { verifyGoogleIdToken } from "../../lib/auth/googleVerify.js";
import { googleSignin } from "../../lib/auth/googleSignin.js";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const T0 = new Date("2026-11-19T10:00:00Z");

// "hash:<plain>" stands in for bcrypt: deterministic, and compare() is exact.
const hashPassword = async (p) => `hash:${p}`;
const compare = async (plain, hash) => hash === `hash:${plain}`;

function reset(users) {
	const repo = credentialsRepo(users);
	const clock = { now: new Date(T0) };
	const mails = [];
	const audits = [];
	const deps = {
		repo, now: () => new Date(clock.now), baseUrl: "https://app.test",
		randomToken: () => randomBytes(32).toString("hex"), hashPassword,
		mailer: async (m) => { mails.push(m); return { ok: true }; },
		audit: async (a, id) => audits.push({ a, id }),
	};
	return { repo, clock, mails, audits, deps };
}
const tokenFrom = (mail) => /reset-password\?token=([0-9a-f]{64})/.exec(mail.html)[1];
const codeOf = async (p) => { try { await p; return "ok"; } catch (e) { return e.code || e.message; } };

// ------------------------------------------------------------------ forgot password

test("a valid request e-mails a link once; only the HASH of the token is stored, in the dedicated columns", async () => {
	const u = USER(1);
	const c = reset([u]);
	const r = await requestPasswordReset(c.deps, { email: u.email });
	assert.deepEqual(r, { ok: true, message: GENERIC_REQUEST_MESSAGE });
	assert.equal(c.mails.length, 1);
	assert.equal(c.mails[0].to, u.email);
	const token = tokenFrom(c.mails[0]);
	const row = c.repo.rows[0];
	assert.equal(row.password_reset_token_hash, hashToken(token));
	assert.notEqual(row.password_reset_token_hash, token);
	assert.equal(new Date(row.password_reset_expires_at).getTime(), T0.getTime() + RESET_TTL_MS);
	assert.ok(!JSON.stringify(row).includes(token), "the raw token is stored nowhere");
	assert.ok(!c.mails[0].html.includes(row.password), "no password in the e-mail");
	assert.equal(row.email_confirmed, true);
	assert.equal(c.audits[0].a, "auth.password_reset_requested");
	assert.ok(!JSON.stringify(c.audits).includes(token), "tokens are never audited");
});

test("unknown, disabled and throttled addresses get the identical answer and nothing is sent", async () => {
	const c = reset([USER(1), USER(2, { status: false })]);
	const known = await requestPasswordReset(c.deps, { email: "u1@example.test" });
	c.mails.length = 0;
	assert.deepEqual(await requestPasswordReset(c.deps, { email: "nobody@example.test" }), known);
	assert.deepEqual(await requestPasswordReset(c.deps, { email: "u2@example.test" }), known);
	assert.deepEqual(await requestPasswordReset(c.deps, { email: "u1@example.test" }), known, "second request within a minute");
	assert.equal(c.mails.length, 0);
	c.clock.now = new Date(T0.getTime() + RESET_MIN_INTERVAL_MS + 1);
	await requestPasswordReset(c.deps, { email: "u1@example.test" });
	assert.equal(c.mails.length, 1, "allowed again after the interval");
});

test("invalid e-mail input is rejected, and a mail failure does not change the answer", async () => {
	const c = reset([USER(1)]);
	for (const bad of ["", "nope", undefined, null, 5, "a@b", "x".repeat(300) + "@a.com"]) assert.equal(await codeOf(requestPasswordReset(c.deps, { email: bad })), "invalid_email", String(bad));
	c.deps.mailer = async () => { throw new Error("smtp down"); };
	assert.deepEqual(await requestPasswordReset(c.deps, { email: "u1@example.test" }), { ok: true, message: GENERIC_REQUEST_MESSAGE });
});

test("a newer request replaces the older token (the old link stops working)", async () => {
	const c = reset([USER(1)]);
	await requestPasswordReset(c.deps, { email: "u1@example.test" });
	const first = tokenFrom(c.mails[0]);
	c.clock.now = new Date(T0.getTime() + RESET_MIN_INTERVAL_MS + 1);
	await requestPasswordReset(c.deps, { email: "u1@example.test" });
	assert.equal(await codeOf(resetPassword(c.deps, { token: first, password: "BrandNew123" })), "invalid_token");
	assert.equal(await codeOf(resetPassword(c.deps, { token: tokenFrom(c.mails[1]), password: "BrandNew123" })), "ok");
});

// ------------------------------------------------------------------ reset password

test("successful reset: new password works, old one does not, token is single-use, other sessions are revoked, lockout cleared", async () => {
	const u = USER(1, { failed_login_count: 3, locked_until: new Date(T0.getTime() + 60000) });
	const c = reset([u]);
	await requestPasswordReset(c.deps, { email: u.email });
	const token = tokenFrom(c.mails[0]);
	c.mails.length = 0;
	c.clock.now = new Date(T0.getTime() + 5 * 60000);
	assert.deepEqual(await resetPassword(c.deps, { token, password: "BrandNew123", confirm: "BrandNew123" }), { ok: true });
	const row = c.repo.rows[0];
	assert.equal(row.password, "hash:BrandNew123");
	assert.equal(row.password_reset_token_hash, null);
	assert.equal(row.password_reset_expires_at, null);
	assert.equal(row.locked_until, null);
	assert.equal(c.mails.length, 1, "a 'password changed' notice is sent");
	assert.ok(!c.mails[0].html.includes("BrandNew123"), "never the password");
	// token reuse
	assert.equal(await codeOf(resetPassword(c.deps, { token, password: "Another12345" })), "invalid_token");
	// old password no longer works, the new one does
	const d = { findUser: async (e) => c.repo.findByEmail(e), compare, repo: c.repo, now: () => c.clock.now };
	assert.equal(await codeOf(authenticate(d, { email: u.email, password: "pw1Pass" })), "invalid_credentials");
	assert.equal((await authenticate(d, { email: u.email, password: "BrandNew123" })).id, u.id);
	// a token issued before the reset is revoked; one issued after is not
	const iatBefore = Math.floor(T0.getTime() / 1000);
	const iatAfter = Math.floor(c.clock.now.getTime() / 1000) + 10;
	assert.equal(isTokenRevoked(iatBefore, row.password_changed_at), true);
	assert.equal(isTokenRevoked(iatAfter, row.password_changed_at), false);
});

test("expired, malformed, unknown and disabled-account tokens are refused with the same error", async () => {
	const c = reset([USER(1), USER(2)]);
	await requestPasswordReset(c.deps, { email: "u1@example.test" });
	const token = tokenFrom(c.mails[0]);
	for (const bad of [undefined, "", "abc", "g".repeat(64), "0".repeat(64), token.toUpperCase(), `${token} `, 5, {}]) assert.equal(await codeOf(resetPassword(c.deps, { token: bad, password: "BrandNew123" })), "invalid_token", String(bad));
	c.clock.now = new Date(T0.getTime() + RESET_TTL_MS + 1);
	assert.equal(await codeOf(resetPassword(c.deps, { token, password: "BrandNew123" })), "invalid_token", "expired");
	assert.equal(c.repo.rows[0].password, "hash:pw1Pass", "an expired token changes nothing");
	c.clock.now = new Date(T0);
	c.repo.rows[0].status = false;
	assert.equal(await codeOf(resetPassword(c.deps, { token, password: "BrandNew123" })), "invalid_token", "disabled account");
});

test("a weak or mismatched new password is refused and the token stays usable", async () => {
	const c = reset([USER(1)]);
	await requestPasswordReset(c.deps, { email: "u1@example.test" });
	const token = tokenFrom(c.mails[0]);
	for (const weak of ["short1", "allletters", "12345678", "password123", "u1@example.test", ""]) assert.equal(await codeOf(resetPassword(c.deps, { token, password: weak })), "weak_password", weak);
	assert.equal(await codeOf(resetPassword(c.deps, { token, password: "BrandNew123", confirm: "BrandNew124" })), "mismatch");
	assert.equal(await codeOf(resetPassword(c.deps, { token, password: "BrandNew123", confirm: "BrandNew123" })), "ok");
});

test("two simultaneous resets with one token: exactly one wins", async () => {
	const c = reset([USER(1)]);
	await requestPasswordReset(c.deps, { email: "u1@example.test" });
	const token = tokenFrom(c.mails[0]);
	const results = await Promise.all([resetPassword(c.deps, { token, password: "FirstWinner1" }).then(() => "ok", (e) => e.code), resetPassword(c.deps, { token, password: "SecondWinner2" }).then(() => "ok", (e) => e.code)]);
	assert.deepEqual(results.sort(), ["invalid_token", "ok"]);
});

test("endpoints: rate limits by address and by e-mail, generic answers, no token in logs, separate columns, no HTTP method surprises", () => {
	const f = read("pages/api/users/forgot-password.js");
	assert.match(f, /rateLimit\(req, res, "forgot-password-ip", \{ windowMs: 60 \* 60 \* 1000, max: 10 \}\)/);
	assert.match(f, /allow\("forgot-password-email"/);
	assert.match(f, /status\(200\)\.json\(\{ ok: true, message: GENERIC_REQUEST_MESSAGE \}\)/);
	assert.match(read("pages/api/users/reset-password.js"), /rateLimit\(req, res, "reset-password-ip"/);
	assert.match(read("lib/auth/http.js"), /Allow/);
	const svc = read("lib/auth/passwordReset.js");
	assert.doesNotMatch(svc, /console\./, "the reset service never logs");
	assert.doesNotMatch(svc, /reset_password_token|reset_password_send_at/, "the e-mail confirmation columns are not reused");
	assert.match(read("database/migrations/20261110000000-add-auth-security-columns.js"), /password_reset_token_hash[\s\S]*password_reset_expires_at[\s\S]*password_changed_at/);
});

// ------------------------------------------------------------------ sign-in guard

const guard = (users) => {
	const repo = credentialsRepo(users);
	const clock = { now: new Date(T0) };
	return { repo, clock, deps: { findUser: async (e) => repo.findByEmail(e), compare, repo, now: () => new Date(clock.now) } };
};

test("every credential failure is the same generic 401, whether the account exists or not", async () => {
	const g = guard([USER(1)]);
	const fails = [];
	for (const [email, password] of [["nobody@example.test", "whatever1"], ["u1@example.test", "wrongpass1"], ["u1@example.test", ""], [undefined, undefined], ["u1@example.test", 123]]) {
		try { await authenticate(g.deps, { email, password }); fails.push("no failure"); } catch (e) { fails.push(`${e.status}|${e.code}|${e.message}`); }
	}
	assert.deepEqual([...new Set(fails)], [`401|invalid_credentials|${GENERIC_LOGIN_MESSAGE}`]);
});

test("unverified e-mail and disabled accounts are only reported AFTER the correct password", async () => {
	const g = guard([USER(1, { email_confirmed: false }), USER(2, { status: false })]);
	assert.equal(await codeOf(authenticate(g.deps, { email: "u1@example.test", password: "bad" })), "invalid_credentials");
	assert.equal(await codeOf(authenticate(g.deps, { email: "u1@example.test", password: "pw1Pass" })), "email_unverified");
	assert.equal(await codeOf(authenticate(g.deps, { email: "u2@example.test", password: "bad" })), "invalid_credentials");
	assert.equal(await codeOf(authenticate(g.deps, { email: "u2@example.test", password: "pw2Pass" })), "account_disabled");
});

test("lockout: too many wrong passwords lock the account (still the generic error), it unlocks by itself, success resets the counter", async () => {
	const g = guard([USER(1)]);
	for (let i = 0; i < MAX_FAILURES - 1; i++) await codeOf(authenticate(g.deps, { email: "u1@example.test", password: `bad${i}` }));
	assert.equal((await authenticate(g.deps, { email: "u1@example.test", password: "pw1Pass" })).id, USER(1).id, "below the limit, the right password works and resets the counter");
	assert.equal(g.repo.rows[0].failed_login_count, 0);
	for (let i = 0; i < MAX_FAILURES; i++) assert.equal(await codeOf(authenticate(g.deps, { email: "u1@example.test", password: `bad${i}` })), "invalid_credentials");
	assert.ok(g.repo.rows[0].locked_until);
	assert.equal(await codeOf(authenticate(g.deps, { email: "u1@example.test", password: "pw1Pass" })), "invalid_credentials", "locked: even the right password is refused, with the same message");
	g.clock.now = new Date(T0.getTime() + LOCK_MS + 1000);
	assert.equal(await codeOf(authenticate(g.deps, { email: "u1@example.test", password: "pw1Pass" })), "ok", "unlocked after the lock period");
});

test("sign-in endpoint: client-address limit, no raw error text, one generic message", () => {
	const s = read("pages/api/users/signin.js");
	assert.match(s, /rateLimit\(req, res, "signin-ip"/);
	assert.doesNotMatch(s, /User account does not exist|Password is not correct|Email is not confirmed yet/);
	assert.match(s, /res\.status\(401\)\.json\(\{ code: e\.code, message: GENERIC_LOGIN_MESSAGE \}\)/);
});

test("signup issues no login token before the e-mail is confirmed, and applies the password policy", () => {
	const s = read("pages/api/users/signup.js");
	assert.doesNotMatch(s, /jwt|edmy_users_token/);
	assert.match(s, /verification_required: true/);
	assert.match(s, /passwordProblem\(password, \{ email \}\)/);
	const r = read("pages/api/users/send-confirmation-email.js");
	assert.doesNotMatch(r, /Email does not exist/);
	assert.match(r, /allow\("send-confirmation-email"/);
});

// ------------------------------------------------------------------ policy, revocation

test("password policy", () => {
	assert.equal(passwordProblem("GoodPass123", { email: "x@y.com" }), null);
	for (const bad of ["", "short1A", "alllettersonly", "123456789012", "Password123".slice(0, 0) + "password123", "a1".repeat(40)]) assert.ok(passwordProblem(bad), bad);
	assert.ok(passwordProblem("alice.smith99", { email: "alice.smith@x.com" }), "contains the email name");
	assert.ok(passwordProblem(undefined));
});

test("token revocation: only tokens issued before the last password change are refused", () => {
	const changed = new Date("2026-11-19T10:00:00Z");
	const s = Math.floor(changed.getTime() / 1000);
	assert.equal(isTokenRevoked(s - 1, changed), true);
	assert.equal(isTokenRevoked(s, changed), false, "same second: the token handed out by the reset itself");
	assert.equal(isTokenRevoked(s + 100, changed), false);
	assert.equal(isTokenRevoked(1, null), false, "never changed: nothing is revoked");
	assert.equal(isTokenRevoked(null, changed), true, "no issue time cannot be proven newer");
	assert.match(read("lib/mastery-server/http.js"), /isTokenRevoked\(claims\.iat, passwordChangedAt\)/);
	assert.match(read("lib/mastery-server/http.js"), /if \(!user\.email_confirmed\) return null;/);
});

// ------------------------------------------------------------------ Google

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const CLIENT = "client-id.apps.googleusercontent.com";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const getKeys = async () => ({ k1: jwk });
const idToken = (claims = {}, { key = privateKey, kid = "k1", expiresIn = "1h" } = {}) =>
	jwt.sign({ iss: "https://accounts.google.com", aud: CLIENT, sub: "google-sub-1", email: "new.person@gmail.com", email_verified: true, given_name: "New", family_name: "Person", ...claims }, key, { algorithm: "RS256", keyid: kid, ...(expiresIn ? { expiresIn } : {}) });
const verify = (t) => verifyGoogleIdToken(t, { clientId: CLIENT, getKeys });

function google(users = []) {
	const repo = credentialsRepo(users);
	const deps = { repo, verify, now: () => new Date(T0), randomPasswordHash: async () => `hash:unusable-${randomBytes(8).toString("hex")}` };
	return { repo, deps };
}

test("Google token verification: signature, issuer, audience, expiry, kid and verified flag", async () => {
	assert.equal((await verify(idToken())).email, "new.person@gmail.com");
	assert.equal((await verify(idToken({ iss: "accounts.google.com" }))).sub, "google-sub-1");
	const bad = async (t) => { try { await verify(t); return "accepted"; } catch (e) { return e.message; } };
	assert.equal(await bad(idToken({}, { key: other.privateKey })), "invalid_google_token", "signed by someone else");
	assert.equal(await bad(idToken({ aud: "someone-elses-client" })), "invalid_google_token", "wrong audience");
	assert.equal(await bad(idToken({ iss: "https://evil.example" })), "invalid_google_token", "wrong issuer");
	assert.equal(await bad(idToken({ exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 4000 }, { expiresIn: null })), "invalid_google_token", "expired");
	assert.equal(await bad(idToken({}, { kid: "unknown" })), "invalid_google_token", "unknown key id");
	assert.equal(await bad("not.a.jwt"), "invalid_google_token");
	assert.equal(await bad(""), "invalid_google_token");
	assert.equal(await bad(jwt.sign({ aud: CLIENT, iss: "https://accounts.google.com", sub: "x", email: "a@b.com" }, "secret", { algorithm: "HS256" })), "invalid_google_token", "HS256 / alg confusion");
	assert.equal(await bad(jwt.sign({ aud: CLIENT, iss: "https://accounts.google.com", sub: "x", email: "a@b.com" }, "", { algorithm: "none" })), "invalid_google_token", "alg none");
	assert.equal((await verify(idToken({ email_verified: "true" }))).email_verified, true);
	assert.equal((await verify(idToken({ email_verified: false }))).email_verified, false);
	await assert.rejects(verifyGoogleIdToken(idToken(), { clientId: "", getKeys }), /google_not_configured/);
});

test("a new Google user gets an ordinary student account: confirmed e-mail, unusable password, no privileges", async () => {
	const g = google();
	const u = await googleSignin(g.deps, { credential: idToken() });
	assert.equal(u.email, "new.person@gmail.com");
	assert.equal(u.role, "student");
	assert.equal(u.email_confirmed, true);
	assert.equal(u.google_sub, "google-sub-1");
	assert.match(u.password, /^hash:unusable-/);
	assert.equal(g.repo.rows.length, 1);
	// signing in again finds the same account
	assert.equal((await googleSignin(g.deps, { credential: idToken() })).id, u.id);
	assert.equal(g.repo.rows.length, 1, "no duplicate");
});

test("an existing e-mail/password account is linked, not duplicated, and keeps its password when its e-mail was confirmed", async () => {
	const g = google([USER(1, { email: "New.Person@gmail.com" })]);
	const u = await googleSignin(g.deps, { credential: idToken() });
	assert.equal(u.id, USER(1).id);
	assert.equal(g.repo.rows.length, 1, "case-insensitive: still one account");
	assert.equal(u.google_sub, "google-sub-1");
	assert.equal(u.password, "hash:pw1Pass", "the confirmed owner keeps their password");
	assert.equal(g.repo.rows[0].password_changed_at, null, "and no session is revoked by linking");
	assert.equal(u.role, "student");
});

test("existing UNCONFIRMED account: nothing is linked, confirmed or overwritten; the owner is pointed at Forgot password", async () => {
	const g = google([USER(1, { email: "new.person@gmail.com", email_confirmed: false, password: "hash:squatter-password1" })]);
	const before = JSON.stringify(g.repo.rows[0]);
	assert.equal(await codeOf(googleSignin(g.deps, { credential: idToken() })), "account_unconfirmed");
	assert.equal(JSON.stringify(g.repo.rows[0]), before, "the row is byte-for-byte unchanged: no link, no confirmation, no password change");
	assert.equal(g.repo.rows.length, 1, "no duplicate account either");
	// the explicit process: Forgot password replaces the password AND confirms the e-mail; then Google links to the confirmed account
	const c = reset(g.repo.rows);
	await requestPasswordReset(c.deps, { email: "new.person@gmail.com" });
	await resetPassword(c.deps, { token: tokenFrom(c.mails[0]), password: "OwnerChose123" });
	assert.equal(c.repo.rows[0].password, "hash:OwnerChose123");
	assert.equal(c.repo.rows[0].email_confirmed, true);
	const g2 = { ...g, deps: { ...g.deps, repo: c.repo } };
	const u = await googleSignin(g2.deps, { credential: idToken() });
	assert.equal(u.google_sub, "google-sub-1");
	assert.equal(u.password, "hash:OwnerChose123", "linking left the owner password alone");
});

test("Google never grants privileges: roles and telecaller state are untouched, and an unverified Google e-mail is refused", async () => {
	const g = google([USER(1, { email: "new.person@gmail.com", role: "instructor" }), USER(2, { email: "boss@example.test", role: "admin" })]);
	assert.equal((await googleSignin(g.deps, { credential: idToken() })).role, "instructor", "role is whatever the database says");
	assert.equal(await codeOf(googleSignin(g.deps, { credential: idToken({ email_verified: false }) })), "google_email_unverified");
	assert.equal(await codeOf(googleSignin(g.deps, { credential: idToken({ email: "boss@example.test", sub: "other-sub" }) })), "ok", "links to the existing admin account, which stays an admin and needs no new privilege");
	assert.equal(g.repo.rows.find((r) => r.email === "boss@example.test").role, "admin");
	// the new-account row carries only identity fields: no role, no telecaller data
	const src = read("lib/auth/googleSignin.js");
	assert.doesNotMatch(src, /role:|telecaller|instructor_|isAdmin/i.source ? /\brole:\s|telecaller_|TelecallerProfile/ : /x/);
	const api = read("pages/api/users/google.js");
	assert.match(api, /googleSignin\(deps, \{ credential: body\(req\)\.credential \}\)/, "the request supplies only the token");
	assert.doesNotMatch(api, /body\(req\)\.(role|userId|user_id|email)/);
});

test("invalid tokens and conflicts are refused: bad token, other Google account on the same e-mail, disabled account", async () => {
	const g = google([USER(1, { email: "new.person@gmail.com", google_sub: "different-sub" }), USER(2, { email: "off@example.test", status: false })]);
	assert.equal(await codeOf(googleSignin(g.deps, { credential: "garbage" })), "invalid_google_token");
	assert.equal(await codeOf(googleSignin(g.deps, { credential: idToken({}, { key: other.privateKey }) })), "invalid_google_token");
	assert.equal(await codeOf(googleSignin(g.deps, { credential: idToken() })), "google_conflict");
	assert.equal(await codeOf(googleSignin(g.deps, { credential: idToken({ email: "off@example.test", sub: "s2" }) })), "account_disabled");
	const unconfigured = { ...g.deps, verify: async () => { throw new Error("google_not_configured"); } };
	assert.equal(await codeOf(googleSignin(unconfigured, { credential: "x" })), "google_not_configured");
});

test("a Google user who wants telecaller access still has to apply: signing in changes no telecaller data", () => {
	for (const f of ["lib/auth/googleSignin.js", "lib/auth/credentialsRepo.js", "pages/api/users/google.js"]) assert.doesNotMatch(read(f), /telecaller_profiles|TelecallerProfile|TelecallerApplication/, f);
	// ...and the state they land in is the ordinary derived one: nothing to bypass the pending page / gate
	assert.match(read("lib/auth/landing.js"), /telecallerStateFor\(user\)/);
});
