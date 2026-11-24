// PostgreSQL compatibility of the REAL application code (repositories, models, API route handlers).
//
// Safety: every row is written into a THROW-AWAY schema (ss_test_<random>) that is created from the real schema SQL and dropped
// at the end (tests/db/pg/schema.mjs). The application connection is pinned to that schema, `public` is not even on its search
// path, so nothing here can touch the real tables. The test also proves `public` is untouched at the end (same tables and row
// count as before, whether or not the data migration has been run).
//
// Needs PostgreSQL on localhost:5432 with the sharpstudy_dev login (pgpass.conf or PG_PASSWORD). When it is not reachable the
// whole file is reported as SKIPPED with that reason (it is never silently green).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pgReachable, createTestSchema, dropTestSchema, publicRowTotal } from "./pg/schema.mjs";

const reachable = await pgReachable();
const skip = reachable ? false : "PostgreSQL is not reachable on localhost:5432 (needs pgpass.conf or PG_PASSWORD for sharpstudy_dev)";

let schema = null;
let publicBefore = null; // state of the real schema before this file writes anything anywhere
const A = {}; // loaded application modules
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = (p) => import(pathToFileURL(path.join(process.cwd(), p)).href);

if (reachable) {
	register("./pg/hooks.mjs", import.meta.url);
	publicBefore = await publicRowTotal();
	schema = await createTestSchema();
	try {
	process.env.DB_DIALECT = "postgres";
	process.env.PG_SEARCH_PATH = schema;
	process.env.JWT_SECRET = "test-only-secret-" + randomUUID();
	A.connection = (await load("database/connection.js")).default;
	A.models = await load("database/models/index.js");
	A.mastery = await load("database/models/mastery.js");
	A.meetingModels = await load("database/models/meeting_request.js");
	A.instructorModels = await load("database/models/instructor_application.js");
	A.masteryRepo = (await load("lib/mastery-server/repo.js")).default;
	A.meetingRepo = (await load("lib/meetings/repo.js")).default;
	A.followupRepo = (await load("lib/followups/repo.js")).default;
	A.accountsRepo = (await load("lib/admin/accountsRepo.js")).default;
	A.dialect = await load("lib/db/dialect.js");
	A.http = await load("lib/mastery-server/http.js");
	A.signin = (await load("pages/api/users/signin.js")).default;
	A.sequelize = await import("sequelize");
	A.bcrypt = (await import("bcrypt")).default;
	} catch (e) {
		// never leave the throw-away schema behind when loading fails
		await dropTestSchema(schema).catch(() => {});
		throw e;
	}
}

after(async () => {
	if (!reachable) return;
	let publicState = null;
	try {
		await A.connection.close();
	} finally {
		await dropTestSchema(schema);
		publicState = await publicRowTotal();
	}
	// the real schema was never written to: same tables, same number of rows as before this file ran
	assert.deepEqual(publicState, publicBefore, "the real public schema must be exactly as it was before the tests");
});

// ---- helpers -------------------------------------------------------------------------------------------------
const User = () => A.models.User;
let n = 0;
async function makeUser(over = {}) {
	n++;
	return User().create({ id: randomUUID(), first_name: "Test", last_name: "User" + n, email: `user${n}@example.com`, password: "x", email_confirmed: true, status: true, ...over });
}
async function makeLearner(ownerId) {
	n++;
	return A.mastery.ML_Learner.create({ id: randomUUID(), owner_user_id: ownerId, display_name: "Kid" + n, pin_hash: "h" });
}
const mockRes = () => ({
	statusCode: 200,
	body: undefined,
	headers: {},
	status(c) {
		this.statusCode = c;
		return this;
	},
	json(b) {
		this.body = b;
		return this;
	},
	setHeader(k, v) {
		this.headers[k] = v;
	},
});

// ---- connection isolation -------------------------------------------------------------------------------------
test("the application runs on PostgreSQL inside the throw-away schema only", { skip }, async () => {
	assert.equal(A.connection.getDialect(), "postgres");
	const [[r]] = await A.connection.query("select current_schema() as s, current_setting('search_path') as p, current_setting('TimeZone') as tz");
	assert.equal(r.s, schema);
	assert.equal(r.p, schema, "public must not be on the search path");
	assert.match(r.tz, /UTC|\+00|Etc/i, "sessions run in UTC");
});

// ---- e-mail: lookups and uniqueness -----------------------------------------------------------------------------
test("e-mail lookups ignore case on PostgreSQL (ciEquals) and use the lower() unique index", { skip }, async () => {
	const u = await makeUser({ email: "alice@example.com" });
	const found = await User().findOne({ where: A.dialect.ciEquals(A.connection, "email", "ALICE@Example.COM") });
	assert.equal(found && found.id, u.id);
	assert.equal(await User().findOne({ where: A.dialect.ciEquals(A.connection, "email", "bob@example.com") }), null);
	assert.equal((await A.masteryRepo.findUserByEmail("Alice@EXAMPLE.com")).id, u.id);
	const [plan] = await A.connection.query(`explain select 1 from users where lower(email) = 'alice@example.com'`);
	assert.ok(plan.length > 0);
});

test("two accounts that differ only in letter case are rejected, and the error is recognised as a duplicate", { skip }, async () => {
	await makeUser({ email: "case@example.com" });
	await assert.rejects(makeUser({ email: "Case@Example.com" }), (e) => {
		assert.equal(e.name, "SequelizeUniqueConstraintError");
		assert.equal(A.dialect.isDuplicateError(e), true);
		return true;
	});
});

// ---- a request without an e-mail behaves as on MySQL (Phase 7 regression) ----------------------------------------------
test("subscriptions: a request without an e-mail is refused (400) and creates nothing, exactly as on MySQL", { skip }, async () => {
	const handler = (await load("pages/api/subscriptions/new.js")).default;
	const before = Number((await A.connection.query("select count(*) n from subscriptions"))[0][0].n);
	for (const method of ["GET", "POST"]) {
		const res = mockRes();
		await handler({ method, body: {}, headers: {} }, res);
		assert.equal(res.statusCode, 400, method);
	}
	assert.equal(Number((await A.connection.query("select count(*) n from subscriptions"))[0][0].n), before, "no row was created");
	// a real address is stored once; the same address in another letter case is recognised as existing
	const ok = mockRes();
	await handler({ method: "POST", body: { email: "News@Example.com" }, headers: {} }, ok);
	assert.equal(ok.statusCode, 200);
	const again = mockRes();
	await handler({ method: "POST", body: { email: "news@EXAMPLE.com" }, headers: {} }, again);
	assert.equal(again.body.code, "exist");
});

// ---- Phase 7.1: slug lookups ignore letter case, as they did on MySQL ------------------------------------------------
test("slug lookups: courses, books, categories and quizzes resolve lower / upper / mixed case alike; unknown, empty and missing slugs behave as before", { skip }, async () => {
	const owner = await makeUser();
	const tag = randomUUID().slice(0, 8);
	const cat = await A.models.Category.create({ id: randomUUID(), name: "Slug Cat", slug: `slug-cat-${tag}` });
	const course = await A.models.Course.create({ id: randomUUID(), title: "Slug Course", slug: `slug-course-${tag}`, userId: owner.id, catId: cat.id, approved: true });
	const bookId = randomUUID();
	await A.connection.query("insert into books (id, slug, title, author, category) values ($1, $2, 'B', 'A', 'maths')", { bind: [bookId, `slug-book-${tag}`] });
	const quiz = await A.models.Quiz.create({ id: randomUUID(), title: "Slug Quiz", description: "d", slug: `slug-quiz-${tag}`, courseId: course.id, userId: owner.id });
	const variants = (slug) => [slug, slug.toUpperCase(), slug.replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase())];
	// The course routes need a signed-in account (a visitor gets 401, checked below), so these lookups run as an ordinary student.
	const readerHash = await A.bcrypt.hash("secret1", 4);
	const reader = await makeUser({ email: `slugreader${tag}@example.com`, password: readerHash });
	const readerLogin = mockRes();
	await A.signin({ method: "POST", body: { email: reader.email, password: "secret1" }, headers: {}, socket: {} }, readerLogin);
	const readerToken = readerLogin.body.edmy_users_token;
	const call = async (handler, query, headers = { authorization: readerToken }) => {
		const res = mockRes();
		await handler({ method: "GET", query, headers, body: {} }, res);
		return res;
	};
	const stable = (r) => JSON.stringify({ s: r.statusCode, b: JSON.parse(JSON.stringify(r.body ?? null)) });

	// the real API routes (they join other tables that also have a slug column: the helper must qualify the column)
	for (const [label, path, slug] of [
		["course", "pages/api/courses/course/index.js", course.slug],
		["course videos", "pages/api/learnings/videos/[slug].js", course.slug],
		["category", "pages/api/categories/[slug].js", cat.slug],
	]) {
		const handler = (await load(path)).default;
		assert.equal((await call(handler, { slug }, {})).statusCode, 401, `${label}: a visitor without a login gets 401`);
		const base = await call(handler, { slug });
		assert.equal(base.statusCode, 200, label);
		assert.ok(JSON.stringify(base.body).includes(slug), `${label}: the stored slug finds the record`);
		for (const v of variants(slug)) assert.equal(stable(await call(handler, { slug: v })), stable(base), `${label}: "${v}" answers like "${slug}"`);
		const unknown = await call(handler, { slug: "no-such-slug-" + tag });
		assert.ok(unknown.statusCode < 500, `${label}: unknown slug is not a 500`);
		assert.ok(!JSON.stringify(unknown.body).includes(slug), `${label}: unknown slug finds nothing`);
		assert.equal(stable(await call(handler, { slug: "" })), stable(await call(handler, { slug: "no-such-slug-" + tag })), `${label}: an empty slug is just "not found"`);
		const missing = await call(handler, {});
		assert.ok(missing.statusCode >= 400 && missing.statusCode < 500, `${label}: a missing slug is refused (4xx), HTTP ${missing.statusCode}`);
	}

	// repositories and models (book catalogue, live questions, quiz)
	const bookRepo = (await load("lib/books/repo.js")).default;
	const liveRepo = (await load("lib/live-questions/repo.js")).default;
	for (const v of variants(`slug-book-${tag}`)) assert.equal((await bookRepo.getBookBySlug(v)).id, bookId, `book "${v}"`);
	for (const v of variants(course.slug)) assert.equal((await liveRepo.getCourseBySlug(v)).id, course.id, `class "${v}"`);
	for (const v of variants(quiz.slug)) assert.equal((await A.models.Quiz.findOne({ where: A.dialect.ciEquals(A.connection, "slug", v, A.models.Quiz) })).id, quiz.id, `quiz "${v}"`);
	assert.equal(await bookRepo.getBookBySlug("no-such-" + tag), null);
	assert.equal(await bookRepo.getBookBySlug(""), null);
	assert.equal(await liveRepo.getCourseBySlug("no-such-" + tag), null);
	await assert.rejects(bookRepo.getBookBySlug(undefined), /undefined/i, "a missing book slug is refused by Sequelize as on MySQL");
	assert.equal((await A.models.Course.findAll({ where: A.dialect.ciEquals(A.connection, "slug", course.slug.toUpperCase(), A.models.Course), include: [{ model: A.models.Category, as: "category" }] })).length, 1, "with a joined table that also has a slug column");
});

test("creating a category or course whose slug differs only in case from an existing one gets a new unique slug (uniqueness check ignores case)", { skip }, async () => {
	const tag = randomUUID().slice(0, 8);
	const hash = await A.bcrypt.hash("secret1", 4);
	const adminUser = await makeUser({ email: `slugadmin${tag}@example.com`, password: hash, role: "admin" });
	const login = mockRes();
	await A.signin({ method: "POST", body: { email: adminUser.email, password: "secret1" }, headers: {}, socket: {} }, login);
	const token = login.body.edmy_users_token;
	// an existing category stored with an UPPER-case slug (as an older record might be)
	await A.models.Category.create({ id: randomUUID(), name: "Upper", slug: `UPPER-CAT-${tag}` });
	const handler = (await load("pages/api/categories/create.js")).default;
	const res = mockRes();
	await handler({ method: "POST", headers: { authorization: token }, query: {}, body: { category: `upper cat ${tag}` } }, res);
	assert.equal(res.statusCode, 200);
	assert.notEqual(res.body.category.slug, `upper-cat-${tag}`, "the colliding slug received a numeric suffix");
	assert.match(res.body.category.slug, new RegExp(`^upper-cat-${tag}-[0-9]{3}$`));
});

// ---- search (LIKE -> ILIKE) -------------------------------------------------------------------------------------
test("admin user search ignores case (Op.like became Op.iLike on PostgreSQL)", { skip }, async () => {
	await makeUser({ first_name: "Zebulon", email: "zeb@example.com" });
	const upper = await A.masteryRepo.listUsers({ q: "ZEBU" });
	assert.equal(upper.count, 1);
	assert.equal(upper.rows[0].first_name, "Zebulon");
	assert.equal((await A.masteryRepo.listUsers({ q: "zebu" })).count, 1);
	assert.equal((await A.masteryRepo.listUsers({ q: "no-such-person" })).count, 0);
});

// ---- malformed ids behave as on MySQL --------------------------------------------------------------------------
test("a malformed id finds nothing instead of raising a uuid syntax error", { skip }, async () => {
	const u = await makeUser();
	assert.equal(await User().findByPk("not-a-uuid"), null);
	assert.equal(await User().findOne({ where: { id: "undefined" } }), null);
	assert.deepEqual(await User().findAll({ where: { id: ["x", "y"] } }), []);
	assert.equal(await User().count({ where: { id: "zzz" } }), 0);
	assert.deepEqual(await User().update({ status: false }, { where: { id: "bad" } }), [0]);
	assert.equal(await User().destroy({ where: { id: "bad" } }), 0);
	// ...and a valid id still works, mixed with a bad one in a list, and inside Op.or
	assert.equal((await User().findAll({ where: { id: [u.id, "bad"] } })).length, 1);
	assert.equal((await User().findAll({ where: { [A.sequelize.Op.or]: [{ id: "bad" }, { id: u.id }] } })).length, 1);
});

// ---- ON CONFLICT upserts --------------------------------------------------------------------------------------
test("presence heartbeat is an atomic upsert (ON CONFLICT) that keeps one row per subject", { skip }, async () => {
	const u = await makeUser();
	await A.masteryRepo.touchPresence("user", u.id, "/first");
	await A.masteryRepo.touchPresence("user", u.id, "/second");
	await Promise.all([1, 2, 3, 4].map((i) => A.masteryRepo.touchPresence("user", u.id, "/p" + i)));
	const rows = await A.mastery.ML_Presence.findAll({ where: { kind: "user", subject_id: u.id } });
	assert.equal(rows.length, 1);
	assert.match(rows[0].path, /^\/p[1-4]$/);
	assert.ok(Math.abs(rows[0].last_seen_at.getTime() - Date.now()) < 15000, "timestamps are real UTC instants, not shifted");
});

test("daily activity increments are atomic, also under concurrency", { skip }, async () => {
	const u = await makeUser();
	const l = await makeLearner(u.id);
	await A.masteryRepo.addActivity(l.id, "2026-11-12", { worksheets: 1, stars: 2, seconds: 30 });
	await A.masteryRepo.addActivity(l.id, "2026-11-12", { worksheets: 1, stars: 3, seconds: 45 });
	await Promise.all([1, 2, 3, 4, 5].map(() => A.masteryRepo.addActivity(l.id, "2026-11-12", { worksheets: 1, stars: 1, seconds: 10 })));
	const rows = await A.mastery.ML_DailyActivity.findAll({ where: { learner_id: l.id } });
	assert.equal(rows.length, 1);
	assert.equal(rows[0].worksheets, 7);
	assert.equal(rows[0].stars, 10);
	assert.equal(rows[0].seconds, 125);
	assert.equal(rows[0].local_date, "2026-11-12", "DATE values stay plain date strings");
	await A.masteryRepo.addActivity(l.id, "2026-11-13", { worksheets: 1 });
	assert.equal((await A.mastery.ML_DailyActivity.findAll({ where: { learner_id: l.id } })).length, 2);
});

test("settings upsert stores JSON(B) and updates in place", { skip }, async () => {
	await A.masteryRepo.setSetting("tutor.model", { name: "x", list: [1, 2, { a: true }] }, null);
	assert.deepEqual(await A.masteryRepo.getSetting("tutor.model"), { name: "x", list: [1, 2, { a: true }] });
	await A.masteryRepo.setSetting("tutor.model", "plain string", null);
	assert.equal(await A.masteryRepo.getSetting("tutor.model"), "plain string");
	assert.equal(await A.mastery.ML_Setting.count({ where: { key: "tutor.model" } }), 1);
});

// ---- aggregates and raw SQL result shape ----------------------------------------------------------------------
test("attempt statistics come back as numbers (aliases are lower-case, SUM/COUNT are converted)", { skip }, async () => {
	const u = await makeUser();
	const l = await makeLearner(u.id);
	const base = { learner_id: l.id, subject: "math", level_id: "7A", set_id: "7A-1", worksheet_no: 1, seed: "s", total: 8, correct_first: 6, accuracy: 0.75, duration_ms: 60000, target_seconds: 300, status: "completed", outcome: "passed" };
	const t1 = new Date("2026-11-10T08:15:30.123Z");
	const t2 = new Date("2026-11-11T09:00:00.000Z");
	await A.mastery.ML_Attempt.create({ ...base, id: randomUUID(), client_attempt_id: "a1", started_at: t1, completed_at: t1, local_date: "2026-11-10", hints_used: 2 });
	await A.mastery.ML_Attempt.create({ ...base, id: randomUUID(), client_attempt_id: "a2", worksheet_no: 2, accuracy: 0.5, duration_ms: 30000, started_at: t2, completed_at: t2, local_date: "2026-11-11", hints_used: 1 });
	const s = await A.masteryRepo.attemptStats(l.id);
	assert.equal(s.count, 2);
	assert.equal(s.accuracySum, 1.25);
	assert.equal(s.durationMsSum, 90000);
	assert.equal(s.hintsSum, 3);
	assert.equal(s.lastCompletedAt.getTime(), t2.getTime());
	const none = await A.masteryRepo.attemptStats(randomUUID());
	assert.deepEqual({ ...none, lastCompletedAt: null }, { count: 0, accuracySum: 0, durationMsSum: 0, hintsSum: 0, lastCompletedAt: null });
	// timestamps keep milliseconds and are not shifted by the 5h30 of the local time zone
	const row = await A.mastery.ML_Attempt.findOne({ where: { client_attempt_id: "a1" } });
	assert.equal(row.completed_at.getTime(), t1.getTime());
	assert.equal(typeof row.local_date, "string");
});

// ---- meetings: case-insensitive e-mail, CAS, locks, concurrency -------------------------------------------------------
let meetingN = 0;
const meetingRow = (over = {}) => {
	meetingN++;
	return {
		id: randomUUID(),
		reference: "SS-M" + String(meetingN).padStart(4, "0"),
		manage_token_hash: "a".repeat(64),
		name: "Meeting Person " + meetingN,
		email: "Visitor@Example.com",
		phone: "+910000000000",
		purpose: "product_demo",
		requested_date: "2026-12-01",
		requested_time: "10:30",
		time_zone: "Asia/Kolkata",
		requested_at: new Date("2026-12-01T05:00:00.000Z"),
		...over,
	};
};

test("meeting requests: e-mail and reference lookups ignore case, search ignores case, counts are numbers", { skip }, async () => {
	const row = await A.meetingRepo.create(meetingRow());
	assert.equal((await A.meetingRepo.findByReference(row.reference.toLowerCase())).id, row.id);
	assert.equal((await A.meetingRepo.findOpenTwin("VISITOR@example.COM", row.requested_at)).id, row.id);
	assert.equal(await A.meetingRepo.countByEmailSince("visitor@EXAMPLE.com", new Date(Date.now() - 3600_000)), 1);
	const found = await A.meetingRepo.list({ q: "MEETING PERSON", status: "", page: 1, pageSize: 10 });
	assert.ok(found.total >= 1);
	const counts = await A.meetingRepo.countsByStatus();
	assert.equal(typeof counts.pending, "number");
	await assert.rejects(A.meetingRepo.create({ ...meetingRow(), reference: row.reference }), (e) => e.code === "duplicate");
});

test("free demo phone numbers: an older Indian enquiry and a new international one are the same number; search ignores spaces", { skip }, async () => {
	const demo = (phone, over = {}) => meetingRow({ kind: "free_demo", email: null, requested_date: null, requested_time: null, requested_at: null, child_name: "Aarav", child_grade: "Grade 4", program: "mathx", phone, ...over });
	const old = await A.meetingRepo.create(demo("+91 90000 55555")); // stored exactly as typed before the international field existed
	const bare = await A.meetingRepo.create(demo("90000 66666", { child_name: "Meera" })); // typed without a country code
	const intl = await A.meetingRepo.create(demo("+14155550123", { child_name: "Zoe", program: "leadership" }));
	// the new field sends E.164; every older spelling of that number is found
	assert.equal((await A.meetingRepo.findOpenDemoTwin("+919000055555", "aarav", "mathx")).id, old.id);
	assert.equal((await A.meetingRepo.findOpenDemoTwin("+919000066666", "MEERA", "mathx")).id, bare.id);
	assert.equal((await A.meetingRepo.findOpenDemoTwin("+14155550123", "Zoe", "leadership")).id, intl.id);
	// a different child, program or number is a different request
	assert.equal(await A.meetingRepo.findOpenDemoTwin("+919000055555", "Someone Else", "mathx"), null);
	assert.equal(await A.meetingRepo.findOpenDemoTwin("+919000055555", "Aarav", "leadership"), null);
	assert.equal(await A.meetingRepo.findOpenDemoTwin("+919000055556", "Aarav", "mathx"), null);
	const since = new Date(Date.now() - 3600_000);
	assert.equal(await A.meetingRepo.countByPhoneSince("+919000055555", since), 1);
	assert.equal(await A.meetingRepo.countByPhoneSince("+14155550123", since), 1);
	// search: spaces, dashes and the country code do not matter
	for (const q of ["90000 55555", "+91 90000-55555", "9000055555", "415 555 0123", "+1 (415) 555-0123"]) {
		const r = await A.meetingRepo.list({ q, status: "", page: 1, pageSize: 10 });
		assert.ok(r.total >= 1, `search ${q} finds a request`);
	}
	assert.equal((await A.meetingRepo.list({ q: "99999 99999", status: "", page: 1, pageSize: 10 })).total, 0);
	// the telecaller list (a joined query) searches the same way
	const day = { now: new Date(), dayEnd: new Date(Date.now() + 86400000), userId: randomUUID() };
	for (const q of ["90000 55555", "+1 (415) 555-0123"]) {
		const r = await A.followupRepo.listRows({ filter: "all", mine: false, q, page: 1, pageSize: 10, kind: "free_demo" }, day);
		assert.ok(r.total >= 1, `telecaller search ${q} finds a request`);
	}
});

test("meeting compare-and-set bumps the version once and rejects stale writers", { skip }, async () => {
	const row = await A.meetingRepo.create(meetingRow({ email: "cas@example.com" }));
	const updated = await A.meetingRepo.updateIfCurrent(row.id, row.version, ["pending"], { status: "approved" });
	assert.equal(updated.status, "approved");
	assert.equal(updated.version, row.version + 1);
	assert.equal(await A.meetingRepo.updateIfCurrent(row.id, row.version, ["pending"], { status: "rejected" }), null);
});

test("the schedule lock serialises concurrent approvals (SELECT ... FOR UPDATE + INSERT ... ON CONFLICT DO NOTHING)", { skip }, async () => {
	let active = 0;
	let maxActive = 0;
	const order = [];
	const work = (id) => async () => {
		active++;
		maxActive = Math.max(maxActive, active);
		await sleep(80);
		order.push(id);
		active--;
		return id;
	};
	const results = await Promise.all([1, 2, 3].map((i) => A.meetingRepo.withScheduleLock(work(i))));
	assert.deepEqual(results.sort(), [1, 2, 3]);
	assert.equal(maxActive, 1, "only one approver may be inside the lock at a time");
	assert.equal(await A.connection.query("select count(*) n from meeting_schedule_lock").then(([r]) => Number(r[0].n)), 1);
	// the lock row insert is idempotent
	await A.meetingRepo.withScheduleLock(async () => 1);
	assert.equal(await A.connection.query("select count(*) n from meeting_schedule_lock").then(([r]) => Number(r[0].n)), 1);
});

test("a real PostgreSQL deadlock is detected and classified as retryable", { skip }, async () => {
	await A.masteryRepo.setSetting("dl.a", 1, null);
	await A.masteryRepo.setSetting("dl.b", 1, null);
	const S = A.mastery.ML_Setting;
	const t1 = await A.connection.transaction();
	const t2 = await A.connection.transaction();
	try {
		await S.update({ value: 2 }, { where: { key: "dl.a" }, transaction: t1 });
		await S.update({ value: 2 }, { where: { key: "dl.b" }, transaction: t2 });
		const settled = await Promise.allSettled([
			S.update({ value: 3 }, { where: { key: "dl.b" }, transaction: t1 }),
			S.update({ value: 3 }, { where: { key: "dl.a" }, transaction: t2 }),
		]);
		const failed = settled.filter((s) => s.status === "rejected");
		assert.equal(failed.length >= 1, true, "PostgreSQL must break the deadlock");
		assert.equal(A.dialect.isLockRetryError(failed[0].reason), true);
		assert.equal(failed[0].reason.parent.code, "40P01");
	} finally {
		await t1.rollback().catch(() => {});
		await t2.rollback().catch(() => {});
	}
});

// ---- types round-trip ------------------------------------------------------------------------------------------
test("BYTEA keeps every byte, JSONB keeps structure, FLOAT keeps the value, ENUM is enforced by the database", { skip }, async () => {
	const u = await makeUser();
	const cat = await A.models.Category.create({ id: randomUUID(), name: "Cat", slug: "cat-" + randomUUID().slice(0, 8) });
	const course = await A.models.Course.create({ id: randomUUID(), title: "C", slug: "c-" + randomUUID().slice(0, 8), userId: u.id, catId: cat.id });
	const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
	const imgId = randomUUID();
	await A.connection.query("insert into live_question_images (id, course_id, uploader_id, mime, size, data) values ($1, $2, $3, 'image/png', $4, $5)", { bind: [imgId, course.id, u.id, bytes.length, bytes] });
	const [[img]] = await A.connection.query("select data from live_question_images where id = $1", { bind: [imgId] });
	assert.equal(Buffer.compare(img.data, bytes), 0);

	const audit = await A.mastery.ML_AuditLog.create({ id: randomUUID(), action: "t.json", details: { nested: { list: [1, "two", null, true], n: 1.5 } } });
	assert.deepEqual((await A.mastery.ML_AuditLog.findByPk(audit.id)).details, { nested: { list: [1, "two", null, true], n: 1.5 } });

	await A.connection.query("insert into coupons (id, code, discount) values ($1, 'SAVE10', 12.5)", { bind: [randomUUID()] });
	const [[c]] = await A.connection.query("select discount from coupons where code = 'SAVE10'");
	assert.equal(Number(c.discount), 12.5);

	await assert.rejects(A.connection.query("insert into ml_presence (id, kind, subject_id, last_seen_at) values ($1, 'bogus', $2, now())", { bind: [randomUUID(), randomUUID()] }), (e) => e.parent && e.parent.code === "23514");
});

// ---- foreign keys keep the MySQL rules ---------------------------------------------------------------------------
test("foreign keys: CASCADE removes children, RESTRICT blocks the delete", { skip }, async () => {
	const owner = await makeUser();
	const learner = await makeLearner(owner.id);
	await A.mastery.ML_DailyActivity.create({ id: randomUUID(), learner_id: learner.id, local_date: "2026-11-12" });
	await A.connection.query("delete from users where id = $1", { bind: [owner.id] }); // ml_learners.owner_user_id CASCADE -> activity CASCADE
	assert.equal(await A.mastery.ML_Learner.count({ where: { id: learner.id } }), 0);
	assert.equal(await A.mastery.ML_DailyActivity.count({ where: { learner_id: learner.id } }), 0);

	const buyer = await makeUser();
	const bookId = randomUUID();
	await A.connection.query("insert into books (id, slug, title, author, category) values ($1, $2, 'B', 'A', 'maths')", { bind: [bookId, "b-" + bookId.slice(0, 8)] });
	await A.connection.query("insert into book_orders (id, user_id, book_id, amount_cents) values ($1, $2, $3, 100)", { bind: [randomUUID(), buyer.id, bookId] });
	await assert.rejects(A.connection.query("delete from users where id = $1", { bind: [buyer.id] }), (e) => e.parent && e.parent.code === "23001", "RESTRICT is reported as restrict_violation (23001)");
});

// ---- transactions, UPDATE ... LIMIT, findOrCreate, random order ---------------------------------------------------------
test("transactions roll back completely", { skip }, async () => {
	const email = "rolled@example.com";
	await assert.rejects(
		A.connection.transaction(async (transaction) => {
			await User().create({ id: randomUUID(), first_name: "R", last_name: "B", email, password: "x" }, { transaction });
			throw new Error("boom");
		}),
		/boom/
	);
	assert.equal(await User().findOne({ where: A.dialect.ciEquals(A.connection, "email", email) }), null);
});

test("UPDATE with LIMIT (admin account state), findOrCreate and bulkCreate work", { skip }, async () => {
	const u = await makeUser();
	await A.accountsRepo.updateUser(u.id, { status: false });
	assert.equal((await User().findByPk(u.id)).status, false);
	const [profile, created] = await A.instructorModels.InstructorProfile.findOrCreate({ where: { user_id: u.id }, defaults: { user_id: u.id } });
	assert.equal(created, true);
	const [, again] = await A.instructorModels.InstructorProfile.findOrCreate({ where: { user_id: u.id }, defaults: { user_id: u.id } });
	assert.equal(again, false);
	const l = await makeLearner(u.id);
	await A.mastery.ML_Setting.bulkCreate([{ key: "bulk.1", value: 1 }, { key: "bulk.2", value: 2 }]);
	assert.equal(await A.mastery.ML_Setting.count({ where: { key: ["bulk.1", "bulk.2"] } }), 2);
	assert.ok(l.id && profile);
});

test("the home page queries (random order + eager loading) run on PostgreSQL", { skip }, async () => {
	const u = await makeUser();
	const cat = await A.models.Category.create({ id: randomUUID(), name: "Home", slug: "home-" + randomUUID().slice(0, 8) });
	for (let i = 0; i < 6; i++) await A.models.Course.create({ id: randomUUID(), title: "Course " + i, slug: "hc-" + randomUUID().slice(0, 8), userId: u.id, catId: cat.id, in_home_page: true, approved: true });
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
	assert.equal(courses.length, 4);
	assert.equal((await A.models.Category.findAll({ order, limit: 12 })).length >= 1, true);
});

// ---- authentication and authorization on PostgreSQL ----------------------------------------------------------------
test("sign-in route: e-mail in any case, wrong password, unconfirmed and disabled accounts", { skip }, async () => {
	const hash = await A.bcrypt.hash("secret1", 4);
	const u = await makeUser({ email: "login@example.com", password: hash });
	const post = async (email, password) => {
		const res = mockRes();
		await A.signin({ method: "POST", body: { email, password }, headers: {}, socket: { remoteAddress: "127.0.0.1" } }, res);
		return res;
	};
	const ok = await post("LOGIN@Example.COM", "secret1");
	assert.equal(ok.statusCode, 200);
	assert.ok(ok.body.edmy_users_token);
	assert.equal((await post("login@example.com", "wrong")).statusCode, 401);
	assert.equal((await post("nobody@example.com", "secret1")).statusCode, 404);
	await User().update({ email_confirmed: false }, { where: { id: u.id } });
	assert.equal((await post("login@example.com", "secret1")).statusCode, 404);
	await User().update({ email_confirmed: true, status: false }, { where: { id: u.id } });
	assert.equal((await post("login@example.com", "secret1")).statusCode, 404);
	assert.ok((await A.mastery.ML_AuditLog.count({ where: { actor_user_id: u.id } })) >= 2, "sign-in attempts are audited (JSON details written)");
});

test("authorization re-reads the account on every call: role changes and deactivation apply immediately", { skip }, async () => {
	const hash = await A.bcrypt.hash("secret1", 4);
	const u = await makeUser({ email: "actor@example.com", password: hash, role: "student" });
	const res = mockRes();
	await A.signin({ method: "POST", body: { email: "actor@example.com", password: "secret1" }, headers: {}, socket: {} }, res);
	const req = { headers: { authorization: res.body.edmy_users_token } };
	assert.equal((await A.http.getAccountActor(req)).role, "student");
	await User().update({ role: "admin" }, { where: { id: u.id } });
	assert.equal((await A.http.getAccountActor(req)).role, "admin");
	await User().update({ status: false }, { where: { id: u.id } });
	assert.equal(await A.http.getAccountActor(req), null, "a still-valid token never works for a deactivated account");
	await User().update({ status: null }, { where: { id: u.id } });
	assert.equal(await A.http.getAccountActor(req), null, "NULL status fails closed");
	assert.equal(await A.http.getAccountActor({ headers: { authorization: "garbage" } }), null);
});

test("database error mapping understands PostgreSQL (missing table / column)", { skip }, async () => {
	const dbErrors = await load("lib/mastery-server/dbErrors.js");
	await assert.rejects(A.connection.query("select * from no_such_table_xyz"), (e) => {
		assert.equal(dbErrors.isSchemaMismatch(e), true);
		assert.equal(dbErrors.friendlyDbError(e).status, 503);
		assert.match(dbErrors.logLine(e), /42P01 \(no_such_table_xyz\)/);
		assert.equal(A.dialect.isMissingTableError(e), true);
		return true;
	});
	await assert.rejects(A.connection.query("select no_such_col from users"), (e) => dbErrors.isSchemaMismatch(e));
});

// ============================== course access needs a login ====================================================================
// The REAL API handlers and models, inside the same throw-away schema as everything above (one file, so only one test schema ever exists).
// A visitor gets 401 on every course route that used to be open; a signed-in student / instructor / admin still gets the data; a wrong role
// gets 403; video URLs of paid lessons still go only to the owner, admins and enrolled students.
const gate = { ready: false, h: {}, people: {}, data: {} };
const gateCall = async (name, { method = "GET", query = {}, body = {}, token } = {}) => {
	const res = mockRes();
	res.send = function (b) { this.body = b; return this; };
	await gate.h[name]({ method, query, body, headers: token ? { authorization: token } : {}, socket: { remoteAddress: "127.0.0.1" } }, res);
	return res;
};
async function gateSetup() {
	if (gate.ready) return;
	for (const [name, file] of Object.entries({
		allCourses: "pages/api/all-courses.js",
		homeCourses: "pages/api/home-courses.js",
		category: "pages/api/categories/[slug].js",
		courseDetail: "pages/api/courses/course/index.js",
		exist: "pages/api/courses/course/exist.js",
		videos: "pages/api/learnings/videos/[slug].js",
		coupon: "pages/api/coupons/get-coupon.js",
		favourite: "pages/api/favourites/new.js",
		learnings: "pages/api/learnings/index.js",
		purchases: "pages/api/learnings/my-purchases.js",
		checkout: "pages/api/checkout/index.js",
		wishlist: "pages/api/wishlist/index.js",
		studentQuiz: "pages/api/quizzes/student/quiz.js",
		newCourse: "pages/api/courses/new.js",
		adminCourses: "pages/api/admin/courses/index.js",
		adminMeetings: "pages/api/admin/meetings/index.js",
		instructorStudents: "pages/api/instructor/students.js",
		testimonials: "pages/api/testimonials/index.js",
		meetingRequest: "pages/api/meetings/request.js",
	})) gate.h[name] = (await load(file)).default;
	const hash = await A.bcrypt.hash("secret1", 4);
	for (const [key, role] of [["student", "student"], ["enrolled", "student"], ["instructor", "instructor"], ["admin", "admin"], ["otherInstructor", "instructor"]]) {
		const u = await makeUser({ first_name: "Gate", last_name: role, email: `gate-${key}@example.com`, password: hash, role });
		const res = mockRes();
		await A.signin({ method: "POST", body: { email: u.email, password: "secret1" }, headers: {}, socket: { remoteAddress: "127.0.0.1" } }, res);
		assert.equal(res.statusCode, 200, `sign-in as ${u.email}`);
		gate.people[key] = { user: u, token: res.body.edmy_users_token };
	}
	gate.data.cat = await A.models.Category.create({ id: randomUUID(), name: "Gate Cat", slug: "gate-cat" });
	gate.data.course = await A.models.Course.create({ id: randomUUID(), title: "Gate Course", slug: "gate-course", userId: gate.people.instructor.user.id, catId: gate.data.cat.id, approved: true, latest_price: 10 });
	gate.data.draft = await A.models.Course.create({ id: randomUUID(), title: "Draft Course", slug: "draft-course", userId: gate.people.instructor.user.id, catId: gate.data.cat.id, approved: false, latest_price: 10 });
	gate.data.secretUrl = "https://cdn.example.test/paid-lesson-1.mp4";
	await A.models.Video.create({ id: randomUUID(), title: "Paid lesson", video: gate.data.secretUrl, is_preview: false, short_id: 1, userId: gate.people.instructor.user.id, courseId: gate.data.course.id, group_name: "g" });
	await A.models.Video.create({ id: randomUUID(), title: "Free preview", video: "https://cdn.example.test/preview.mp4", is_preview: true, short_id: 2, userId: gate.people.instructor.user.id, courseId: gate.data.course.id, group_name: "g" });
	await A.models.Enrolment.create({ id: randomUUID(), userId: gate.people.enrolled.user.id, courseId: gate.data.course.id, status: "paid", bought_price: 10 });
	gate.ready = true;
}

const GATE_REQUESTS = () => [
	["catalogue (all-courses)", "allCourses", { query: { page: "1", limit: "9" } }],
	["home courses", "homeCourses", {}],
	["category courses", "category", { query: { slug: gate.data.cat.slug } }],
	["course detail", "courseDetail", { query: { slug: gate.data.course.slug } }],
	["course exist (enrolled?)", "exist", { query: { courseId: gate.data.course.id } }],
	["lesson list", "videos", { query: { slug: gate.data.course.slug } }],
	["coupon check", "coupon", { method: "POST", body: { coupon: "NOSUCHCODE" } }],
	["favourite check", "favourite", { query: { courseId: gate.data.course.id } }],
	["my learning", "learnings", {}],
	["purchase history", "purchases", {}],
	["checkout", "checkout", { method: "POST", body: {} }],
	["wishlist", "wishlist", {}],
];

test("a visitor with no login, or with a garbage token, gets 401 on every course route (nothing is returned)", { skip }, async () => {
	await gateSetup();
	for (const [label, name, opts] of GATE_REQUESTS()) {
		for (const token of [undefined, "garbage", "Bearer garbage"]) {
			const r = await gateCall(name, { ...opts, token });
			assert.equal(r.statusCode, 401, `${label} with ${token || "no token"}: HTTP ${r.statusCode}`);
			assert.ok(!JSON.stringify(r.body || "").includes("Gate Course") && !JSON.stringify(r.body || "").includes(gate.data.secretUrl), `${label}: no course data in the 401 answer`);
		}
	}
});

test("a signed-in student, instructor and admin still get the course data (nothing was taken away from signed-in roles)", { skip }, async () => {
	await gateSetup();
	for (const who of ["student", "instructor", "admin"]) {
		const token = gate.people[who].token;
		const cat = await gateCall("allCourses", { query: { page: "1", limit: "9" }, token });
		assert.equal(cat.statusCode, 200, `${who}: catalogue`);
		assert.ok(JSON.stringify(cat.body).includes("Gate Course"), `${who}: the published course is listed`);
		assert.equal((await gateCall("homeCourses", { token })).statusCode, 200, `${who}: home courses`);
		const byCat = await gateCall("category", { query: { slug: gate.data.cat.slug }, token });
		assert.equal(byCat.statusCode, 200, `${who}: category`);
		assert.ok(JSON.stringify(byCat.body).includes("Gate Course"), `${who}: category lists the course`);
		const detail = await gateCall("courseDetail", { query: { slug: gate.data.course.slug }, token });
		assert.equal(detail.statusCode, 200, `${who}: course detail`);
		assert.equal(detail.body.course.title, "Gate Course");
		assert.equal((await gateCall("exist", { query: { courseId: gate.data.course.id }, token })).statusCode, 200, `${who}: exist`);
		assert.equal((await gateCall("videos", { query: { slug: gate.data.course.slug }, token })).statusCode, 200, `${who}: lesson list`);
		assert.equal((await gateCall("favourite", { query: { courseId: gate.data.course.id }, token })).statusCode, 200, `${who}: favourite check`);
		const coupon = await gateCall("coupon", { method: "POST", body: { coupon: "NOSUCHCODE" }, token });
		assert.equal(coupon.statusCode, 422, `${who}: coupon check reaches its own logic (unknown code = 422), not a 401`);
	}
});

test("paid lesson video URLs still go only to the owner, admins and enrolled students", { skip }, async () => {
	await gateSetup();
	const urlFor = async (who) => {
		const r = await gateCall("videos", { query: { slug: gate.data.course.slug }, token: gate.people[who].token });
		assert.equal(r.statusCode, 200, who);
		const paid = r.body.videos.find((v) => v.title === "Paid lesson");
		const free = r.body.videos.find((v) => v.title === "Free preview");
		return { paid: paid && paid.video, free: free && free.video };
	};
	assert.equal((await urlFor("student")).paid, null, "a signed-in student who has not bought the course does not get the paid URL");
	assert.ok((await urlFor("student")).free, "the free preview is available to a signed-in student");
	assert.equal((await urlFor("otherInstructor")).paid, null, "another instructor does not get it");
	for (const who of ["enrolled", "instructor", "admin"]) assert.equal((await urlFor(who)).paid, gate.data.secretUrl, `${who} gets the paid URL`);
});

test("an unpublished course is invisible to everyone except its owner, admins and enrolled students (existing rule kept)", { skip }, async () => {
	await gateSetup();
	for (const [who, expected] of [["student", 404], ["otherInstructor", 404], ["instructor", 200], ["admin", 200]]) {
		const r = await gateCall("courseDetail", { query: { slug: gate.data.draft.slug }, token: gate.people[who].token });
		assert.equal(r.statusCode, expected, `${who} on an unpublished course`);
	}
});

test("wrong role gets 403: a student cannot use instructor or admin APIs, an instructor cannot use admin APIs", { skip }, async () => {
	await gateSetup();
	for (const [label, name, opts] of [["create a course", "newCourse", { method: "POST", body: {} }], ["admin course list", "adminCourses", {}], ["admin meetings", "adminMeetings", {}], ["instructor students", "instructorStudents", {}]]) {
		const r = await gateCall(name, { ...opts, token: gate.people.student.token });
		assert.equal(r.statusCode, 403, `student -> ${label}: HTTP ${r.statusCode}`);
	}
	for (const [label, name] of [["admin course list", "adminCourses"], ["admin meetings", "adminMeetings"]]) {
		assert.equal((await gateCall(name, { token: gate.people.instructor.token })).statusCode, 403, `instructor -> ${label}`);
	}
	// and the allowed roles still pass the gate
	assert.notEqual((await gateCall("adminCourses", { token: gate.people.admin.token })).statusCode, 403, "admin -> admin course list");
	assert.notEqual((await gateCall("instructorStudents", { token: gate.people.instructor.token })).statusCode, 403, "instructor -> instructor students");
	assert.notEqual((await gateCall("newCourse", { method: "POST", body: {}, token: gate.people.instructor.token })).statusCode, 403, "instructor -> create course (reaches validation)");
});

test("student-only APIs: the student quiz API refuses an instructor (403) and a visitor (401)", { skip }, async () => {
	await gateSetup();
	assert.equal((await gateCall("studentQuiz", { query: { slug: "x" } })).statusCode, 401);
	assert.equal((await gateCall("studentQuiz", { query: { slug: "x" }, token: gate.people.instructor.token })).statusCode, 403);
});

test("public marketing APIs stay open to a visitor: testimonials, and the Free Demo / meeting request endpoint (it validates, it does not demand a login)", { skip }, async () => {
	await gateSetup();
	assert.equal((await gateCall("testimonials")).statusCode, 200);
	const r = await gateCall("meetingRequest", { method: "POST", body: { kind: "free_demo" } });
	assert.equal(r.statusCode, 422, "a visitor reaches the validation (422 = fields missing), not a 401");
});
