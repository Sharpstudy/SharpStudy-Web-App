// Admin account management (students + instructors). In-memory repo only: no database is touched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AccountError, getDetails, setActive, anonymizeAccount, ANON_DOMAIN } from "../../lib/admin/accounts.js";

const ID = {
	admin: "11111111-1111-4111-8111-111111111111",
	admin2: "11111111-1111-4111-8111-222222222222",
	student: "22222222-2222-4222-8222-222222222222",
	instructor: "33333333-3333-4333-8333-333333333333",
};

function world() {
	const users = new Map();
	const base = (id, role, extra = {}) => ({
		id, role, status: true, first_name: role, last_name: "Test", email: `${role}@example.com`, phone: "555", bio: "hi",
		password: "$2b$hash", email_confirmed: true, ...extra,
	});
	users.set(ID.admin, base(ID.admin, "admin"));
	users.set(ID.admin2, base(ID.admin2, "admin", { email: "admin2@example.com" }));
	users.set(ID.student, base(ID.student, "student"));
	users.set(ID.instructor, base(ID.instructor, "instructor", { instructor_subject: "Maths" }));
	// Educational/financial records live elsewhere and must never be touched by these operations.
	const records = { enrolments: 4, paidEnrolments: 2, progressRecords: 9, coursesOwned: 1, earnings: 3, bookOrders: 1, learnerProfiles: 2, assignmentsCreated: 5 };
	const log = [];
	const repo = {
		users, records, log, updates: [],
		getUser: async (id) => (users.has(id) ? { ...users.get(id) } : null),
		updateUser: async (id, patch) => { repo.updates.push({ id, patch }); users.set(id, { ...users.get(id), ...patch }); },
		relatedCounts: async () => ({ ...records }),
		audit: async (row) => { log.push(row); },
	};
	return repo;
}
const admin = { userId: ID.admin, role: "admin" };
const fails = (p, status, re) => assert.rejects(p, (e) => e instanceof AccountError && e.status === status && (!re || re.test(e.message)));

for (const who of ["student", "instructor"]) {
	test(`${who}: deactivate then reactivate changes only the status flag`, async () => {
		const repo = world();
		const before = { ...repo.users.get(ID[who]) };
		await setActive(repo, admin, ID[who], false);
		assert.equal(repo.users.get(ID[who]).status, false);
		await setActive(repo, admin, ID[who], true);
		const after = repo.users.get(ID[who]);
		assert.deepEqual(after, before); // credentials and profile untouched
		assert.deepEqual(repo.updates.map((u) => u.patch), [{ status: false }, { status: true }]);
		assert.deepEqual(repo.records, world().records); // no record counts moved
		assert.deepEqual(repo.log.map((l) => l.action), ["admin.account.deactivate", "admin.account.reactivate"]);
	});
}

test("deactivating twice / reactivating an active account is rejected", async () => {
	const repo = world();
	await fails(setActive(repo, admin, ID.student, true), 409);
	await setActive(repo, admin, ID.student, false);
	await fails(setActive(repo, admin, ID.student, false), 409);
});

test("status must be a real boolean", async () => {
	await fails(setActive(world(), admin, ID.student, "false"), 422);
	await fails(setActive(world(), admin, ID.student, undefined), 422);
});

test("an admin cannot deactivate or anonymize themselves", async () => {
	const repo = world();
	await fails(setActive(repo, admin, ID.admin, false), 422, /your own/);
	await fails(anonymizeAccount(repo, admin, ID.admin, { confirmEmail: "admin@example.com" }), 422, /your own/);
	assert.equal(repo.updates.length, 0);
});

test("other administrators (incl. the last active one) are never manageable here", async () => {
	const repo = world();
	await fails(setActive(repo, admin, ID.admin2, false), 403);
	await fails(anonymizeAccount(repo, admin, ID.admin2, { confirmEmail: "admin2@example.com" }), 403);
	assert.equal(repo.updates.length, 0);
});

test("invalid ids and unknown users are rejected on the server", async () => {
	const repo = world();
	await fails(setActive(repo, admin, "not-a-uuid", false), 422);
	await fails(getDetails(repo, admin, "1 OR 1=1"), 422);
	await fails(setActive(repo, admin, "99999999-9999-4999-8999-999999999999", false), 404);
});

test("anonymize requires the exact email, then anonymizes without touching records", async () => {
	const repo = world();
	await fails(anonymizeAccount(repo, admin, ID.student, {}), 422);
	await fails(anonymizeAccount(repo, admin, ID.student, { confirmEmail: "wrong@example.com" }), 422);
	assert.equal(repo.updates.length, 0);

	await anonymizeAccount(repo, admin, ID.student, { confirmEmail: " STUDENT@example.com " });
	const u = repo.users.get(ID.student);
	assert.equal(u.email, `anonymized-${ID.student}@${ANON_DOMAIN}`);
	assert.equal(u.status, false);
	assert.equal(u.phone, null);
	assert.equal(u.bio, null);
	assert.equal(u.id, ID.student); // row kept, so every FK-linked record stays attached
	assert.ok(u.password.startsWith("!anonymized:")); // can never match a bcrypt compare
	assert.deepEqual(repo.records, world().records);
	assert.equal(repo.log.at(-1).action, "admin.account.anonymize");

	await fails(anonymizeAccount(repo, admin, ID.student, { confirmEmail: u.email }), 409);
	await fails(setActive(repo, admin, ID.student, true), 409, /cannot be reactivated/);
});

test("details report the records that are kept", async () => {
	const d = await getDetails(world(), admin, ID.instructor);
	assert.equal(d.user.role, "instructor");
	assert.equal(d.records.assignmentsCreated, 5);
	assert.equal(d.anonymized, false);
});

test("the service never issues a hard delete", () => {
	const src = fs.readFileSync(new URL("../../lib/admin/accounts.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../../lib/admin/accountsRepo.js", import.meta.url), "utf8");
	assert.doesNotMatch(src, /\.destroy\(|\bDELETE FROM\b|\.truncate\(/i);
});

// ---- wiring checks: permissions are enforced by the API, and inactive users cannot sign in ----
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("API route is admin-only and checks the role before any action", () => {
	const src = read("pages/api/admin/users/[id].js");
	assert.match(src, /requireRole\(req, res, \["admin"\]\)/);
	assert.ok(src.indexOf("requireRole") < src.indexOf("getDetails("));
});

test("requireRole rejects missing tokens (401), non-admins (403) and inactive accounts", async () => {
	process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";
	const http = read("lib/mastery-server/http.js");
	assert.match(http, /if \(!accountIsActive\(user\)\) return null;/); // inactive => no actor => 401
	const rr = read("lib/auth/requireRole.js");
	assert.match(rr, /res\.status\(401\)/);
	assert.match(rr, /res\.status\(403\)/);
});

test("sign-in refuses inactive accounts before checking the password", () => {
	const src = read("pages/api/users/signin.js");
	assert.ok(src.indexOf("!accountIsActive(user)") > -1 && src.indexOf("!accountIsActive(user)") < src.indexOf("bcrypt.compare"));
});

test("an open session of a deactivated user is ended by the profile endpoint", () => {
	const src = read("pages/api/users/update.js");
	assert.match(src, /user && !accountIsActive\(user\)\)[\s\S]{0,120}401/);
});
