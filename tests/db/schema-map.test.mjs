// MySQL -> PostgreSQL schema mapping rules (scripts/db/lib/pg-schema-map.mjs). Pure functions, no database.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mapType, mapDefault, normalizePgDefault, parseEnum, buildIndexNames, orderTables, enumCheckName, IDENT, LIT } from "../../scripts/db/lib/pg-schema-map.mjs";

test("identifiers and literals are quoted safely", () => {
	assert.equal(IDENT('a"b'), '"a""b"');
	assert.equal(LIT("it's"), "'it''s'");
});

test("type mapping follows the migration decisions", () => {
	const sql = (t) => mapType(t).sql;
	assert.equal(sql("char(36)"), "uuid");
	assert.equal(sql("char(3)"), "char(3)");
	assert.equal(sql("char(64)"), "char(64)");
	assert.equal(sql("varchar(255)"), "varchar(255)");
	assert.equal(sql("text"), "text");
	assert.equal(sql("mediumtext"), "text");
	assert.equal(sql("int"), "integer");
	assert.equal(sql("tinyint(1)"), "boolean");
	assert.equal(sql("tinyint"), "smallint");
	assert.equal(sql("float"), "real");
	assert.equal(sql("datetime"), "timestamptz");
	assert.equal(sql("datetime(3)"), "timestamptz(3)");
	assert.equal(sql("date"), "date");
	assert.equal(sql("json"), "jsonb");
	assert.equal(sql("mediumblob"), "bytea");
});

test("PostgreSQL's own names for the mapped types are known (used by the validator)", () => {
	assert.equal(mapType("datetime").fmt, "timestamp with time zone");
	assert.equal(mapType("datetime(3)").fmt, "timestamp(3) with time zone");
	assert.equal(mapType("varchar(64)").fmt, "character varying(64)");
	assert.equal(mapType("char(3)").fmt, "character(3)");
});

test("an unknown MySQL type is an error, never a guess", () => {
	assert.throws(() => mapType("geometry"), /Unmapped MySQL type/);
	assert.throws(() => mapType("decimal(10,2)"), /Unmapped MySQL type/);
});

test("enum values are parsed exactly, including quotes, and become varchar plus the value list", () => {
	assert.deepEqual(parseEnum("enum('open','used','cancelled','replaced')"), ["open", "used", "cancelled", "replaced"]);
	assert.deepEqual(parseEnum("enum('it''s','b')"), ["it's", "b"]);
	const m = mapType("enum('open','used','cancelled','replaced')");
	assert.equal(m.kind, "enum");
	assert.equal(m.sql, "varchar(32)");
	assert.equal(mapType("enum('" + "x".repeat(40) + "')").sql, "varchar(40)");
	assert.equal(enumCheckName("fam_link_codes", "status"), "ck_fam_link_codes_status");
});

test("defaults are translated per type", () => {
	assert.deepEqual(mapDefault(mapType("tinyint(1)"), "1"), { sql: "true", norm: "true" });
	assert.deepEqual(mapDefault(mapType("tinyint(1)"), "0"), { sql: "false", norm: "false" });
	assert.deepEqual(mapDefault(mapType("int"), "30"), { sql: "30", norm: "30" });
	assert.deepEqual(mapDefault(mapType("datetime"), "CURRENT_TIMESTAMP"), { sql: "CURRENT_TIMESTAMP", norm: "CURRENT_TIMESTAMP" });
	assert.deepEqual(mapDefault(mapType("datetime(3)"), "CURRENT_TIMESTAMP(3)"), { sql: "CURRENT_TIMESTAMP(3)", norm: "CURRENT_TIMESTAMP(3)" });
	assert.deepEqual(mapDefault(mapType("char(3)"), "inr"), { sql: "'inr'", norm: "str:inr" });
	assert.deepEqual(mapDefault(mapType("enum('a','b')"), "a"), { sql: "'a'", norm: "str:a" });
	assert.equal(mapDefault(mapType("text"), null), null);
	assert.throws(() => mapDefault(mapType("datetime"), "2020-01-01"), /Unsupported datetime default/);
});

test("PostgreSQL default expressions normalise to the same form", () => {
	assert.equal(normalizePgDefault("'inr'::bpchar"), "str:inr");
	assert.equal(normalizePgDefault("'Device'::character varying"), "str:Device");
	assert.equal(normalizePgDefault("'it''s'::text"), "str:it's");
	assert.equal(normalizePgDefault("CURRENT_TIMESTAMP"), "CURRENT_TIMESTAMP");
	assert.equal(normalizePgDefault("CURRENT_TIMESTAMP(3)"), "CURRENT_TIMESTAMP(3)");
	assert.equal(normalizePgDefault("true"), "true");
	assert.equal(normalizePgDefault("false"), "false");
	assert.equal(normalizePgDefault("30"), "30");
	assert.equal(normalizePgDefault(null), null);
});

test("index names stay when unique in the database and get the table prefix when reused", () => {
	const names = buildIndexNames([
		{ t: "a", n: "learner_id" },
		{ t: "b", n: "learner_id" },
		{ t: "a", n: "uq_a_only" },
	]);
	assert.equal(names.get("a.learner_id"), "a_learner_id");
	assert.equal(names.get("b.learner_id"), "b_learner_id");
	assert.equal(names.get("a.uq_a_only"), "uq_a_only");
});

test("names longer than 63 characters are shortened deterministically and stay unique", () => {
	const long = "x".repeat(70);
	const n1 = buildIndexNames([{ t: "t1", n: long }]).get(`t1.${long}`);
	const n2 = buildIndexNames([{ t: "t1", n: long }]).get(`t1.${long}`);
	assert.equal(n1, n2);
	assert.ok(n1.length <= 63);
	assert.notEqual(n1, buildIndexNames([{ t: "t1", n: long + "y" }]).get(`t1.${long}y`));
});

test("tables are ordered parents-first, and cycles do not lose tables", () => {
	assert.deepEqual(orderTables(["c", "b", "a"], [{ t: "c", rt: "b" }, { t: "b", rt: "a" }]), ["a", "b", "c"]);
	const cyc = orderTables(["a", "b"], [{ t: "a", rt: "b" }, { t: "b", rt: "a" }]);
	assert.deepEqual([...cyc].sort(), ["a", "b"]);
});

test("generated SQL never silently drops what the schema contains", () => {
	const dir = path.join(process.cwd(), "database", "migrations-pg", "sql");
	if (!fs.existsSync(path.join(dir, "001_tables.sql"))) return; // generated files are checked in
	const tables = fs.readFileSync(path.join(dir, "001_tables.sql"), "utf8");
	const indexes = fs.readFileSync(path.join(dir, "002_indexes.sql"), "utf8");
	const fks = fs.readFileSync(path.join(dir, "003_foreign_keys.sql"), "utf8");
	assert.equal((tables.match(/^CREATE TABLE /gm) || []).length, 66);
	assert.equal((tables.match(/PRIMARY KEY/g) || []).length, 66);
	assert.equal((tables.match(/CHECK \(/g) || []).length, 45);
	assert.equal((indexes.match(/ADD CONSTRAINT .* UNIQUE/g) || []).length, 37);
	assert.equal((indexes.match(/^CREATE INDEX /gm) || []).length, 113);
	assert.equal((fks.match(/FOREIGN KEY/g) || []).length, 105);
	assert.equal(/\bchar\(36\)|datetime\b|\bjson\b|tinyint|mediumblob/i.test(tables.replace(/jsonb/g, "")), false, "no MySQL types may remain");
	assert.ok(tables.includes('"requested_by" uuid'), "fam_link_codes.requested_by is preserved");
	assert.ok(tables.includes("'replaced'"), "fam_link_codes status keeps the replaced value");
	for (const t of ["lc_audit_logs", "lc_quiz_sessions", "lc_quiz_questions", "lc_quiz_options", "lc_quiz_responses"]) assert.ok(tables.includes(`CREATE TABLE "${t}"`), `${t} is created`);
});
