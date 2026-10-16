// READ-ONLY end-to-end check of learner identity against a RUNNING dev server and the real dev
// database: it signs tokens for EXISTING learners/accounts and only issues GET requests.
//   1. yarn dev      2. node tests/e2e/learner-identity.e2e.mjs
// Nothing is created, changed or deleted. localhost only; never prints secrets.
import fs from "node:fs";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");

const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT });
const [learners] = await db.query("SELECT id, display_name, owner_user_id, daily_goal FROM ml_learners ORDER BY created_at");
const [users] = await db.query("SELECT id, role, email FROM users");
const byId = new Map(users.map((u) => [u.id, u]));
const owners = [...new Set(learners.map((l) => l.owner_user_id))];
if (owners.length < 2) {
	console.log("learner-identity e2e: SKIPPED - needs learners owned by two different accounts in the dev DB (found " + owners.length + ")");
	await db.end();
	process.exit(0);
}
const [ownerA, ownerB] = owners; // two unrelated accounts
const ofA = learners.filter((l) => l.owner_user_id === ownerA);
const ofB = learners.filter((l) => l.owner_user_id === ownerB);

const accountToken = (id) => jwt.sign({ userId: id, role: byId.get(id).role, email: byId.get(id).email }, process.env.JWT_SECRET, { expiresIn: "10m" });
const learnerToken = (l, acct) => jwt.sign({ typ: "ml_learner", lid: l.id, acct }, process.env.JWT_SECRET, { expiresIn: "10m" });
let passed = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	passed++;
};
const get = async (path, { account, learner } = {}) => {
	const headers = {};
	if (account) headers.Authorization = accountToken(account);
	if (learner) headers["x-learner-token"] = learner;
	const res = await fetch(`${BASE}/api/mastery/${path}`, { headers });
	let json = null;
	try {
		json = await res.json();
	} catch (e) {
		/* empty */
	}
	return { status: res.status, json };
};

try {
	// the picker for each account lists exactly that account's learners
	const listA = await get("learners/", { account: ownerA });
	const listB = await get("learners/", { account: ownerB });
	check("account A's picker lists only A's learners", listA.status === 200 && listA.json.learners.map((l) => l.id).sort().join() === ofA.map((l) => l.id).sort().join());
	check("account B's picker lists only B's learners", listB.status === 200 && listB.json.learners.map((l) => l.id).sort().join() === ofB.map((l) => l.id).sort().join());
	check("the two pickers share no learner", !listA.json.learners.some((l) => listB.json.learners.some((m) => m.id === l.id)));

	const kidB = ofB[0];
	const tokenB = learnerToken(kidB, ownerB);
	// A's browser still holds B's learner session: it must NOT be shown under A
	const stale = await get("study/home/", { account: ownerA, learner: tokenB });
	check("a learner session from another account is refused (401)", stale.status === 401);
	check("/me does not report that learner under the other account", (await get("me/", { account: ownerA, learner: tokenB })).json.learner === null);
	// the right account sees its learner; the same learner-only device also works
	const mine = await get("study/home/", { account: ownerB, learner: tokenB });
	check("the issuing account sees its own learner's dashboard", mine.status === 200 && mine.json.learner.id === kidB.id && mine.json.learner.displayName === kidB.display_name);
	check("goal on the dashboard is that learner's saved goal", mine.json.dailyGoal === kidB.daily_goal);
	const alone = await get("study/home/", { learner: tokenB });
	check("a learner-only device (no account header) still works", alone.status === 200 && alone.json.learner.id === kidB.id);
	// every learner of A loads its own data
	for (const l of ofA) {
		const h = await get("study/home/", { account: ownerA, learner: learnerToken(l, ownerA) });
		check(`A's learner "${l.display_name}" loads its own goal and identity`, h.status === 200 && h.json.learner.id === l.id && h.json.dailyGoal === l.daily_goal);
	}
	// a token claiming a learner the account does not own is refused even when correctly signed
	const forged = await get("study/home/", { account: ownerA, learner: learnerToken(kidB, ownerA) });
	check("a learner token naming someone else's learner is refused", forged.status === 401);
	// account-level access to someone else's learner
	const otherLearner = await get(`learners/${kidB.id}/`, { account: ownerA });
	check("account A cannot open B's learner (404: existence is not revealed)", otherLearner.status === 404);
	check("the owner can open it", (await get(`learners/${kidB.id}/`, { account: ownerB })).status === 200);
	check("anonymous gets nothing", (await get("learners/")).status === 401);
	console.log(`learner-identity e2e: ${passed} checks passed (read-only)`);
} finally {
	await db.end();
}
