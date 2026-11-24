// The application reads the MIGRATED data in the real PostgreSQL `public` schema correctly.
//
// STRICTLY READ-ONLY: every pooled connection is switched to default_transaction_read_only on connect, so a write would be
// rejected by the server itself. Nothing is created, changed or deleted; sign-in is tested through the account lookup with a
// token signed in the test, so no password or credential is read, printed or changed.
//
// Skipped (with the reason) when PostgreSQL is not reachable or the data migration has not been run yet.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { pgReachable } from "./pg/schema.mjs";

const reachable = await pgReachable();
let migrated = false;
if (reachable) {
	const c = new pg.Client({ host: process.env.PG_HOST || "localhost", port: Number(process.env.PG_PORT) || 5432, database: process.env.PG_DATABASE || "sharpstudy_dev", user: process.env.PG_USER || "sharpstudy_dev" });
	await c.connect();
	try {
		const r = await c.query("select to_regclass('public.mysql_migration_history') is not null as has_history, (select count(*) from public.users) as users");
		migrated = r.rows[0].has_history && Number(r.rows[0].users) > 0;
	} finally {
		await c.end();
	}
}
const skip = !reachable ? "PostgreSQL is not reachable" : !migrated ? "the MySQL -> PostgreSQL data migration has not been run yet" : false;

const A = {};
const load = (p) => import(pathToFileURL(path.join(process.cwd(), p)).href);
if (!skip) {
	register("./pg/hooks.mjs", import.meta.url);
	delete process.env.PG_SEARCH_PATH;
	process.env.DB_DIALECT = "postgres";
	process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret";
	A.connection = (await load("database/connection.js")).default;
	A.connection.options.logging = false;
	A.connection.addHook("afterConnect", (conn) => conn.query("SET default_transaction_read_only = on"));
	A.models = await load("database/models/index.js");
	A.mastery = await load("database/models/mastery.js");
	A.masteryRepo = (await load("lib/mastery-server/repo.js")).default;
	A.meetingRepo = (await load("lib/meetings/repo.js")).default;
	A.http = await load("lib/mastery-server/http.js");
	A.dialect = await load("lib/db/dialect.js");
	A.sequelize = await import("sequelize");
	A.jwt = (await import("jsonwebtoken")).default;
}
after(async () => {
	if (!skip) await A.connection.close();
});
const rows = async (sql, bind) => (await A.connection.query(sql, { type: A.sequelize.QueryTypes.SELECT, bind }));

test("the application is connected to the real public schema, read-only", { skip }, async () => {
	const [r] = await rows("select current_schema() as s, current_setting('transaction_read_only') as ro, current_database() as db");
	assert.equal(r.s, "public");
	assert.equal(r.ro, "on");
	assert.equal(r.db, "sharpstudy_dev");
	await assert.rejects(A.connection.query("insert into meeting_schedule_lock (id) values (99)"), (e) => /read-only/i.test(e.message));
});

test("users: all 21 accounts, roles and statuses survived", { skip }, async () => {
	assert.equal(await A.models.User.count(), 21);
	const byRole = Object.fromEntries((await rows("select role, status, count(*)::int as n from users group by role, status")).map((r) => [`${r.role}/${r.status}`, r.n]));
	assert.deepEqual(byRole, { "student/true": 15, "student/false": 2, "admin/true": 1, "instructor/true": 3 });
});

test("authentication lookup works on the migrated data (no credentials read, none changed)", { skip }, async () => {
	const [admin] = await rows("select id, email from users where role = 'admin' and status = true limit 1");
	const token = A.jwt.sign({ userId: admin.id }, process.env.JWT_SECRET, { expiresIn: "5m" });
	const actor = await A.http.getAccountActor({ headers: { authorization: token } });
	assert.equal(actor.role, "admin");
	assert.equal(actor.userId, admin.id);
	// the e-mail lookup used by sign-in finds the account in any letter case
	const found = await A.models.User.unscoped().findOne({ where: A.dialect.ciEquals(A.connection, "email", admin.email.toUpperCase()), attributes: ["id", "role", "status", "email_confirmed"] });
	assert.equal(found.id, admin.id);
	// a deactivated account is never an actor
	const [off] = await rows("select id from users where status = false limit 1");
	assert.equal(await A.http.getAccountActor({ headers: { authorization: A.jwt.sign({ userId: off.id }, process.env.JWT_SECRET) } }), null);
	assert.equal(await A.http.getAccountActor({ headers: { authorization: "garbage" } }), null);
	// Password hashes are checked by SHAPE only (never read or printed). In the SOURCE data 19 of 21 accounts hold bcrypt hashes and 2
	// accounts (both disabled, unconfirmed students) hold 60-character values that are not in bcrypt form; the migration preserved them as they were.
	const odd = await rows("select status, email_confirmed, char_length(password)::int as len from users where password !~ '^[$]2[aby][$]'");
	assert.deepEqual(odd, [{ status: false, email_confirmed: false, len: 60 }, { status: false, email_confirmed: false, len: 60 }]);
});

test("categories, courses, enrolments and instructors read through the models", { skip }, async () => {
	assert.equal(await A.models.Category.count(), 3);
	assert.equal(await A.models.Course.count(), 6);
	assert.equal(await A.models.Enrolment.count({ where: { status: "paid" } }), 12);
	const courses = await A.models.Course.findAll({ include: [{ model: A.models.User, as: "user", attributes: ["first_name", "last_name"] }, { model: A.models.Category, as: "category", attributes: ["name"] }] });
	assert.equal(courses.length, 6);
	assert.ok(courses.every((c) => c.user && c.category), "every course resolves its instructor and category (foreign keys)");
	const home = await A.models.Course.findAll({ order: A.sequelize.literal(A.dialect.randomOrderSql(A.connection)), limit: 4, include: [{ model: A.models.User, as: "user", attributes: ["first_name"] }, { model: A.models.Enrolment, as: "enrolments", attributes: ["id"] }], where: { in_home_page: true, approved: true } });
	assert.ok(home.length <= 4);
	const price = await A.models.Enrolment.sum("bought_price", { where: { status: "paid" } });
	assert.equal(Math.round(price), 1297);
	const earnings = await A.models.Instructor_Earning.sum("earnings");
	assert.equal(Math.round(earnings), 1796);
});

test("Mastery Ladder reads: attempts, statistics, daily activity, settings and roles (JSON)", { skip }, async () => {
	const [top] = await rows("select learner_id, count(*)::int as n from ml_attempts group by learner_id order by n desc limit 1");
	const s = await A.masteryRepo.attemptStats(top.learner_id);
	assert.equal(s.count, top.n);
	assert.ok(s.accuracySum > 0 && Number.isFinite(s.durationMsSum));
	assert.ok(s.lastCompletedAt instanceof Date);
	const total = await A.mastery.ML_Attempt.findAll({ attributes: [[A.sequelize.fn("COUNT", A.sequelize.col("id")), "n"], [A.sequelize.fn("SUM", A.sequelize.col("accuracy")), "a"]], raw: true });
	assert.equal(Number(total[0].n), 19);
	assert.ok(Math.abs(Number(total[0].a) - 18.25) < 1e-6);
	const activity = await A.mastery.ML_DailyActivity.findAll({ raw: true });
	assert.equal(activity.length, 7);
	assert.equal(activity.reduce((a, r) => a + r.worksheets, 0), 19);
	assert.equal(activity.reduce((a, r) => a + r.stars, 0), 45);
	assert.equal(activity.reduce((a, r) => a + r.seconds, 0), 536);
	assert.ok(activity.every((r) => typeof r.local_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.local_date)), "DATE values are plain date strings");
	// JSON(B) is read back as real structures
	assert.equal(typeof (await A.masteryRepo.getSetting("tutor.model")), "string");
	const roles = await A.mastery.ML_Role.findAll();
	assert.equal(roles.length, 3);
	// every role has a real JSON array; in the source the Auditor role has 0 permissions, Family 1, Support 2
	assert.ok(roles.every((r) => Array.isArray(r.permissions)));
	assert.deepEqual(Object.fromEntries(roles.map((r) => [r.name, r.permissions.length])), { Auditor: 0, Family: 1, Support: 2 });
	const audit = await A.mastery.ML_AuditLog.findAll({ limit: 50, order: [["created_at", "DESC"]] });
	assert.ok(audit.length > 0 && audit.every((a) => a.created_at instanceof Date));
});

test("binary data is byte-exact: Buffers read through the application match PostgreSQL's own SHA-256", { skip }, async () => {
	const files = await rows("select id, data, octet_length(data)::int as len, encode(sha256(data), 'hex') as sha from live_question_images order by id");
	assert.equal(files.length, 2);
	for (const f of files) {
		assert.ok(Buffer.isBuffer(f.data));
		assert.equal(f.data.length, f.len);
		assert.equal(createHash("sha256").update(f.data).digest("hex"), f.sha);
	}
	assert.deepEqual(files.map((f) => f.len), [674773, 366028]);
	const [resume] = await rows("select data, octet_length(data)::int as len, encode(sha256(data), 'hex') as sha from telecaller_resumes");
	assert.equal(resume.len, 208131);
	assert.equal(createHash("sha256").update(resume.data).digest("hex"), resume.sha);
});

test("meetings, live classes and parent/student links read correctly", { skip }, async () => {
	const counts = await A.meetingRepo.countsByStatus();
	assert.equal(counts.pending, 1);
	const [m] = await rows("select reference, email from meeting_requests");
	assert.ok(await A.meetingRepo.findByReference(m.reference.toLowerCase()), "reference lookup ignores case");
	assert.equal((await A.meetingRepo.list({ q: m.email.toUpperCase(), status: "", page: 1, pageSize: 10 })).total, 1, "search ignores case");
	assert.equal(await A.mastery.ML_Guardian.count(), 3);
	assert.equal(await A.mastery.ML_Learner.count(), 4);
	const [codes] = await rows("select count(*)::int as n from fam_link_codes where status = 'used'");
	assert.equal(codes.n, 6);
});

test("every foreign key of the migrated data is satisfied and validated", { skip }, async () => {
	const [fk] = await rows("select count(*)::int as n, count(*) filter (where convalidated)::int as ok from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace");
	assert.deepEqual(fk, { n: 105, ok: 105 });
});

test("the MySQL migration history is kept apart from PostgreSQL's own history", { skip }, async () => {
	const hist = await rows("select id, name from mysql_migration_history order by id");
	assert.equal(hist.length, 35);
	assert.deepEqual(hist.map((r) => r.id), Array.from({ length: 35 }, (_, i) => i + 1));
	assert.ok(hist.some((r) => r.name === "20261025000000-parent-link-requests.js"), "the removed migration is still recorded as applied history");
	const own = (await rows("select name from sequelizemeta order by name")).map((r) => r.name);
	// the four baseline migrations plus the additive Free Demo columns on meeting_requests (20261123000006)
	assert.equal(own.length, 5);
	assert.ok(own.includes("20261123000006-pg-meeting-requests-free-demo.js"));
	assert.ok(own.every((n) => /pg-/.test(n)), "sequelizemeta lists only the PostgreSQL migrations");
});
