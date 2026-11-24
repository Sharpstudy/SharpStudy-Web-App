// MySQL (the default and the source of truth) keeps working after the PostgreSQL compatibility changes.
//
// These tests run the REAL changed code (repositories, models, sign-in lookups) against the real local MySQL database, but
// every pooled connection is switched to READ ONLY on connect, so nothing here can write to it. Credentials come from the
// untracked .env (never printed). When MySQL is not reachable the file is reported as SKIPPED with the reason.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// ---- load .env into process.env (only keys that are not set already)
try {
	for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
		if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
} catch {
	/* no .env: the reachability check below decides */
}
delete process.env.DB_DIALECT; // the default dialect is the thing under test
delete process.env.PG_SEARCH_PATH;
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret";

async function mysqlReachable() {
	let c;
	try {
		c = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT, connectTimeout: 4000 });
		await c.query("select 1");
		return true;
	} catch {
		return false;
	} finally {
		if (c) await c.end().catch(() => {});
	}
}

const reachable = (await mysqlReachable()) && process.env.DB_NAME_DEVELOPMENT === "sharpstudy_dev";
const skip = reachable ? false : "local MySQL sharpstudy_dev is not reachable (needs the .env credentials)";
const A = {};
const load = (p) => import(pathToFileURL(path.join(process.cwd(), p)).href);

if (reachable) {
	register("./pg/hooks.mjs", import.meta.url);
	A.connection = (await load("database/connection.js")).default;
	A.connection.options.logging = false; // the development config logs every query, including e-mail addresses
	// belt and braces: any write through this connection is rejected by the server itself
	A.connection.addHook("afterConnect", (conn) => new Promise((resolve, reject) => conn.query("SET SESSION TRANSACTION READ ONLY", (e) => (e ? reject(e) : resolve()))));
	A.masteryRepo = (await load("lib/mastery-server/repo.js")).default;
	A.meetingRepo = (await load("lib/meetings/repo.js")).default;
	A.http = await load("lib/mastery-server/http.js");
	A.dialect = await load("lib/db/dialect.js");
	A.dbErrors = await load("lib/mastery-server/dbErrors.js");
	A.models = await load("database/models/index.js");
	A.sequelize = await import("sequelize");
	A.jwt = (await import("jsonwebtoken")).default;
}
after(async () => {
	if (reachable) await A.connection.close();
});

const rows = async (sql, replacements) => (await A.connection.query(sql, { type: A.sequelize.QueryTypes.SELECT, replacements }));

test("MySQL stays the default dialect and runs sessions in UTC", { skip }, async () => {
	assert.equal(A.connection.getDialect(), "mysql");
	const [r] = await rows("select @@session.time_zone as tz, @@session.transaction_read_only as ro, database() as db");
	assert.equal(r.tz, "+00:00");
	assert.equal(Number(r.ro), 1, "the test session is read-only");
	assert.equal(r.db, "sharpstudy_dev");
});

test("writes are impossible through this test connection", { skip }, async () => {
	await assert.rejects(A.connection.query("insert into meeting_schedule_lock (id) values (99)"), (e) => /read only/i.test(e.message));
});

test("the source database still matches the Stage 1 baseline (read-only)", { skip }, async () => {
	const count = async (t) => Number((await rows(`select count(*) as n from \`${t}\``))[0].n);
	assert.equal(await count("users"), 21);
	assert.equal(await count("ml_attempts"), 19);
	assert.equal(await count("enrolments"), 12);
	assert.equal(await count("book_orders"), 1);
	const [tables] = await rows("select count(*) as n from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE'");
	assert.equal(Number(tables.n), 67);
});

test("e-mail lookups still ignore case on MySQL", { skip }, async () => {
	const [u] = await rows("select id, email from users order by created_at limit 1");
	const swapped = u.email.toUpperCase();
	const found = await A.masteryRepo.findUserByEmail(swapped);
	assert.equal(found && found.id, u.id);
	assert.equal(await A.masteryRepo.findUserByEmail("nobody-" + Date.now() + "@example.invalid"), null);
	assert.deepEqual(A.dialect.ciEquals(A.connection, "email", "X"), { email: "X" }, "MySQL query is exactly the one used before");
});

test("admin search (LIKE) behaves the same in upper and lower case", { skip }, async () => {
	const [u] = await rows("select first_name from users where first_name is not null and char_length(first_name) >= 3 limit 1");
	const frag = u.first_name.slice(0, 3);
	const lowerHit = await A.masteryRepo.listUsers({ q: frag.toLowerCase() });
	const upperHit = await A.masteryRepo.listUsers({ q: frag.toUpperCase() });
	assert.ok(lowerHit.count >= 1);
	assert.equal(upperHit.count, lowerHit.count);
});

test("attempt statistics (renamed lower-case aliases) equal a direct aggregate on MySQL", { skip }, async () => {
	const [l] = await rows("select learner_id, count(*) as n from ml_attempts group by learner_id order by n desc limit 1");
	const direct = (await rows("select count(*) as c, coalesce(sum(accuracy),0) as a, coalesce(sum(duration_ms),0) as d, coalesce(sum(hints_used),0) as h from ml_attempts where learner_id = :id", { id: l.learner_id }))[0];
	const s = await A.masteryRepo.attemptStats(l.learner_id);
	assert.equal(s.count, Number(direct.c));
	assert.ok(Math.abs(s.accuracySum - Number(direct.a)) < 1e-9);
	assert.equal(s.durationMsSum, Number(direct.d));
	assert.equal(s.hintsSum, Number(direct.h));
	assert.ok(s.lastCompletedAt instanceof Date);
	for (const k of ["count", "accuracySum", "durationMsSum", "hintsSum"]) assert.equal(Number.isFinite(s[k]), true, k);
});

test("meetings repository reads work on MySQL (counts are numbers, reference lookup ignores case)", { skip }, async () => {
	const counts = await A.meetingRepo.countsByStatus();
	assert.ok(Object.values(counts).every((n) => typeof n === "number"));
	const [m] = await rows("select reference from meeting_requests limit 1");
	assert.ok((await A.meetingRepo.findByReference(m.reference.toLowerCase())) !== null);
	const list = await A.meetingRepo.list({ q: m.reference.toLowerCase(), status: "", page: 1, pageSize: 10 });
	assert.ok(list.total >= 1);
});

test("authentication on MySQL: a valid token yields the actor, a deactivated or unknown account never does", { skip }, async () => {
	const [admin] = await rows("select id, role from users where role = 'admin' and status = 1 limit 1");
	const sign = (userId) => A.jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "5m" });
	const actor = await A.http.getAccountActor({ headers: { authorization: sign(admin.id) } });
	assert.equal(actor.role, "admin");
	const [off] = await rows("select id from users where status = 0 limit 1");
	if (off) assert.equal(await A.http.getAccountActor({ headers: { authorization: sign(off.id) } }), null);
	assert.equal(await A.http.getAccountActor({ headers: { authorization: sign("00000000-0000-4000-8000-000000000000") } }), null);
	assert.equal(await A.http.getAccountActor({ headers: { authorization: "garbage" } }), null);
});

test("the home page queries (random order, eager loading) run on MySQL", { skip }, async () => {
	const order = A.sequelize.literal(A.dialect.randomOrderSql(A.connection));
	const courses = await A.models.Course.findAll({
		order,
		limit: 4,
		include: [
			{ model: A.models.User, as: "user", attributes: ["first_name", "last_name", "profile_photo"] },
			{ model: A.models.Enrolment, as: "enrolments", attributes: ["id"] },
		],
		where: { in_home_page: true, approved: true },
	});
	assert.ok(Array.isArray(courses));
	assert.ok(Array.isArray(await A.models.Category.findAll({ order, limit: 12 })));
});

test("missing-table errors are still mapped on MySQL", { skip }, async () => {
	await assert.rejects(A.connection.query("select * from no_such_table_zzz"), (e) => {
		assert.equal(A.dbErrors.isSchemaMismatch(e), true);
		assert.equal(A.dbErrors.friendlyDbError(e).status, 503);
		assert.match(A.dbErrors.logLine(e), /ER_NO_SUCH_TABLE \(.*no_such_table_zzz\)/);
		assert.equal(A.dialect.isMissingTableError(e), true);
		return true;
	});
});

test("the MySQL statements still parse on the server (read-only EXPLAIN of the SELECT parts)", { skip }, async () => {
	const [p] = await rows("explain select id from ml_presence where kind = 'user' and subject_id = :s", { s: "00000000-0000-4000-8000-000000000000" });
	assert.ok(p);
	const [lock] = await rows("select id from meeting_schedule_lock where id = 1");
	assert.equal(Number(lock.id), 1, "the lock row exists in MySQL (created by the migration)");
});

// ---- Phase 7.1: slug lookups (MySQL finds records whatever the letter case: the behaviour PostgreSQL now matches) -------
test("slug lookups on MySQL: lower, UPPER and Mixed case find the same course, category and book; unknown and empty slugs find nothing", { skip }, async () => {
	const [c] = await rows("select slug from courses where approved = 1 limit 1");
	const [k] = await rows("select slug from categories limit 1");
	const [b] = await rows("select slug from books limit 1");
	const variants = (slug) => [slug, slug.toUpperCase(), slug.replace(/(^|-)([a-z])/g, (_, a, x) => a + x.toUpperCase())];
	const mockRes = () => ({ statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(x) { this.body = x; return this; }, setHeader() {} });
	const call = async (handler, query) => {
		const res = mockRes();
		await handler({ method: "GET", query, headers: {}, body: {} }, res);
		return JSON.stringify({ s: res.statusCode, b: JSON.parse(JSON.stringify(res.body ?? null)) });
	};
	for (const [label, p, slug] of [["course", "pages/api/courses/course/index.js", c.slug], ["course videos", "pages/api/learnings/videos/[slug].js", c.slug], ["category", "pages/api/categories/[slug].js", k.slug]]) {
		const handler = (await load(p)).default;
		const base = await call(handler, { slug });
		assert.ok(base.includes(slug), `${label}: the stored slug finds the record`);
		for (const v of variants(slug)) assert.equal(await call(handler, { slug: v }), base, `${label}: "${v}"`);
		assert.ok(!(await call(handler, { slug: "no-such-slug-xyz" })).includes(slug), `${label}: unknown slug`);
		assert.equal(await call(handler, { slug: "" }), await call(handler, { slug: "no-such-slug-xyz" }), `${label}: empty slug`);
	}
	const bookRepo = (await load("lib/books/repo.js")).default;
	const liveRepo = (await load("lib/live-questions/repo.js")).default;
	for (const v of variants(b.slug)) assert.equal((await bookRepo.getBookBySlug(v)).slug, b.slug, `book "${v}"`);
	for (const v of variants(c.slug)) assert.equal((await liveRepo.getCourseBySlug(v)).slug, c.slug, `class "${v}"`);
	assert.equal(await bookRepo.getBookBySlug("no-such-slug-xyz"), null);
	assert.equal(await liveRepo.getCourseBySlug(""), null);
});
