// Regression: a token issued BEFORE an administrator deactivated the account must stop working everywhere.
// Handlers need Sequelize, so these tests (a) run real signed JWTs through the same token check + active-account
// rule that getAccountActor uses, and (b) statically guard every API route so none can trust a token alone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";
import { verifyAccountToken } from "../../lib/mastery/tokens.js";
import { accountIsActive } from "../../lib/auth/accountState.js";

const ROOT = new URL("../../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), "utf8");
const issue = (userId, role) => jwt.sign({ userId, role, email: `${userId}@example.com` }, process.env.JWT_SECRET, { expiresIn: "7d" });

// What getAccountActor does, with the database replaced by a map.
const actorFor = (db, token) => {
	const claims = verifyAccountToken(token);
	if (!claims) return null;
	const user = db.get(claims.userId);
	return accountIsActive(user) ? { userId: user.id, role: user.role } : null;
};

for (const role of ["student", "instructor", "admin"]) {
	test(`${role}: an old token stops working when the account is deactivated and works again on reactivation`, () => {
		const db = new Map([["u1", { id: "u1", role, status: true }]]);
		const oldToken = issue("u1", role);
		assert.deepEqual(actorFor(db, oldToken), { userId: "u1", role });
		assert.deepEqual(actorFor(db, `Bearer ${oldToken}`), { userId: "u1", role });

		db.get("u1").status = false; // admin deactivates
		assert.equal(actorFor(db, oldToken), null);
		assert.equal(actorFor(db, `Bearer ${oldToken}`), null);

		db.get("u1").status = true; // admin reactivates: the same token is honoured again, nothing re-issued
		assert.deepEqual(actorFor(db, oldToken), { userId: "u1", role });
	});
}

test("a token for an account that no longer exists is refused", () => {
	assert.equal(actorFor(new Map(), issue("ghost", "student")), null);
});

test("forged, tampered and learner-type tokens are still refused", () => {
	const db = new Map([["u1", { id: "u1", role: "student", status: true }]]);
	assert.equal(actorFor(db, jwt.sign({ userId: "u1", role: "admin" }, "wrong-secret")), null);
	assert.equal(actorFor(db, issue("u1", "student") + "x"), null);
	assert.equal(actorFor(db, ""), null);
	assert.equal(actorFor(db, undefined), null);
	assert.equal(actorFor(db, jwt.sign({ userId: "u1", typ: "learner" }, process.env.JWT_SECRET)), null);
});

test("a role claim in an old token is irrelevant: the role is re-read from the database", () => {
	const db = new Map([["u1", { id: "u1", role: "student", status: true }]]);
	const adminClaim = issue("u1", "admin"); // e.g. issued before a demotion
	assert.equal(actorFor(db, adminClaim).role, "student");
});

test("getAccountActor uses the shared active-account rule", () => {
	const http = read("lib/mastery-server/http.js");
	assert.match(http, /import \{ accountIsActive \}/);
	assert.match(http, /if \(!accountIsActive\(user\)\) return null;/);
});

// ---- every legacy route named in the audit goes through the DB-backed gate ----
const GATED = {
	"pages/api/courses/index.js": /requireUser\(req, res\)/,
	"pages/api/learnings/index.js": /requireUser\(req, res\)/,
	"pages/api/learnings/my-purchases.js": /requireUser\(req, res\)/,
	"pages/api/wishlist/index.js": /requireUser\(req, res\)/,
	"pages/api/users/profile-photo.js": /requireUser\(req, res\)/,
	"pages/api/users/update.js": /requireUser\(req, res\)/,
};
for (const [file, gate] of Object.entries(GATED)) {
	test(`${file} checks the account's current status before doing anything`, () => {
		const src = read(file);
		assert.match(src, gate);
		// the gate runs before any handler body (GET/PUT/etc.) is dispatched
		assert.ok(src.search(gate) < src.search(/switch \(req\.method\)/), "gate must precede method dispatch");
	});
}

test("requireUser delegates to the DB-backed requireRole/getAccountActor", () => {
	assert.match(read("lib/auth/access.js"), /requireUser = \(req, res, roles = ANY_ROLE\) => requireRole\(req, res, roles\)/);
	assert.match(read("lib/auth/requireRole.js"), /getAccountActor\(req\)/);
});

test("no API route authenticates with jwt.verify alone (it would accept old tokens of deactivated users)", () => {
	const offenders = [];
	const apiDir = fileURLToPath(new URL("pages/api", ROOT));
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (/\.js$/.test(e.name) && /jwt\.verify\(/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(apiDir, p));
		}
	};
	walk(apiDir);
	assert.deepEqual(offenders, [], `routes still verifying tokens by signature only: ${offenders.join(", ")}`);
});
