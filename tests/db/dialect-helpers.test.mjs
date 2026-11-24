// Dialect helpers (lib/db/*): pure logic, no database connection is opened.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Sequelize, { Op, DataTypes } from "sequelize";
import {
	dialectOf, isPostgres, likeOp, ciEquals, normalizeEmail, randomOrderSql, utcNowSql,
	isDuplicateError, isLockRetryError, isSchemaMismatchCode, isMissingTableError,
} from "../../lib/db/dialect.js";
import { addActivitySql, touchPresenceSql, ensureScheduleLockRowSql } from "../../lib/db/statements.js";
import { guardWhere, isUuidString, NIL_UUID } from "../../lib/db/uuidGuard.js";
import { friendlyDbError, isSchemaMismatch, logLine } from "../../lib/mastery-server/dbErrors.js";

const pg = new Sequelize({ dialect: "postgres" }); // never connects
const my = new Sequelize({ dialect: "mysql" });

test("dialect detection: MySQL unless PostgreSQL is asked for", () => {
	assert.equal(dialectOf(pg), "postgres");
	assert.equal(dialectOf(my), "mysql");
	assert.equal(dialectOf("postgres"), "postgres");
	assert.equal(dialectOf(undefined), "mysql");
	assert.equal(isPostgres(pg), true);
	assert.equal(isPostgres(my), false);
});

test("LIKE: case-insensitive operator on PostgreSQL, the original operator on MySQL", () => {
	assert.equal(likeOp(pg), Op.iLike);
	assert.equal(likeOp(my), Op.like);
});

test("case-insensitive equality: untouched on MySQL, lower(column) = lower(value) on PostgreSQL", () => {
	assert.deepEqual(ciEquals(my, "email", "Bob@X.com"), { email: "Bob@X.com" });
	const w = ciEquals(pg, "email", "Bob@X.com");
	const sql = pg.getQueryInterface().queryGenerator.whereItemsQuery({ [Op.and]: [w, { status: "pending" }] }, {});
	assert.match(sql, /lower\("email"\) = 'bob@x\.com'/);
	assert.match(sql, /"status" = 'pending'/);
});

test("case-insensitive equality only lower-cases real strings: undefined / null / non-strings reach Sequelize unchanged, as on MySQL", () => {
	// Phase 7 regression: String(undefined) used to turn a missing e-mail into the text "undefined", bypassing Sequelize's
	// "invalid undefined value" refusal and letting a request without an e-mail create an empty row on PostgreSQL.
	for (const v of [undefined, null, 42, true, { a: 1 }]) {
		assert.deepEqual(ciEquals(pg, "email", v), { email: v });
		assert.deepEqual(ciEquals(pg, "email", v), ciEquals(my, "email", v), "PostgreSQL and MySQL build the same condition for non-strings");
	}
	assert.throws(() => pg.getQueryInterface().queryGenerator.whereItemsQuery(ciEquals(pg, "email", undefined), {}), /invalid "undefined" value/);
});

test("e-mail normalisation trims and lower-cases strings only", () => {
	assert.equal(normalizeEmail("  Alice@Example.COM "), "alice@example.com");
	assert.equal(normalizeEmail(undefined), undefined);
	assert.equal(normalizeEmail(42), 42);
});

test("random order and 'now' expressions per dialect", () => {
	assert.equal(randomOrderSql(my), "rand()");
	assert.equal(randomOrderSql(pg), "random()");
	assert.equal(utcNowSql(my), "UTC_TIMESTAMP()");
	assert.equal(utcNowSql(pg), "CURRENT_TIMESTAMP");
});

test("duplicate-key errors are recognised from both databases", () => {
	assert.equal(isDuplicateError({ name: "SequelizeUniqueConstraintError" }), true);
	assert.equal(isDuplicateError({ code: "ER_DUP_ENTRY" }), true);
	assert.equal(isDuplicateError({ parent: { code: "ER_DUP_ENTRY", errno: 1062 } }), true);
	assert.equal(isDuplicateError({ parent: { errno: 1062 } }), true);
	assert.equal(isDuplicateError({ parent: { code: "23505" } }), true);
	assert.equal(isDuplicateError({ original: { code: "23505" } }), true);
	assert.equal(isDuplicateError({ code: "23503" }), false);
	assert.equal(isDuplicateError(new Error("x")), false);
	assert.equal(isDuplicateError(null), false);
});

test("deadlock / lock-timeout errors are recognised from both databases, nothing else", () => {
	assert.equal(isLockRetryError({ parent: { errno: 1213 } }), true); // MySQL deadlock
	assert.equal(isLockRetryError({ parent: { errno: 1205 } }), true); // MySQL lock wait timeout
	assert.equal(isLockRetryError({ parent: { code: "40P01" } }), true); // PostgreSQL deadlock_detected
	assert.equal(isLockRetryError({ parent: { code: "55P03" } }), true); // lock_not_available
	assert.equal(isLockRetryError({ parent: { code: "40001" } }), true); // serialization_failure
	assert.equal(isLockRetryError({ parent: { errno: 1062 } }), false);
	assert.equal(isLockRetryError({ parent: { code: "23505" } }), false);
	assert.equal(isLockRetryError(undefined), false);
});

test("missing table / column errors are recognised from both databases", () => {
	for (const code of ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_BAD_TABLE_ERROR", "42P01", "42703"]) assert.equal(isSchemaMismatchCode({ parent: { code } }), true, code);
	assert.equal(isSchemaMismatchCode({ parent: { code: "23505" } }), false);
	assert.equal(isMissingTableError({ parent: { code: "42P01" } }), true);
	assert.equal(isMissingTableError({ code: "ER_NO_SUCH_TABLE" }), true);
	assert.equal(isMissingTableError({ parent: { code: "42703" } }), false);
	assert.equal(isSchemaMismatch({ parent: { code: "42P01" } }), true);
	assert.equal(friendlyDbError({ parent: { code: "42P01" } }).status, 503);
	assert.equal(friendlyDbError({ parent: { code: "ER_NO_SUCH_TABLE" } }).body.code, "setup_incomplete");
	assert.equal(friendlyDbError({ name: "SequelizeConnectionRefusedError" }).body.code, "db_unavailable");
	assert.equal(friendlyDbError(new Error("other")), null);
});

test("log lines name the missing object without SQL, values or hosts (both message formats)", () => {
	assert.equal(logLine({ parent: { code: "ER_NO_SUCH_TABLE" }, original: { code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'db.meeting_followups' doesn't exist" } }), "ER_NO_SUCH_TABLE (db.meeting_followups)");
	assert.equal(logLine({ original: { code: "42P01", message: 'relation "meeting_followups" does not exist' } }), "42P01 (meeting_followups)");
	assert.equal(logLine({ original: { code: "42703", message: 'column "requested_by" does not exist' } }), "42703 (requested_by)");
	assert.equal(logLine({ name: "Error", message: "boom" }), "Error");
});

test("raw statements: MySQL keeps the original upserts, PostgreSQL uses ON CONFLICT with no MySQL syntax", () => {
	const mysqlStatements = [addActivitySql("mysql"), touchPresenceSql("mysql"), ensureScheduleLockRowSql("mysql")].join("\n");
	assert.match(mysqlStatements, /ON DUPLICATE KEY UPDATE worksheets = worksheets \+ :w/);
	assert.match(mysqlStatements, /ON DUPLICATE KEY UPDATE path = :path/);
	assert.match(mysqlStatements, /INSERT IGNORE INTO meeting_schedule_lock/);
	assert.match(mysqlStatements, /UTC_TIMESTAMP\(\)/);
	const pgStatements = [addActivitySql("postgres"), touchPresenceSql("postgres"), ensureScheduleLockRowSql("postgres")].join("\n");
	assert.match(pgStatements, /ON CONFLICT \(learner_id, local_date\) DO UPDATE SET worksheets = ml_daily_activity\.worksheets \+ :w/);
	assert.match(pgStatements, /ON CONFLICT \(kind, subject_id\) DO UPDATE SET path = :path/);
	assert.match(pgStatements, /ON CONFLICT DO NOTHING/);
	assert.doesNotMatch(pgStatements, /ON DUPLICATE|INSERT IGNORE|UTC_TIMESTAMP/);
	// both variants take the same named parameters
	for (const fn of [addActivitySql, touchPresenceSql]) {
		const names = (s) => [...new Set(s.match(/:[a-zA-Z]+/g))].sort();
		assert.deepEqual(names(fn("postgres")), names(fn("mysql")));
	}
});

test("UUID guard: malformed ids become the nil UUID, valid ids and other columns are untouched", () => {
	const model = { rawAttributes: { id: { type: new DataTypes.UUID() }, userId: { type: new DataTypes.UUID() }, name: { type: new DataTypes.STRING() } } };
	const good = "0b1f6a5c-7a36-4b3d-9d2e-1f0a2b3c4d5e";
	assert.equal(isUuidString(good), true);
	assert.equal(isUuidString("abc"), false);
	assert.equal(guardWhere(model, { id: "abc" }).id, NIL_UUID);
	assert.equal(guardWhere(model, { id: good }).id, good);
	assert.equal(guardWhere(model, { id: good.toUpperCase() }).id, good.toUpperCase());
	assert.deepEqual(guardWhere(model, { id: [good, "x", "undefined"] }).id, [good, NIL_UUID, NIL_UUID]);
	assert.equal(guardWhere(model, { name: "abc" }).name, "abc", "non-UUID columns are never touched");
	assert.equal(guardWhere(model, { id: { [Op.in]: ["x", good] } }).id[Op.in][0], NIL_UUID);
	assert.equal(guardWhere(model, { id: { [Op.ne]: "x" } }).id[Op.ne], NIL_UUID);
	assert.equal(guardWhere(model, { id: null }).id, null);
	const nested = guardWhere(model, { [Op.or]: [{ id: "x" }, { userId: good }] });
	assert.equal(nested[Op.or][0].id, NIL_UUID);
	assert.equal(nested[Op.or][1].userId, good);
	const input = { id: "abc" };
	guardWhere(model, input);
	assert.equal(input.id, "abc", "the caller's object is not mutated");
});

// ---- static guard: MySQL-only constructs must not creep back in -----------------------------------------------------
function* walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (/\.(js|mjs)$/.test(e.name)) yield p;
	}
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

test("application code contains no MySQL-only SQL or error codes outside the dialect helpers", () => {
	const allowed = new Set(["lib/db/dialect.js", "lib/db/statements.js"].map((p) => path.join(process.cwd(), p)));
	const forbidden = [
		[/UTC_TIMESTAMP\s*\(/, "UTC_TIMESTAMP()"],
		[/ON DUPLICATE KEY/i, "ON DUPLICATE KEY UPDATE"],
		[/INSERT IGNORE/i, "INSERT IGNORE"],
		[/\brand\(\)/, "rand()"],
		[/\[Op\.like\]/, "Op.like (use likeOp / the LIKE constant)"],
		[/errno\s*===\s*12\d\d/, "MySQL errno comparison (use isLockRetryError)"],
		[/code\s*===\s*["']ER_[A-Z_]+["']/, "ER_* comparison (use the dialect helpers)"],
	];
	const offenders = [];
	for (const dir of ["lib", "pages", "components", "utils", "store", "email-templates"]) {
		const abs = path.join(process.cwd(), dir);
		if (!fs.existsSync(abs)) continue;
		for (const file of walk(abs)) {
			if (allowed.has(file)) continue;
			const code = stripComments(fs.readFileSync(file, "utf8"));
			for (const [re, label] of forbidden) if (re.test(code)) offenders.push(`${path.relative(process.cwd(), file)}: ${label}`);
		}
	}
	assert.deepEqual(offenders, []);
});

test("e-mail addresses are normalised when an account is created and looked up case-insensitively everywhere", () => {
	const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
	assert.match(read("pages/api/users/signup.js"), /email = normalizeEmail\(email\)/);
	for (const f of ["pages/api/users/signin.js", "pages/api/users/signup.js", "pages/api/users/confirm-email.js", "pages/api/users/send-confirmation-email.js", "lib/mastery-server/repo.js"]) {
		assert.match(read(f), /ciEquals\(connection, "email"/, f);
	}
});

// ---- Phase 7.1: slug lookups --------------------------------------------------------------------------------------
test("case-insensitive equality qualifies the column with the model when other joined tables have the same column name", () => {
	const sql = (w) => pg.getQueryInterface().queryGenerator.whereItemsQuery(w, {});
	assert.equal(sql(ciEquals(pg, "slug", "Maths-1", { name: "Course" })), `lower("Course"."slug") = 'maths-1'`);
	assert.equal(sql(ciEquals(pg, "slug", "Maths-1")), `lower("slug") = 'maths-1'`);
	assert.deepEqual(ciEquals(my, "slug", "Maths-1", { name: "Course" }), { slug: "Maths-1" }, "MySQL query is unchanged");
	assert.deepEqual(ciEquals(pg, "slug", undefined, { name: "Course" }), { slug: undefined }, "a missing slug is still refused by Sequelize (400), not turned into text");
});

test("every slug lookup in the application is case-insensitive on PostgreSQL (and unchanged on MySQL)", () => {
	const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
	const sites = [
		["pages/api/categories/create.js", "Category", 2],
		["pages/api/categories/[slug].js", "Category", 1],
		["pages/api/courses/course/index.js", "Course", 1],
		["pages/api/courses/new.js", "Course", 1],
		["pages/api/learnings/videos/[slug].js", "Course", 1],
		["pages/api/quizzes/instructor/quiz.js", "Quiz", 1],
		["lib/books/repo.js", "Book", 1],
		["lib/live-questions/repo.js", "Course", 1],
	];
	for (const [file, model, n] of sites) {
		const src = read(file);
		assert.equal(src.split(`ciEquals(connection, "slug", slug, ${model})`).length - 1, n, file);
		assert.doesNotMatch(src, /where:\s*\{\s*slug(:\s*slug)?\s*\}/, `${file} must not keep an exact-match slug lookup`);
	}
});
