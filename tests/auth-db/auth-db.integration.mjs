// REAL-DATABASE integration test for the authentication / telecaller isolation work. NOT part of `npm test`.
//
// It runs the real services, the real Sequelize repositories and the real getAccountActor / landingRedirect against PostgreSQL, but ONLY
// inside a throw-away schema:
//   1. create an empty schema   : node tests/auth-db/schema.mjs create .ss-authtest.json   (see docs/auth/README.md "Running the integration test")
//   2. apply the migration there : PG_SEARCH_PATH=<schema> npx env-cmd sequelize-cli db:migrate --env postgres_development
//   3. run this file             : PG_SEARCH_PATH=<schema> npx env-cmd node --test tests/auth-db/auth-db.integration.mjs
// It refuses to start unless PG_SEARCH_PATH names a schema called ss_authtest_<8 hex> AND the live connection resolves to exactly that
// schema AND `public` is not on the search path. No e-mail is sent (the mailer is a recorder) and no Google account is used (ID tokens
// are signed with a locally generated key). Only test accounts (@example.test) are created.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

register(new URL("../db/pg/hooks.mjs", import.meta.url));
const SCHEMA = process.env.PG_SEARCH_PATH || "";
if (!/^ss_authtest_[0-9a-f]{8}$/.test(SCHEMA)) throw new Error("refusing to run: PG_SEARCH_PATH must name an ss_authtest_<8 hex> schema");
process.env.DB_DIALECT = "postgres";
process.env.NODE_ENV = "development";
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret";
const load = (p) => import(pathToFileURL(path.join(process.cwd(), p)).href);

const { default: connection } = await load("database/connection.js");
{
	const [[r]] = await connection.query("select current_schema() as cs, current_setting('search_path') as sp, (select count(*)::int from users) as users");
	if (r.cs !== SCHEMA || /public/.test(r.sp)) throw new Error(`refusing to run: connection resolves to ${r.cs} (search_path ${r.sp})`);
	if (r.users !== 0) throw new Error("refusing to run: the test schema is not empty");
	console.log(`# connected to throw-away schema ${r.cs}; public is not on the search path`);
}
const { default: User } = await load("database/models/user.js");
const { default: UserAuth } = await load("database/models/user_auth.js");
const { TelecallerApplication, TelecallerProfile } = await load("database/models/telecaller.js");
const { getAccountActor } = await load("lib/mastery-server/http.js");
const { landingRedirect } = await load("lib/auth/landing.js");
const { telecallerStateFor } = await load("lib/auth/telecallerAccess.js");
const { authDeps } = await load("lib/auth/deps.js");
const { default: credentialsRepo } = await load("lib/auth/credentialsRepo.js");
const { requestPasswordReset, resetPassword } = await load("lib/auth/passwordReset.js");
const { authenticate, MAX_FAILURES } = await load("lib/auth/signinGuard.js");
const { googleSignin } = await load("lib/auth/googleSignin.js");
const { verifyGoogleIdToken } = await load("lib/auth/googleVerify.js");
const { signSession } = await load("lib/auth/session.js");
const tsvc = await load("lib/telecallers/service.js");
const { default: telecallerRepo } = await load("lib/telecallers/repo.js");
const fsvc = await load("lib/followups/service.js");
const { followupDeps } = await load("lib/followups/deps.js");
const { ciEquals } = await load("lib/db/dialect.js");

after(async () => {
	await connection.close();
});

// ------------------------------------------------------------------ helpers
const PW = "Integration-Pass-1";
let n = 0;
const mails = [];
const mailer = async (m) => (mails.push(m), { ok: true });
async function makeUser({ role = "student", confirmed = true, active = true, name = "t" } = {}) {
	n++;
	const u = await User.create({ first_name: `Test${name}`, last_name: `User${n}`, email: `auth-it-${n}-${name}@example.test`, password: await bcrypt.hash(PW, 4), role, email_confirmed: confirmed, email_confirmed_at: confirmed ? new Date() : null, status: active });
	return u.get({ plain: true });
}
const tokenFor = (u, extra = {}) => jwt.sign({ userId: u.id, role: u.role, email: u.email, ...extra }, process.env.JWT_SECRET, { expiresIn: "7d" });
const req = (token, url) => ({ headers: { authorization: token }, url });
const actorOn = async (u, url, token = tokenFor(u)) => getAccountActor(req(token, url));

const STUDENT_API = ["/api/learnings/progress", "/api/mastery/me", "/api/mastery/study/start", "/api/family/overview", "/api/books/mine", "/api/books/b1/access", "/api/checkout", "/api/wishlist", "/api/quizzes/student/quiz", "/api/live-sessions/s1/join", "/api/courses/course/c1"];
const SHARED_API = ["/api/users/update", "/api/notifications", "/api/telecallers/apply", "/api/telecaller/summary", "/api/meetings/request"];

const pdf = (x) => Buffer.from(`%PDF-1.4\n% integration resume ${x}\n1 0 obj<<>>endobj\n%%EOF`);
const form = (name) => ({ full_name: name, phone: "+91 98765 43210", city: "Pune", state: "Maharashtra", qualification: "bachelor", has_telecalling_experience: true, experience_years: 2, previous_company: "Acme", languages: "English, Hindi", employment_preference: "full_time", additional_info: "Test", confirmed_adult: true, consented_privacy: true });
const tdeps = { repo: telecallerRepo, mailer, now: () => new Date(), baseUrl: "http://localhost:3000", audit: async () => {}, reapplyDays: 30 };
const asActor = (u) => ({ userId: u.id, role: u.role });
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };

// ------------------------------------------------------------------ 1. the telecaller flow end to end, then the permission matrix
async function applyAndSubmit(u) {
	await tsvc.uploadResume(tdeps, asActor(u), { filename: "cv.pdf", data: pdf(u.id).toString("base64") });
	return (await tsvc.submitApplication(tdeps, asActor(u), form(`${u.first_name} ${u.last_name}`))).application;
}

test("telecaller lifecycle on the real database: apply -> pending -> more info -> pending -> approved -> deactivated -> reactivated", async () => {
	const admin = await makeUser({ role: "admin", name: "admin" });
	const u = await makeUser({ name: "flow" });
	const t = tokenFor(u);
	const exp = async (state, studentBlocked, telecallerApi) => {
		assert.equal(await telecallerStateFor(u), state, `state ${state}`);
		for (const url of STUDENT_API) assert.equal(!!(await actorOn(u, url, t)), !studentBlocked, `${state}: ${url} ${studentBlocked ? "must be refused" : "must work"}`);
		for (const url of SHARED_API) assert.ok(await actorOn(u, url, t), `${state}: shared ${url} stays reachable`);
		assert.equal(await status(fsvc.getDashboard(followupDeps(), asActor(u), {})), telecallerApi, `${state}: telecaller dashboard API`);
		const land = await landingRedirect({ cookies: { edmy_users_token: t } });
		return land && land.destination;
	};
	// ordinary student
	assert.equal(await exp("none", false, 403), "/learning/my-courses/");
	// draft (form saved, not submitted)
	await tsvc.saveDraft(tdeps, asActor(u), form("Flow User"));
	assert.equal(await exp("draft", false, 403), "/become-a-telecaller/", "a draft applicant is sent to the application, but is not locked out");
	// submit -> pending
	const app = await applyAndSubmit(u);
	assert.equal(app.status, "pending");
	assert.equal(await exp("pending", true, 403), "/become-a-telecaller/");
	// admin asks for more information
	await tsvc.reviewAction(tdeps, asActor(admin), app.id, { action: "request_info", feedback: "Please add your last employer's name." });
	assert.equal(await exp("more_info", true, 403), "/become-a-telecaller/");
	await tsvc.submitApplication(tdeps, asActor(u), form("Flow User"));
	assert.equal(await exp("pending", true, 403), "/become-a-telecaller/");
	// approve -> active telecaller
	await tsvc.reviewAction(tdeps, asActor(admin), app.id, { action: "approve", confirm: true, feedback: "Welcome aboard." });
	assert.equal((await User.findByPk(u.id)).role, "student", "approval never changes users.role");
	assert.equal(await exp("active", true, 200), "/telecaller/", "an active telecaller lands on the dashboard, student content APIs are closed");
	// deactivate
	await tsvc.setMemberStatus(tdeps, asActor(admin), u.id, { action: "deactivate", reason: "Integration test deactivation" });
	assert.equal(await exp("inactive", true, 403), "/become-a-telecaller/");
	// reactivate
	await tsvc.setMemberStatus(tdeps, asActor(admin), u.id, { action: "activate" });
	assert.equal(await exp("active", true, 200), "/telecaller/");
});

test("permission matrix on the real database: rejected, instructor, admin, unconfirmed, disabled, forged-role tokens", async () => {
	const admin = await makeUser({ role: "admin", name: "admin2" });
	// rejected applicant keeps normal student access
	const rej = await makeUser({ name: "rej" });
	const a = await applyAndSubmit(rej);
	await tsvc.reviewAction(tdeps, asActor(admin), a.id, { action: "reject", confirm: true, feedback: "Not enough experience yet." });
	assert.equal(await telecallerStateFor(rej), "rejected");
	for (const url of STUDENT_API) assert.ok(await actorOn(rej, url), `rejected: ${url}`);
	assert.equal((await landingRedirect({ cookies: { edmy_users_token: tokenFor(rej) } })).destination, "/become-a-telecaller/", "but they are not auto-redirected to the student dashboard");
	// instructor and admin are never gated, even when an application exists for them
	const ins = await makeUser({ role: "instructor", name: "ins" });
	await TelecallerApplication.create({ user_id: ins.id, status: "pending", attempt: 1, version: 0 });
	for (const url of STUDENT_API) assert.ok(await actorOn(ins, url), `instructor: ${url}`);
	for (const url of STUDENT_API) assert.ok(await actorOn(admin, url), `admin: ${url}`);
	// unconfirmed e-mail and disabled accounts use nothing
	const unc = await makeUser({ confirmed: false, name: "unc" });
	const dis = await makeUser({ active: false, name: "dis" });
	for (const url of [...STUDENT_API, ...SHARED_API]) { assert.equal(await actorOn(unc, url), null, `unconfirmed ${url}`); assert.equal(await actorOn(dis, url), null, `disabled ${url}`); }
	// the JWT role claim is never trusted: a student token claiming admin does not reach admin-only data, and a pending applicant's token
	// claiming a different role is still gated by the DATABASE state
	const stu = await makeUser({ name: "forge" });
	const forged = tokenFor(stu, { role: "admin" });
	assert.equal((await actorOn(stu, "/api/learnings/progress", forged)).role, "student", "role comes from the database");
	const pend = await makeUser({ name: "forgep" });
	await applyAndSubmit(pend);
	assert.equal(await actorOn(pend, "/api/learnings/progress", tokenFor(pend, { role: "instructor" })), null, "a forged role claim does not unlock student APIs for a pending applicant");
	assert.equal(await actorOn(pend, "/api/learnings/progress", "not-a-jwt"), null);
});

// ------------------------------------------------------------------ 2. sign-in guard on the real database
test("sign-in: generic failures, persisted lockout, unlock, unverified only after the right password", async () => {
	const u = await makeUser({ name: "login" });
	const unv = await makeUser({ confirmed: false, name: "loginunv" });
	const d = () => ({ findUser: (e) => User.unscoped().findOne({ where: ciEquals(connection, "email", e) }), compare: (p, h) => bcrypt.compare(p, h), repo: credentialsRepo, now: () => new Date() });
	const err = async (email, password) => { try { await authenticate(d(), { email, password }); return "ok"; } catch (e) { return `${e.status}:${e.code}`; } };
	assert.equal(await err("nobody@example.test", PW), "401:invalid_credentials");
	assert.equal(await err(u.email, "wrong"), "401:invalid_credentials");
	assert.equal(await err(u.email.toUpperCase(), PW), "ok", "case-insensitive e-mail");
	assert.equal(await err(unv.email, "wrong"), "401:invalid_credentials");
	assert.equal(await err(unv.email, PW), "403:email_unverified");
	for (let i = 0; i < MAX_FAILURES; i++) await err(u.email, `bad${i}`);
	assert.ok((await UserAuth.findByPk(u.id)).locked_until, "the lock is stored in the database (works across servers)");
	assert.equal(await err(u.email, PW), "401:invalid_credentials", "locked: even the right password gets the same generic answer");
	await UserAuth.update({ locked_until: new Date(Date.now() - 1000) }, { where: { id: u.id } });
	assert.equal(await err(u.email, PW), "ok", "unlocked after the period");
	assert.equal((await UserAuth.findByPk(u.id)).failed_login_count, 0);
});

// ------------------------------------------------------------------ 3. forgot / reset password + revocation
test("forgot/reset password on the real database: single use, expiry, old password and old sessions stop working", async () => {
	const u = await makeUser({ name: "reset" });
	const oldToken = tokenFor(u);
	assert.ok(await actorOn(u, "/api/users/update", oldToken));
	const deps = { ...authDeps(), mailer };
	mails.length = 0;
	// unknown / known: same answer
	const a = await requestPasswordReset(deps, { email: "ghost@example.test" });
	const b = await requestPasswordReset(deps, { email: u.email });
	assert.deepEqual(a, b);
	assert.equal(mails.length, 1);
	const link = /reset-password\?token=([0-9a-f]{64})/.exec(mails[0].html);
	assert.ok(link, "the e-mail carries the reset link");
	const raw = link[1];
	const row = await UserAuth.findByPk(u.id);
	assert.ok(row.password_reset_token_hash && row.password_reset_token_hash !== raw && row.password_reset_token_hash.length === 64, "only a hash is stored");
	assert.ok(!JSON.stringify(row.get({ plain: true })).includes(raw), "the raw token is stored nowhere");
	assert.equal(row.reset_password_token ?? null, null, "the e-mail confirmation column is not used");
	await new Promise((r) => setTimeout(r, 1200)); // the old token's issue second must be earlier than the password change
	await resetPassword(deps, { token: raw, password: "BrandNew-Pass-2", confirm: "BrandNew-Pass-2" });
	assert.equal(await status(resetPassword(deps, { token: raw, password: "Another-Pass-3" })), 400, "single use");
	assert.equal(await actorOn(u, "/api/users/update", oldToken), null, "a session issued before the reset is revoked");
	assert.ok(await actorOn(u, "/api/users/update", signSession({ ...u })), "a token issued after the reset works");
	const d = (password) => ({ findUser: (e) => User.unscoped().findOne({ where: ciEquals(connection, "email", e) }), compare: (p, h) => bcrypt.compare(p, h), repo: credentialsRepo, now: () => new Date() });
	await assert.rejects(authenticate(d(), { email: u.email, password: PW }), /Invalid email or password/);
	assert.equal((await authenticate(d(), { email: u.email, password: "BrandNew-Pass-2" })).id, u.id);
	// expiry
	mails.length = 0;
	await UserAuth.update({ password_reset_requested_at: null }, { where: { id: u.id } });
	await requestPasswordReset(deps, { email: u.email });
	const raw2 = /token=([0-9a-f]{64})/.exec(mails[0].html)[1];
	await UserAuth.update({ password_reset_expires_at: new Date(Date.now() - 1000) }, { where: { id: u.id } });
	assert.equal(await status(resetPassword(deps, { token: raw2, password: "Expired-Pass-4" })), 400, "expired token");
	assert.equal(await status(resetPassword(deps, { token: raw2.replace(/.$/, "0"), password: "Expired-Pass-4" })), 400, "wrong token");
});

// ------------------------------------------------------------------ 4. Google sign-in on the real database (locally signed ID tokens)
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const CLIENT = "it-client.apps.googleusercontent.com";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const idToken = (c = {}) => jwt.sign({ iss: "https://accounts.google.com", aud: CLIENT, sub: "g-sub-new", email: "google.new@example.test", email_verified: true, given_name: "Gina", family_name: "Google", ...c }, privateKey, { algorithm: "RS256", keyid: "k1", expiresIn: "1h" });
const gdeps = () => ({ ...authDeps(), mailer, verify: (t) => verifyGoogleIdToken(t, { clientId: CLIENT, getKeys: async () => ({ k1: jwk }) }) });
const gerr = async (c) => { try { await googleSignin(gdeps(), { credential: c }); return "ok"; } catch (e) { return e.code; } };
const count = async (email) => (await UserAuth.count({ where: ciEquals(connection, "email", email) }));

test("Google on the real database: new account, no duplicates, safe linking, unconfirmed refused and unchanged, never a privilege", async () => {
	// bad tokens
	assert.equal(await gerr("garbage"), "invalid_google_token");
	assert.equal(await gerr(idToken({ aud: "other-client" })), "invalid_google_token");
	assert.equal(await gerr(idToken({ email_verified: false })), "google_email_unverified");
	assert.equal(await count("google.new@example.test"), 0, "refused tokens create nothing");
	// new account
	const u1 = await googleSignin(gdeps(), { credential: idToken() });
	assert.equal(u1.role, "student");
	assert.equal(u1.email_confirmed, true);
	assert.equal(await telecallerStateFor(u1), "none", "a Google user is an ordinary student: no telecaller approval");
	assert.equal(await TelecallerProfile.count({ where: { user_id: u1.id } }), 0);
	const u2 = await googleSignin(gdeps(), { credential: idToken() });
	assert.equal(u2.id, u1.id);
	assert.equal(await count("google.new@example.test"), 1, "no duplicate");
	assert.ok(!(await bcrypt.compare("", u1.password)) && !(await bcrypt.compare(PW, u1.password)), "the password is unusable");
	// existing CONFIRMED password account: linked, password kept
	const ex = await makeUser({ name: "gexisting" });
	const linked = await googleSignin(gdeps(), { credential: idToken({ sub: "g-sub-existing", email: ex.email }) });
	assert.equal(linked.id, ex.id);
	assert.equal((await UserAuth.findByPk(ex.id)).google_sub, "g-sub-existing");
	assert.ok(await bcrypt.compare(PW, (await UserAuth.findByPk(ex.id)).password), "the existing password still works");
	assert.equal(await count(ex.email), 1);
	// a different Google account on the same address is refused
	assert.equal(await gerr(idToken({ sub: "g-sub-other", email: ex.email })), "google_conflict");
	// existing UNCONFIRMED account: refused, row unchanged, then taken over through the explicit reset
	const unc = await makeUser({ confirmed: false, name: "gunc" });
	const before = JSON.stringify((await UserAuth.findByPk(unc.id)).get({ plain: true }));
	assert.equal(await gerr(idToken({ sub: "g-sub-unc", email: unc.email })), "account_unconfirmed");
	assert.equal(JSON.stringify((await UserAuth.findByPk(unc.id)).get({ plain: true })), before, "nothing was linked, confirmed or overwritten");
	mails.length = 0;
	await requestPasswordReset({ ...authDeps(), mailer }, { email: unc.email });
	await resetPassword({ ...authDeps(), mailer }, { token: /token=([0-9a-f]{64})/.exec(mails[0].html)[1], password: "Owner-Chose-5" });
	const after = await UserAuth.findByPk(unc.id);
	assert.equal(after.email_confirmed, true);
	assert.equal((await googleSignin(gdeps(), { credential: idToken({ sub: "g-sub-unc", email: unc.email }) })).id, unc.id);
	assert.ok(await bcrypt.compare("Owner-Chose-5", (await UserAuth.findByPk(unc.id)).password), "the owner's new password survives linking");
	// a Google user must still apply, and is then gated like everyone else
	const admin = await makeUser({ role: "admin", name: "gadmin" });
	assert.equal(await actorOn(u1, "/api/learnings/progress") !== null, true, "ordinary Google student: normal access");
	const app = await applyAndSubmit(u1);
	assert.equal(await telecallerStateFor(u1), "pending");
	assert.equal(await actorOn(u1, "/api/learnings/progress"), null, "pending Google applicant: student content closed");
	assert.equal(await status(fsvc.getDashboard(followupDeps(), asActor(u1), {})), 403, "and no telecaller access without admin approval");
	assert.ok(app.id);
	void admin;
});
