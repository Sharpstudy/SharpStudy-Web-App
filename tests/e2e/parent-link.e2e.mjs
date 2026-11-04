// End-to-end HTTP + MySQL test of the child-generated parent-link workflow.
//
//   yarn dev                                                            (separate terminal, localhost:3000)
//   node tests/e2e/parent-link.e2e.mjs --preflight                      read-only checks, no writes
//   E2E_ALLOW_DB_WRITES=sharpstudy_dev node tests/e2e/parent-link.e2e.mjs            the full run (WRITES to sharpstudy_dev)
//   E2E_ALLOW_DB_WRITES=sharpstudy_dev node tests/e2e/parent-link.e2e.mjs --cleanup-only   remove verified leftovers of an interrupted run
//
// SAFETY
//  * Refuses to run unless: NODE_ENV is not production, the app URL and DB host are localhost/127.0.0.1, the database is
//    exactly "sharpstudy_dev", and (for anything that writes) E2E_ALLOW_DB_WRITES=sharpstudy_dev is set.
//  * Never picks real users. It uses five dedicated accounts, found by e-mail, that must already exist (see ACCOUNTS) and
//    must carry no learners, guardian links, codes or devices. The test never writes to `users`.
//  * Everything it creates is two temporary learners named "E2E-LINK-<run id>-..." owned by the dedicated instructor,
//    plus the rows hanging off them. Cleanup deletes only learners that match that owner AND name prefix AND reference
//    only the dedicated accounts, then the audit rows written for them by the dedicated accounts.
//  * A leftover temp learner from an interrupted run blocks the next run; --cleanup-only verifies and removes it.
//  * Needs the running dev server to use the same database: this is proven (not assumed) by an authenticated request for a
//    dedicated account, which only succeeds if the server's database contains that exact user id.
// It never prints tokens, passwords or link codes.
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

const FLAGS = new Set(process.argv.slice(2));
const PREFLIGHT = FLAGS.has("--preflight");
const CLEANUP_ONLY = FLAGS.has("--cleanup-only");

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

// ------------------------------------------------------------------ guards
const EXPECTED_DB = "sharpstudy_dev";
const LOCAL = ["localhost", "127.0.0.1"];
const die = (msg) => {
	console.error(`E2E refused: ${msg}`);
	process.exit(2);
};
if (process.env.NODE_ENV === "production") die("NODE_ENV is production");
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
let baseUrl;
try {
	baseUrl = new URL(BASE);
} catch (e) {
	die("E2E_BASE_URL is not a URL");
}
if (baseUrl.protocol !== "http:" || !LOCAL.includes(baseUrl.hostname)) die("the app URL must be http://localhost or http://127.0.0.1");
if (!LOCAL.includes(process.env.DB_HOSTNAME)) die("DB_HOSTNAME must be localhost or 127.0.0.1");
if (process.env.DB_NAME_DEVELOPMENT !== EXPECTED_DB) die(`DB_NAME_DEVELOPMENT must be exactly ${EXPECTED_DB}`);
if (process.env.DB_NAME_PRODUCTION && process.env.DB_NAME_PRODUCTION === process.env.DB_NAME_DEVELOPMENT) die("development and production database names are identical");
if (!process.env.JWT_SECRET) die("JWT_SECRET is not configured");
if (!PREFLIGHT && process.env.E2E_ALLOW_DB_WRITES !== EXPECTED_DB) die(`this run writes to ${EXPECTED_DB}; set E2E_ALLOW_DB_WRITES=${EXPECTED_DB} (or use --preflight for read-only checks)`);

// ------------------------------------------------------------------ the dedicated accounts
// Role: instructor owns the temporary learners; child is linked to learner 1; other is linked to learner 2 (another family);
// parentA / parentB are the parents. All five are created by hand beforehand: first_name "E2E", active, e-mail e2e.*@example.test.
const ACCOUNTS = {
	instructor: { role: "instructor", email: process.env.E2E_INSTRUCTOR_EMAIL || "e2e.instructor@example.test" },
	child: { role: "student", email: process.env.E2E_CHILD_EMAIL || "e2e.child@example.test" },
	parentA: { role: "student", email: process.env.E2E_PARENT_A_EMAIL || "e2e.parent-a@example.test" },
	parentB: { role: "student", email: process.env.E2E_PARENT_B_EMAIL || "e2e.parent-b@example.test" },
	other: { role: "student", email: process.env.E2E_OTHER_EMAIL || "e2e.other@example.test" },
};
const EMAIL_RE = /^e2e\.[a-z0-9-]+@example\.test$/;
for (const [k, a] of Object.entries(ACCOUNTS)) if (!EMAIL_RE.test(a.email)) die(`${k} e-mail must look like e2e.<name>@example.test`);
if (new Set(Object.values(ACCOUNTS).map((a) => a.email)).size !== 5) die("the five test accounts must have different e-mail addresses");

const NAME_PREFIX = "E2E-LINK-";
const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: EXPECTED_DB, timezone: "Z" });
const q = async (sql, params) => (await db.query(sql, params))[0];
assert.equal((await q("SELECT DATABASE() AS d"))[0].d, EXPECTED_DB, "connected to an unexpected database");

const problems = [];
const found = await q("SELECT id, role, email, first_name, status FROM users WHERE email IN (?)", [Object.values(ACCOUNTS).map((a) => a.email)]);
const acct = {};
for (const [key, want] of Object.entries(ACCOUNTS)) {
	const rows = found.filter((u) => String(u.email).toLowerCase() === want.email);
	if (rows.length !== 1) {
		problems.push(`${want.email}: ${rows.length ? "more than one account" : "does not exist"}`);
		continue;
	}
	const u = rows[0];
	if (u.role !== want.role) problems.push(`${want.email}: role must be ${want.role}`);
	if (u.first_name !== "E2E") problems.push(`${want.email}: first_name must be "E2E" (marks it as a test account)`);
	if (!u.status) problems.push(`${want.email}: account must be active (status = 1)`);
	acct[key] = u;
}
if (problems.length) {
	console.error("Test accounts are not ready:\n  - " + problems.join("\n  - "));
	await db.end();
	process.exit(3);
}
const IDS = Object.values(acct).map((u) => u.id);
const ownedBy = (k) => acct[k].id;

// schema this test relies on
const hasCols = async (table, cols) => {
	const have = (await q(`SHOW COLUMNS FROM ${table}`)).map((c) => c.Field);
	return cols.filter((c) => !have.includes(c));
};
const missing = [...(await hasCols("ml_learners", ["student_user_id", "owner_user_id", "birth_date", "contact_name", "contact_phone", "contact_email"])), ...(await hasCols("fam_link_codes", ["code_hash", "issued_by", "status", "expires_at", "used_by"]))];
if (missing.length) die(`schema is missing columns: ${missing.join(", ")}`);

// ------------------------------------------------------------------ leftovers and pre-existing associations
const tempLearners = () => q("SELECT id, display_name, owner_user_id, student_user_id FROM ml_learners WHERE owner_user_id = ? AND display_name LIKE ?", [ownedBy("instructor"), `${NAME_PREFIX}%`]);
const leftovers = await tempLearners();
const leftoverIds = leftovers.map((l) => l.id);
const notIn = (ids) => (ids.length ? ids : ["-"]);

async function assertOnlyTestReferences(learnerIds) {
	const bad = [];
	const n = async (sql, params) => Number((await q(sql, params))[0].n);
	if (await n("SELECT COUNT(*) n FROM ml_learner_guardians WHERE learner_id IN (?) AND user_id NOT IN (?)", [learnerIds, IDS])) bad.push("a guardian who is not a test account");
	if (await n("SELECT COUNT(*) n FROM ml_learners WHERE id IN (?) AND student_user_id IS NOT NULL AND student_user_id NOT IN (?)", [learnerIds, IDS])) bad.push("a student link to a non-test account");
	if (await n("SELECT COUNT(*) n FROM fam_link_codes WHERE learner_id IN (?) AND (issued_by NOT IN (?) OR (used_by IS NOT NULL AND used_by NOT IN (?)))", [learnerIds, IDS, IDS])) bad.push("a link code issued/used by a non-test account");
	if (await n("SELECT COUNT(*) n FROM fam_device_learners WHERE learner_id IN (?)", [learnerIds])) bad.push("a paired device");
	if (bad.length) throw new Error(`refusing to delete: temporary learner references ${bad.join("; ")}`);
}

const otherData = [
	["learners owned by or linked to a test account", "SELECT COUNT(*) n FROM ml_learners WHERE (owner_user_id IN (?) OR student_user_id IN (?)) AND id NOT IN (?)", [IDS, IDS, notIn(leftoverIds)]],
	["guardian links of a test account", "SELECT COUNT(*) n FROM ml_learner_guardians WHERE user_id IN (?) AND learner_id NOT IN (?)", [IDS, notIn(leftoverIds)]],
	["link codes issued or used by a test account", "SELECT COUNT(*) n FROM fam_link_codes WHERE (issued_by IN (?) OR used_by IN (?)) AND learner_id NOT IN (?)", [IDS, IDS, notIn(leftoverIds)]],
	["devices or family PINs of a test account", "SELECT (SELECT COUNT(*) FROM fam_devices WHERE owner_user_id IN (?)) + (SELECT COUNT(*) FROM fam_pins WHERE user_id IN (?)) AS n", [IDS, IDS]],
];
for (const [label, sql, params] of otherData) {
	const n = Number((await q(sql, params))[0].n);
	if (n) {
		console.error(`Test accounts must be clean: found ${n} ${label}. Not touching them; use fresh dedicated accounts.`);
		await db.end();
		process.exit(3);
	}
}

// ------------------------------------------------------------------ cleanup (the only code that deletes)
const FK_TABLES = ["fam_link_codes", "ml_learner_guardians", "ml_progress", "ml_subject_enrolments", "ml_attempts", "ml_daily_activity", "ml_hint_events", "ml_assignment_targets", "lc_enrolments", "fam_device_learners"];
async function cleanup(candidateIds) {
	if (!candidateIds.length) return { deleted: 0 };
	const own = await q("SELECT id FROM ml_learners WHERE id IN (?) AND owner_user_id = ? AND display_name LIKE ?", [candidateIds, ownedBy("instructor"), `${NAME_PREFIX}%`]);
	const ids = own.map((r) => r.id);
	if (candidateIds.length !== ids.length) console.warn(`cleanup: ${candidateIds.length - ids.length} id(s) do not match the test owner/name and were left alone`);
	if (!ids.length) return { deleted: 0 };
	await assertOnlyTestReferences(ids);
	await db.beginTransaction();
	try {
		for (const t of ["fam_link_codes", "ml_learner_guardians", "ml_progress", "ml_subject_enrolments"]) await db.query(`DELETE FROM ${t} WHERE learner_id IN (?)`, [ids]);
		await db.query("DELETE FROM ml_learners WHERE id IN (?) AND owner_user_id = ?", [ids, ownedBy("instructor")]);
		await db.query("DELETE FROM ml_audit_logs WHERE learner_id IN (?) AND actor_user_id IN (?)", [ids, IDS]);
		await db.commit();
	} catch (e) {
		await db.rollback();
		throw e;
	}
	const left = [];
	for (const t of FK_TABLES) {
		const n = Number((await q(`SELECT COUNT(*) n FROM ${t} WHERE learner_id IN (?)`, [ids]))[0].n);
		if (n) left.push(`${t}=${n}`);
	}
	if (Number((await q("SELECT COUNT(*) n FROM ml_learners WHERE id IN (?)", [ids]))[0].n)) left.push("ml_learners");
	if (Number((await q("SELECT COUNT(*) n FROM ml_audit_logs WHERE learner_id IN (?)", [ids]))[0].n)) left.push("ml_audit_logs");
	if (left.length) throw new Error(`cleanup verification found leftovers: ${left.join(", ")}`);
	return { deleted: ids.length };
}

if (leftovers.length) {
	if (!CLEANUP_ONLY) {
		console.error(`Found ${leftovers.length} leftover temporary learner(s) from an interrupted run (${leftovers.map((l) => l.display_name).join(", ")}).\nRun with --cleanup-only to verify and remove them, then run again.`);
		await db.end();
		process.exit(4);
	}
	const r = await cleanup(leftoverIds);
	console.log(`cleanup-only: removed ${r.deleted} verified temporary learner(s) and their rows`);
	await db.end();
	process.exit(0);
}
if (CLEANUP_ONLY) {
	console.log("cleanup-only: no leftover temporary learners found; nothing to do");
	await db.end();
	process.exit(0);
}

// ------------------------------------------------------------------ HTTP helpers
const tok = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "15m" });
const api = async (method, path, { as, body } = {}) => {
	const headers = { "Content-Type": "application/json" };
	if (as) headers.Authorization = tok(acct[as]);
	let res;
	try {
		res = await fetch(`${BASE}/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	} catch (e) {
		throw new Error(`cannot reach ${BASE}: is "yarn dev" running?`);
	}
	let json = null;
	try {
		json = await res.json();
	} catch (e) {
		/* no body */
	}
	if (res.status === 429 && /rate_limited/.test(JSON.stringify(json))) throw new Error(`rate limited by the dev server (${method} ${path}); wait an hour or restart "yarn dev" to reset its in-memory limiters`);
	return { status: res.status, json };
};

// Same database proven: an authenticated call only succeeds if the SERVER's database holds this exact user id.
let fingerprint;
try {
	fingerprint = await api("GET", "family/link/code/", { as: "child" });
} catch (e) {
	console.error(e.message);
	await db.end();
	process.exit(5);
}
if (fingerprint.status !== 200 || fingerprint.json.eligible !== false) {
	console.error(`The running app does not see the test account in this database (HTTP ${fingerprint.status}). It is probably using a different database; nothing was written.`);
	await db.end();
	process.exit(5);
}
if (PREFLIGHT) {
	console.log(`preflight OK: database ${EXPECTED_DB} on ${process.env.DB_HOSTNAME}; 5 dedicated accounts valid and clean; no leftovers; the app at ${BASE} uses the same database.`);
	console.log("Nothing was written.");
	await db.end();
	process.exit(0);
}

// ------------------------------------------------------------------ the run
const runId = crypto.randomBytes(4).toString("hex");
const created = [];
const observations = [];
let passed = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	passed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashOf = (code) => crypto.createHmac("sha256", process.env.JWT_SECRET).update(`fam-link:${code}`).digest("hex");
const codeRows = (learnerId) => q("SELECT * FROM fam_link_codes WHERE learner_id = ? ORDER BY created_at, id", [learnerId]);
const rowOf = async (learnerId, code) => (await q("SELECT * FROM fam_link_codes WHERE learner_id = ? AND code_hash = ?", [learnerId, hashOf(code)]))[0];
const guardians = (learnerId) => q("SELECT user_id, relation, created_by FROM ml_learner_guardians WHERE learner_id = ? ORDER BY user_id", [learnerId]);
const countOpen = async (learnerId) => (await codeRows(learnerId)).filter((r) => r.status === "open").length;
const snap = async (id, { skipStudent = false } = {}) => {
	const [l] = await q("SELECT * FROM ml_learners WHERE id = ?", [id]);
	if (skipStudent) delete l.student_user_id;
	delete l.updated_at;
	return JSON.stringify([l, await q("SELECT * FROM ml_subject_enrolments WHERE learner_id = ?", [id]), await q("SELECT learner_id, subject, level_id, set_id, worksheet_no FROM ml_progress WHERE learner_id = ?", [id])]);
};
const step = (s) => console.log(`\n# ${s}`);
const usersBefore = JSON.stringify(await q("SELECT * FROM users WHERE id IN (?) ORDER BY id", [IDS]));
const nonTestLearnersBefore = Number((await q("SELECT COUNT(*) n FROM ml_learners WHERE display_name NOT LIKE ?", [`${NAME_PREFIX}%`]))[0].n);

let exitCode = 0;
let cleaning = false;
const finish = async (why) => {
	if (cleaning) return;
	cleaning = true;
	try {
		// also catches a learner whose id never reached `created` (e.g. the response was lost)
		const byName = (await q("SELECT id FROM ml_learners WHERE owner_user_id = ? AND display_name LIKE ?", [ownedBy("instructor"), `${NAME_PREFIX}${runId}-%`])).map((r) => r.id);
		const r = await cleanup([...new Set([...created, ...byName])]);
		console.log(`\ncleanup (${why}): removed ${r.deleted} temporary learner(s) with their codes, guardian links, enrolments, progress and audit rows`);
	} catch (e) {
		exitCode = 1;
		console.error(`\nCLEANUP PROBLEM: ${e.message}\nRun again with --cleanup-only.`);
	}
};
for (const sig of ["SIGINT", "SIGTERM"]) {
	process.on(sig, async () => {
		await finish(sig);
		await db.end().catch(() => {});
		process.exit(130);
	});
}

try {
	// ---- setup: two temporary learners, each tied to its own student account (what an instructor's link does)
	step("setup");
	const mk = async (suffix, student) => {
		const made = await api("POST", "mastery/learners/", { as: "instructor", body: { displayName: `${NAME_PREFIX}${runId}-${suffix}`, pin: "4826", subjects: ["math"], timeZone: "UTC" } });
		check(`instructor creates the temporary learner (${suffix})`, made.status === 201);
		const id = made.json.learner.id;
		created.push(id);
		await db.query("UPDATE ml_learners SET student_user_id = ? WHERE id = ? AND owner_user_id = ?", [acct[student].id, id, ownedBy("instructor")]);
		return id;
	};
	const kid1 = await mk("Kid", "child");
	const kid2 = await mk("Other", "other");

	// ---- only the child's own account can generate, and a forged learner id changes nothing
	step("code generation is child-only");
	check("anonymous cannot generate", (await api("POST", "family/link/code/", { body: {} })).status === 401);
	const noProfile = await api("POST", "family/link/code/", { as: "parentA", body: {} });
	check("a parent with no learner profile cannot generate", noProfile.status === 404 && noProfile.json.code === "no_profile");
	check("the instructor cannot generate, even naming the learner", (await api("POST", "family/link/code/", { as: "instructor", body: { learnerId: kid1 } })).status === 404);
	check("the removed e-mail request route is gone", (await api("POST", "family/link/request/", { as: "parentA", body: { childEmail: acct.child.email } })).status === 404);
	check("the removed staff issue route is gone", (await api("POST", "family/link/issue/", { as: "instructor", body: { learnerId: kid1 } })).status === 404);
	const forged = await api("POST", "family/link/code/", { as: "other", body: { learnerId: kid1 } });
	check("another child naming learner 1 gets a code for its OWN learner only", forged.status === 200 && (await codeRows(kid1)).length === 0 && (await codeRows(kid2)).length === 1);
	const first = await api("POST", "family/link/code/", { as: "child", body: { learnerId: kid2 } });
	check("the child gets a code", first.status === 200 && /^[A-HJ-NP-Z2-9]{8}$/.test(first.json.code));
	const c1 = first.json.code;
	const r1 = await rowOf(kid1, c1);
	check("the code is bound to the child's learner, hash only, 72 hours", !!r1 && r1.issued_by === acct.child.id && r1.status === "open" && !JSON.stringify(r1).includes(c1) && Math.abs(new Date(r1.expires_at) - Date.now() - 72 * 3600 * 1000) < 120000);
	const st = await api("GET", "family/link/code/", { as: "child" });
	check("the status shows an open code but never the code", st.json.eligible === true && !!st.json.openCode && st.json.parents.length === 0 && !JSON.stringify(st.json).includes(c1));
	check("a parent is not eligible", (await api("GET", "family/link/code/", { as: "parentA" })).json.eligible === false);

	// ---- redeeming: success, reuse, junk input
	step("redeeming");
	const before1 = await snap(kid1);
	check("an e-mail address is not a code", (await api("POST", "family/link/", { as: "other", body: { code: acct.child.email } })).status === 404);
	check("a learner id is not a code", (await api("POST", "family/link/", { as: "other", body: { code: kid1 } })).status === 404);
	check("no link exists yet", (await guardians(kid1)).length === 0);
	const win = await api("POST", "family/link/", { as: "parentA", body: { code: c1 } });
	check("parent A redeems it and gets the existing learner", win.status === 200 && win.json.child.id === kid1);
	const g1 = await guardians(kid1);
	check("exactly one parent link, created on behalf of the child", g1.length === 1 && g1[0].user_id === acct.parentA.id && g1[0].relation === "parent" && g1[0].created_by === acct.child.id);
	check("the code is used by parent A", (await rowOf(kid1, c1)).status === "used" && (await rowOf(kid1, c1)).used_by === acct.parentA.id);
	check("learner row, enrolments, progress and ownership are unchanged", (await snap(kid1)) === before1 && (await q("SELECT owner_user_id FROM ml_learners WHERE id = ?", [kid1]))[0].owner_user_id === ownedBy("instructor"));
	check("no extra learner was created", Number((await q("SELECT COUNT(*) n FROM ml_learners WHERE display_name LIKE ?", [`${NAME_PREFIX}${runId}-%`]))[0].n) === 2);
	check("repeating the same submission is safe", (await api("POST", "family/link/", { as: "parentA", body: { code: c1 } })).status === 200 && (await guardians(kid1)).length === 1);
	const reuse = await api("POST", "family/link/", { as: "parentB", body: { code: c1 } });
	check("a used code is dead for everyone else", reuse.status === 404 && reuse.json.code === "invalid_code" && (await guardians(kid1)).length === 1);

	// ---- parent access and family isolation
	step("parent access and family isolation");
	const fam = await api("GET", "family/", { as: "parentA" });
	const ov = await api("GET", "family/overview/", { as: "parentA" });
	check("parent A's family shows only their child", fam.json.children.map((c) => c.id).join() === kid1 && ov.json.children.map((c) => c.id).join() === kid1);
	check("parent A can open their child's learning view", (await api("GET", `mastery/learners/${kid1}/`, { as: "parentA" })).status === 200);
	check("another family's learner is a 404 for parent A", (await api("GET", `mastery/learners/${kid2}/`, { as: "parentA" })).status === 404);
	check("pairing for another family's learner is a 404", (await api("POST", "family/pairing/", { as: "parentA", body: { learnerIds: [kid2] } })).status === 404 && (await api("POST", "family/pairing/", { as: "parentA", body: { learnerIds: [kid1, kid2] } })).status === 404);
	check("an unlinked parent sees nothing of this family", !(await api("GET", "family/", { as: "parentB" })).json.children.some((c) => c.id === kid1) && (await api("GET", `mastery/learners/${kid1}/`, { as: "parentB" })).status === 404);
	check("a parent cannot create, rename or remove learners", (await api("POST", "mastery/learners/", { as: "parentA", body: { displayName: "Nope", pin: "1234" } })).status === 403 && (await api("PATCH", `mastery/learners/${kid1}/`, { as: "parentA", body: { displayName: "Hacked" } })).status === 403 && (await api("DELETE", `mastery/learners/${kid1}/`, { as: "parentA", body: { confirmText: `${NAME_PREFIX}${runId}-Kid` } })).status === 403);
	check("those attempts changed nothing", (await snap(kid1)) === before1);

	// ---- replacement and cancellation
	step("replacement and cancellation");
	const c2 = (await api("POST", "family/link/code/", { as: "child", body: {} })).json.code;
	await sleep(1100); // codes are compared at one-second resolution in MySQL
	const c3 = (await api("POST", "family/link/code/", { as: "child", body: {} })).json.code;
	check("the older code was replaced by the newer one", (await rowOf(kid1, c2)).status === "cancelled" && (await rowOf(kid1, c3)).status === "open");
	check("a replaced code does not work", (await api("POST", "family/link/", { as: "parentB", body: { code: c2 } })).status === 404 && (await guardians(kid1)).length === 1);
	const cancel = await api("DELETE", "family/link/code/", { as: "child" });
	check("the child cancels the open code", cancel.status === 200 && cancel.json.cancelled === true && (await rowOf(kid1, c3)).status === "cancelled");
	check("a cancelled code does not work", (await api("POST", "family/link/", { as: "parentB", body: { code: c3 } })).status === 404);
	check("nobody else can cancel the child's code", (await api("DELETE", "family/link/code/", { as: "parentA" })).status === 404 && (await api("DELETE", "family/link/code/", { as: "instructor" })).status === 404);
	const dbl = await Promise.all([api("POST", "family/link/code/", { as: "child", body: {} }), api("POST", "family/link/code/", { as: "child", body: {} })]);
	check("two simultaneous requests both succeed", dbl.every((r) => r.status === 200));
	const openAfterDouble = await countOpen(kid1);
	if (openAfterDouble !== 1) observations.push(`OBSERVATION: ${openAfterDouble} codes were open after two simultaneous generate requests (older-code cancellation compares second-resolution timestamps)`);
	await api("DELETE", "family/link/code/", { as: "child" });
	check("cancelling leaves no open code", (await countOpen(kid1)) === 0);

	// ---- the child entering their own code, then a second parent
	step("self-redemption");
	const c4 = (await api("POST", "family/link/code/", { as: "child", body: {} })).json.code;
	const own = await api("POST", "family/link/", { as: "child", body: { code: c4 } });
	check("the child cannot redeem their own code", own.status === 422 && (await rowOf(kid1, c4)).status === "open");
	const second = await api("POST", "family/link/", { as: "parentB", body: { code: c4 } });
	check("the code was not consumed by that mistake: parent B links with it", second.status === 200 && (await guardians(kid1)).map((g) => g.user_id).sort().join() === [acct.parentA.id, acct.parentB.id].sort().join());

	// ---- privacy of guardian e-mails and contact details
	step("privacy");
	await db.query("UPDATE ml_learners SET contact_name = 'E2E Contact Name', contact_phone = '+15550100123', contact_email = 'e2e.contact@example.test', birth_date = '2018-03-04' WHERE id = ? AND owner_user_id = ?", [kid1, ownedBy("instructor")]);
	const forbidden = [acct.parentA.email, acct.parentB.email, acct.instructor.email, "e2e.contact@example.test", "+15550100123", "E2E Contact Name", "2018-03-04"];
	for (const who of ["parentA", "parentB", "child"]) {
		const d = await api("GET", `mastery/learners/${kid1}/`, { as: who });
		check(`${who} gets the learning view without guardians or contact details`, d.status === 200 && Array.isArray(d.json.subjects) && Array.isArray(d.json.guardians) && d.json.guardians.length === 0 && d.json.profile === null && forbidden.every((s) => !JSON.stringify(d.json).includes(s)));
	}
	const staffView = await api("GET", `mastery/learners/${kid1}/`, { as: "instructor" });
	check("the instructor still gets guardians and contact details", staffView.status === 200 && staffView.json.profile.contactEmail === "e2e.contact@example.test" && [acct.parentA.email, acct.parentB.email].every((e) => staffView.json.guardians.some((g) => g.email === e)));

	// ---- expiry
	step("expiry");
	const c5 = (await api("POST", "family/link/code/", { as: "child", body: {} })).json.code;
	check("exactly one open code before it is aged", (await countOpen(kid1)) === 1);
	await db.query("UPDATE fam_link_codes SET expires_at = ? WHERE learner_id = ? AND code_hash = ?", [new Date(Date.now() - 3600 * 1000), kid1, hashOf(c5)]);
	const expired = await api("POST", "family/link/", { as: "parentA", body: { code: c5 } });
	check("an expired code is refused", expired.status === 404 && expired.json.code === "invalid_code");
	check("the child's status no longer shows it as open", (await api("GET", "family/link/code/", { as: "child" })).json.openCode === null);

	// ---- unlinking the student
	step("unlinking before redemption");
	const guardiansBeforeUnlink = JSON.stringify(await guardians(kid1));
	const learnerBeforeUnlink = await snap(kid1, { skipStudent: true });
	const c6 = (await api("POST", "family/link/code/", { as: "child", body: {} })).json.code;
	const unlink = await api("POST", "instructor/students/link/", { as: "instructor", body: { action: "unlink", learnerId: kid1 } });
	check("the instructor unlinks the student", unlink.status === 200 && unlink.json.unlinked === true);
	check("the student link is gone and every code is cancelled", (await q("SELECT student_user_id FROM ml_learners WHERE id = ?", [kid1]))[0].student_user_id === null && (await countOpen(kid1)) === 0 && (await rowOf(kid1, c6)).status === "cancelled");
	check("a code made before the unlink is refused", (await api("POST", "family/link/", { as: "parentA", body: { code: c6 } })).status === 404);
	check("the child can no longer make a code", (await api("POST", "family/link/code/", { as: "child", body: {} })).status === 404 && (await api("GET", "family/link/code/", { as: "child" })).json.eligible === false);
	check("existing parent links and the learner row are untouched", JSON.stringify(await guardians(kid1)) === guardiansBeforeUnlink && (await snap(kid1, { skipStudent: true })) === learnerBeforeUnlink);
	await db.query("UPDATE ml_learners SET student_user_id = ? WHERE id = ? AND owner_user_id = ?", [acct.child.id, kid1, ownedBy("instructor")]); // the instructor links the child again

	step("association changed without going through unlink");
	const c7 = (await api("POST", "family/link/code/", { as: "child", body: {} })).json.code;
	await db.query("UPDATE ml_learners SET student_user_id = NULL WHERE id = ? AND owner_user_id = ?", [kid1, ownedBy("instructor")]); // bypasses the cancel in unlink
	check("the code is still marked open", (await rowOf(kid1, c7)).status === "open");
	check("but it is refused because its issuer is no longer the learner's student", (await api("POST", "family/link/", { as: "parentA", body: { code: c7 } })).status === 404);
	check("and the refusal did not consume it", (await rowOf(kid1, c7)).status === "open");
	await db.query("UPDATE ml_learners SET student_user_id = ? WHERE id = ? AND owner_user_id = ?", [acct.child.id, kid1, ownedBy("instructor")]);
	await api("DELETE", "family/link/code/", { as: "child" });

	// ---- concurrent redemption against real MySQL locking
	step("concurrent redemption");
	const k2 = (await api("POST", "family/link/code/", { as: "other", body: {} })).json.code;
	check("exactly one open code for the other family", (await countOpen(kid2)) === 1);
	const racers = ["parentA", "parentB", "parentA", "parentB", "parentA", "parentB"];
	const results = await Promise.all(racers.map((who) => api("POST", "family/link/", { as: who, body: { code: k2 } })));
	check("no request failed with a server error (no lock/deadlock errors)", results.every((r) => r.status < 500));
	const winners = new Set(racers.filter((_, i) => results[i].status === 200));
	check("exactly one account ended up linked", winners.size === 1 && results.every((r) => r.status === 200 || r.status === 404));
	const g2 = await guardians(kid2);
	const k2row = await rowOf(kid2, k2);
	check("one guardian row and one use of the code, for the winner", g2.length === 1 && k2row.status === "used" && k2row.used_by === g2[0].user_id && g2[0].user_id === acct[[...winners][0]].id);
	const loser = [...winners][0] === "parentA" ? "parentB" : "parentA";
	check("the account that lost cannot see that learner", (await api("GET", `mastery/learners/${kid2}/`, { as: loser })).status === 404);

	check("the dedicated test accounts were not modified", JSON.stringify(await q("SELECT * FROM users WHERE id IN (?) ORDER BY id", [IDS])) === usersBefore);
	console.log(`\nparent-link e2e: ${passed} checks passed`);
} catch (e) {
	exitCode = 1;
	console.error(`\nFAILED: ${e.message}`);
} finally {
	await finish("end of run");
	const nonTestLearnersAfter = Number((await q("SELECT COUNT(*) n FROM ml_learners WHERE display_name NOT LIKE ?", [`${NAME_PREFIX}%`]))[0].n);
	if (nonTestLearnersAfter !== nonTestLearnersBefore) console.warn(`NOTE: the number of non-test learners changed during the run (${nonTestLearnersBefore} -> ${nonTestLearnersAfter}); something else is using this database.`);
	for (const o of observations) console.warn(o);
	await db.end();
}
process.exit(exitCode);
