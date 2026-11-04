// Account-activation consistency. users.status is `tinyint(1) NULL DEFAULT 1`; Sequelize yields true/false/null,
// raw drivers 1/0, and a fixture or partial query can yield undefined. One rule (lib/auth/accountState.js) must
// decide all of them, identically, in sign-in, actor resolution, learner sessions and the admin tools.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";
import { accountIsActive } from "../../lib/auth/accountState.js";
import { verifyAccountToken, verifyLearnerToken } from "../../lib/mastery/tokens.js";
import { createMemoryRepo } from "../mastery/memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { setActive, AccountError } from "../../lib/admin/accounts.js";
import { filterAccounts } from "../../lib/admin/filterAccounts.js";

// value -> should the account be able to use the API?
const MATRIX = [
	[true, true],
	[1, true],
	[false, false],
	[0, false],
	[null, false],
	[undefined, false],
	// not database values: refused rather than guessed at
	["1", false],
	["true", false],
	["0", false],
	["false", false],
	[2, false],
	[-1, false],
	[NaN, false],
	[{}, false],
	[[], false],
];
const label = (v) => (typeof v === "number" && Number.isNaN(v) ? "NaN" : typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) ? "[]" : v && typeof v === "object" ? "{}" : String(v));
const ROLES = ["student", "instructor", "admin"];

test("accountIsActive: every supported status value", () => {
	for (const [value, expected] of MATRIX) assert.equal(accountIsActive({ status: value }), expected, `status ${label(value)}`);
});

test("accountIsActive: a missing user, or a user without the column loaded, is never active", () => {
	assert.equal(accountIsActive(null), false);
	assert.equal(accountIsActive(undefined), false);
	assert.equal(accountIsActive({}), false);
	assert.equal(accountIsActive({ id: "u1", role: "admin" }), false);
});

test("the existing local database values (status = 1 for students, instructors and admins) stay active", () => {
	for (const role of ROLES) assert.equal(accountIsActive({ role, status: 1 }), true);
	for (const role of ROLES) assert.equal(accountIsActive({ role, status: true }), true);
});

// ---- tokens: an already-issued token follows the same rule as sign-in ----
for (const role of ROLES) {
	test(`${role}: an issued token is honoured only while the stored status is active (every value)`, () => {
		const token = jwt.sign({ userId: "u1", role }, process.env.JWT_SECRET, { expiresIn: "7d" });
		for (const [value, expected] of MATRIX) {
			const claims = verifyAccountToken(token);
			const allowed = Boolean(claims) && accountIsActive({ id: claims.userId, status: value });
			assert.equal(allowed, expected, `${role} with stored status ${label(value)}`);
		}
	});
}

// ---- learner sessions (children / family devices) use the issuing account's status ----
test("learner sessions: valid only while the issuing account's status is an active value", async () => {
	const repo = createMemoryRepo();
	repo._db.users.push({ id: "fam-a", email: "a@example.com", role: "student" });
	const A = { kind: "account", userId: "fam-a", role: "student", permissions: resolvePermissions("student", ["learners.create"]) };
	const learner = await svc.createLearner(repo, A, { displayName: "kid", pin: "1111", subjects: ["math"], dailyGoal: 5, timeZone: "UTC" });
	const token = (await svc.unlockLearner(repo, A, learner.id, "1111", { now: Date.parse("2026-10-14T15:00:00Z") })).learnerToken;
	const row = repo._db.users.find((u) => u.id === "fam-a");
	for (const [value, expected] of MATRIX) {
		if (value === undefined) delete row.status; // the in-memory repo fills the DB default (1) for an unset column
		else row.status = value;
		const s = await svc.resolveLearnerSession(repo, verifyLearnerToken(token), null);
		if (value === undefined) {
			assert.equal(Boolean(s), true, "a fixture row that never set status reads back as the DB default (active)");
		} else {
			assert.equal(Boolean(s), expected, `learner session with owner status ${label(value)}`);
		}
	}
});

// ---- admin tools ----
const ids = { admin: "11111111-1111-4111-8111-111111111111", target: "22222222-2222-4222-8222-222222222222" };
const adminWorld = (status) => {
	const users = new Map([
		[ids.admin, { id: ids.admin, role: "admin", status: true, email: "a@example.com" }],
		[ids.target, { id: ids.target, role: "student", status, email: "s@example.com" }],
	]);
	return {
		users,
		updates: [],
		getUser: async (id) => (users.has(id) ? { ...users.get(id) } : null),
		updateUser: async function (id, patch) {
			this.updates.push(patch);
			users.set(id, { ...users.get(id), ...patch });
		},
		relatedCounts: async () => ({}),
		audit: async () => {},
	};
};
const admin = { userId: ids.admin, role: "admin" };

test("admin: Deactivate is offered only for active values, Reactivate only for inactive ones (and writes an explicit boolean)", async () => {
	for (const [value, active] of MATRIX.slice(0, 6)) {
		const reactivate = adminWorld(value);
		if (active) {
			await assert.rejects(setActive(reactivate, admin, ids.target, true), (e) => e instanceof AccountError && e.status === 409, `reactivate ${label(value)}`);
			await setActive(adminWorld(value), admin, ids.target, false);
		} else {
			await assert.rejects(setActive(adminWorld(value), admin, ids.target, false), (e) => e instanceof AccountError && e.status === 409, `deactivate ${label(value)}`);
			await setActive(reactivate, admin, ids.target, true);
			assert.deepEqual(reactivate.updates, [{ status: true }], `NULL/0/undefined are repaired to a real true, not left ambiguous (${label(value)})`);
		}
	}
});

test("admin table filters agree with the rule for every value", () => {
	for (const [value, active] of MATRIX) {
		const rows = [{ id: "x", first_name: "A", last_name: "B", email: "a@b.c", status: value }];
		assert.equal(filterAccounts(rows, "", "active").length, active ? 1 : 0, `active filter ${label(value)}`);
		assert.equal(filterAccounts(rows, "", "inactive").length, active ? 0 : 1, `inactive filter ${label(value)}`);
		assert.equal(filterAccounts(rows, "", "").length, 1);
	}
});

// ---- static guards: no code path may decide activation on its own ----
const ROOT = new URL("../../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), "utf8");

test("sign-in, actor resolution, profile and every service use accountIsActive", () => {
	assert.match(read("pages/api/users/signin.js"), /if \(!accountIsActive\(user\)\)/);
	assert.match(read("lib/mastery-server/http.js"), /if \(!accountIsActive\(user\)\) return null;/);
	assert.match(read("lib/auth/requireRole.js"), /getAccountActor\(req\)/);
	assert.match(read("pages/api/users/update.js"), /accountIsActive\(user\)/);
	for (const f of ["lib/auth/landing.js", "lib/family/links.js", "lib/family/service.js", "lib/instructor-applications/service.js", "lib/mastery/service.js", "lib/live-sessions/repo.js"]) {
		assert.match(read(f), /accountIsActive/, f);
	}
});

test("no source file decides activation with its own status comparison", () => {
	const offenders = [];
	const roots = ["lib", "pages", "components", "utils"].map((d) => fileURLToPath(new URL(d + "/", ROOT)));
	const skip = new Set([path.join(fileURLToPath(new URL("lib/auth/", ROOT)), "accountState.js")]);
	const bad = /\b(user|target|applicant|account|u)\.status\s*(===|!==|==|!=)\s*(false|true|0|1|null)\b|!\s*(user|target|u)\.status\b|Boolean\((user|target|u)\.status\)/;
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (/\.(js|mjs)$/.test(e.name) && !skip.has(p) && bad.test(fs.readFileSync(p, "utf8"))) offenders.push(p);
		}
	};
	roots.forEach(walk);
	assert.deepEqual(offenders, [], "use accountIsActive() instead of comparing users.status directly");
});

test("the User model defaults status to true, matching the column default", () => {
	assert.match(read("database/models/user.js"), /status: \{ type: Types\.BOOLEAN, defaultValue: true \}/);
});
