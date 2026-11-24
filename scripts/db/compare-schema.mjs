// Compares the REAL MySQL schema (information_schema) with the REAL PostgreSQL schema (pg_catalog).
// Read-only against both databases (SELECT statements only). Prints no credentials.
//
//   yarn db:compare-schema          (exit code 0 = identical apart from the documented intentional differences)
//
// Checked: table set, every column (order, name, type, nullability, default), primary keys, unique constraints,
// non-unique indexes, foreign keys (columns, referenced table/columns, delete and update rules), enum CHECK constraints,
// and stray PostgreSQL objects (extra tables, sequences, custom types).
import mysql from "mysql2/promise";
import pg from "pg";
import config from "../../database/config/config.mjs";
import { mapType, mapDefault, normalizePgDefault, buildIndexNames, enumCheckName } from "./lib/pg-schema-map.mjs";

// Differences from MySQL that are deliberate and documented (see the migration that creates each one).
const INTENTIONAL_EXTRA_INDEXES = new Map([["users", new Set(["uq_users_email_lower"])]]); // case-insensitive e-mail uniqueness
// Created by the Phase 5 data migration (not part of the MySQL schema): the 35 migration names applied to the ORIGINAL MySQL
// database, kept as history. Its identity column is the only sequence in the schema. Excluded from the MySQL comparison.
const HISTORY_TABLE = "mysql_migration_history";
const LEGACY_TABLE = "sequelizemeta"; // created by sequelize-cli itself; constraint names differ, columns are compared

const failures = [];
const results = [];
const check = (area, expected, actual, detail) => {
	const ok = JSON.stringify(expected) === JSON.stringify(actual);
	results.push({ area, ok });
	if (ok) return;
	if (Array.isArray(expected) && Array.isArray(actual) && expected.length && typeof expected[0] === "string") {
		const missing = expected.filter((x) => !actual.includes(x));
		const extra = actual.filter((x) => !expected.includes(x));
		failures.push(`${area}: only in MySQL-derived expectation: ${JSON.stringify(missing)} | only in PostgreSQL: ${JSON.stringify(extra)}`);
	} else if (Array.isArray(expected) && Array.isArray(actual)) {
		const a = expected.map((x) => JSON.stringify(x));
		const b = actual.map((x) => JSON.stringify(x));
		failures.push(`${area}: differences: expected-only ${JSON.stringify(a.filter((x) => !b.includes(x)))} | actual-only ${JSON.stringify(b.filter((x) => !a.includes(x)))}`);
	} else failures.push(`${area}: ${detail || ""} expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual)}`);
};
const lower = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])));

const my = await mysql.createConnection({
	host: process.env.DB_HOSTNAME,
	port: Number(process.env.DB_PORT) || 3306,
	user: process.env.DB_USERNAME,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME_DEVELOPMENT,
});
const cfg = config.postgres_development;
const pgc = new pg.Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.username, ...(cfg.password ? { password: cfg.password } : {}) });
await pgc.connect();

try {
	await my.query("SET SESSION TRANSACTION READ ONLY");
	await pgc.query("SET default_transaction_read_only = on");
	const mq = async (sql) => lower((await my.query(sql))[0]);
	const pq = async (sql) => (await pgc.query(sql)).rows;

	// ---------------- MySQL side
	const mTables = (await mq("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY 1")).map((r) => r.table_name);
	const mCols = await mq("SELECT table_name, column_name, column_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position");
	const mStats = await mq("SELECT table_name, index_name, non_unique, seq_in_index, column_name FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY table_name, index_name, seq_in_index");
	const mFks = await mq(
		"SELECT k.table_name, k.column_name, k.constraint_name, k.referenced_table_name, k.referenced_column_name, r.delete_rule, r.update_rule FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_name = k.constraint_name AND r.constraint_schema = k.constraint_schema WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL ORDER BY k.table_name, k.constraint_name, k.ordinal_position"
	);

	// ---------------- PostgreSQL side
	const pTables = (await pq("SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY 1")).map((r) => r.t);
	const pCols = await pq(`SELECT c.relname AS t, a.attname AS c, format_type(a.atttypid, a.atttypmod) AS fmt, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS df
		FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum`);
	const pCons = await pq(`SELECT c.relname AS t, k.conname AS name, k.contype AS type, k.confdeltype AS del, k.confupdtype AS upd, r.relname AS rt,
			(SELECT array_agg(a.attname::text ORDER BY x.ord) FROM unnest(k.conkey) WITH ORDINALITY x(attnum, ord) JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = x.attnum) AS cols,
			(SELECT array_agg(a.attname::text ORDER BY x.ord) FROM unnest(k.confkey) WITH ORDINALITY x(attnum, ord) JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = x.attnum) AS rcols,
			pg_get_constraintdef(k.oid) AS def
		FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_class r ON r.oid = k.confrelid
		WHERE n.nspname = 'public' ORDER BY c.relname, k.conname`);
	const pIdx = await pq(`SELECT c.relname AS t, i.relname AS name, x.indisunique AS uniq, x.indexprs IS NOT NULL AS expr,
			(SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(x.indkey::int2[]) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum) AS cols
		FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class c ON c.oid = x.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND NOT x.indisprimary AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = x.indexrelid AND k.contype IN ('u','p')) ORDER BY c.relname, i.relname`);
	const pStray = await pq(`SELECT
			(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S') AS sequences,
			(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('v','m','f')) AS views,
			(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype IN ('e','d')) AS custom_types,
			(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS functions,
			(SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal) AS triggers`);

	const historyTablePresent = pTables.includes(HISTORY_TABLE);
	const withoutHistory = (rows, key = "t") => rows.filter((r) => r[key] !== HISTORY_TABLE);
	pTables.splice(0, pTables.length, ...pTables.filter((t) => t !== HISTORY_TABLE));
	pCols.splice(0, pCols.length, ...withoutHistory(pCols));
	pCons.splice(0, pCons.length, ...withoutHistory(pCons));
	pIdx.splice(0, pIdx.length, ...withoutHistory(pIdx));

	// ---------------- tables
	check("tables: same number", mTables.length, pTables.length);
	check("tables: same names", [...mTables].sort(), [...pTables].sort());

	// ---------------- columns
	const pColsBy = new Map();
	for (const c of pCols) (pColsBy.get(c.t) || pColsBy.set(c.t, []).get(c.t)).push(c);
	const mColsBy = new Map();
	for (const c of mCols) (mColsBy.get(c.table_name) || mColsBy.set(c.table_name, []).get(c.table_name)).push(c);
	let colCount = 0;
	for (const t of mTables) {
		const exp = (mColsBy.get(t) || []).map((c) => {
			const mapped = mapType(c.column_type);
			const d = mapDefault(mapped, c.column_default);
			return { c: c.column_name, fmt: mapped.fmt, nn: c.is_nullable === "NO", df: d ? d.norm : null };
		});
		const act = (pColsBy.get(t) || []).map((c) => ({ c: c.c, fmt: c.fmt, nn: c.nn, df: normalizePgDefault(c.df) }));
		colCount += exp.length;
		check(`columns: ${t} (${exp.length})`, exp, act);
	}

	// ---------------- primary keys, unique constraints, indexes
	const mIdx = new Map();
	for (const s of mStats) {
		const k = `${s.table_name}\u0000${s.index_name}`;
		if (!mIdx.has(k)) mIdx.set(k, { t: s.table_name, n: s.index_name, unique: Number(s.non_unique) === 0, cols: [] });
		mIdx.get(k).cols.push(s.column_name);
	}
	const mPk = [...mIdx.values()].filter((i) => i.n === "PRIMARY");
	const mSecondary = [...mIdx.values()].filter((i) => i.n !== "PRIMARY");
	const names = buildIndexNames(mSecondary.filter((i) => i.t !== LEGACY_TABLE));

	const pPk = pCons.filter((k) => k.type === "p");
	check("primary keys: count", mPk.length, pPk.length);
	check("primary keys: columns", mPk.map((i) => `${i.t}(${i.cols})`).sort(), pPk.map((k) => `${k.t}(${k.cols})`).sort());

	const pUq = pCons.filter((k) => k.type === "u");
	// sequelizemeta: MySQL has a second, redundant unique index on `name` (already the primary key). sequelize-cli creates
	// the PostgreSQL table with the primary key only, which enforces exactly the same rule. Documented, not hidden.
	const redundantUq = mSecondary.filter((i) => i.unique && i.t === LEGACY_TABLE && mPk.some((p) => p.t === i.t && JSON.stringify(p.cols) === JSON.stringify(i.cols)));
	const mUq = mSecondary.filter((i) => i.unique && !redundantUq.includes(i));
	check("unique constraints: count", mUq.length, pUq.length);
	check("unique constraints: columns", mUq.map((i) => `${i.t}(${i.cols})`).sort(), pUq.map((k) => `${k.t}(${k.cols})`).sort());
	check(
		"unique constraints: names",
		mUq.filter((i) => i.t !== LEGACY_TABLE).map((i) => `${i.t}.${names.get(`${i.t}.${i.n}`)}`).sort(),
		pUq.filter((k) => k.t !== LEGACY_TABLE).map((k) => `${k.t}.${k.name}`).sort()
	);

	const intentional = pIdx.filter((i) => (INTENTIONAL_EXTRA_INDEXES.get(i.t) || new Set()).has(i.name));
	const pPlain = pIdx.filter((i) => !intentional.includes(i));
	const mPlain = mSecondary.filter((i) => !i.unique);
	check("indexes: count (non-unique)", mPlain.length, pPlain.length);
	check("indexes: columns", mPlain.map((i) => `${i.t}(${i.cols})`).sort(), pPlain.map((i) => `${i.t}(${i.cols})`).sort());
	check(
		"indexes: names",
		mPlain.map((i) => `${i.t}.${names.get(`${i.t}.${i.n}`)}`).sort(),
		pPlain.map((i) => `${i.t}.${i.name}`).sort()
	);

	// ---------------- foreign keys
	const fkGroup = new Map();
	for (const f of mFks) {
		const k = `${f.table_name}.${f.constraint_name}`;
		if (!fkGroup.has(k)) fkGroup.set(k, { t: f.table_name, n: f.constraint_name, rt: f.referenced_table_name, cols: [], rcols: [], del: f.delete_rule, upd: f.update_rule });
		fkGroup.get(k).cols.push(f.column_name);
		fkGroup.get(k).rcols.push(f.referenced_column_name);
	}
	const rule = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
	const expFk = [...fkGroup.values()].map((f) => `${f.t}.${f.n}: (${f.cols}) -> ${f.rt}(${f.rcols}) DELETE ${f.del} UPDATE ${f.upd}`).sort();
	const actFk = pCons.filter((k) => k.type === "f").map((k) => `${k.t}.${k.name}: (${k.cols}) -> ${k.rt}(${k.rcols}) DELETE ${rule[k.del]} UPDATE ${rule[k.upd]}`).sort();
	check("foreign keys: count", expFk.length, actFk.length);
	check("foreign keys: definitions and delete/update rules", expFk, actFk);

	// ---------------- enum CHECK constraints
	const expChecks = [];
	for (const c of mCols) {
		const m = mapType(c.column_type);
		if (m.kind === "enum") expChecks.push(`${c.table_name}.${enumCheckName(c.table_name, c.column_name)}: ${m.enumValues.join("|")}`);
	}
	const actChecks = pCons
		.filter((k) => k.type === "c")
		.map((k) => `${k.t}.${k.name}: ${[...k.def.matchAll(/'((?:[^']|'')*)'::/g)].map((x) => x[1].replace(/''/g, "'")).join("|")}`);
	check("enum CHECK constraints: count", expChecks.length, actChecks.length);
	check("enum CHECK constraints: names and allowed values", [...expChecks].sort(), [...actChecks].sort());

	// ---------------- stray objects
	const s = pStray[0];
	check("no stray PostgreSQL objects (sequences / views / custom types / functions / triggers)", [0, 0, 0, 0, 0], [Number(s.sequences) - (historyTablePresent ? 1 : 0), s.views, s.custom_types, s.functions, s.triggers].map(Number));

	// ---------------- report
	const byArea = new Map();
	for (const r of results) {
		const g = r.area.split(":")[0];
		const e = byArea.get(g) || { ok: 0, bad: 0 };
		r.ok ? e.ok++ : e.bad++;
		byArea.set(g, e);
	}
	console.log("PostgreSQL schema compared with MySQL information_schema\n");
	console.log(`MySQL tables ${mTables.length} | PostgreSQL tables ${pTables.length} | columns compared ${colCount} | primary keys ${mPk.length} | unique ${mUq.length} | indexes ${mPlain.length} | foreign keys ${expFk.length} | enum checks ${expChecks.length}`);
	console.log(`Documented extra table: ${historyTablePresent ? HISTORY_TABLE + " (35 MySQL migration names, created by the data migration; its identity sequence is the only sequence)" : "none present"}`);
	console.log(`Intentional difference (documented): ${intentional.map((i) => `${i.t}.${i.name} - added: case-insensitive e-mail uniqueness`).join(", ") || "none present"}`);
	console.log(`Equivalent difference (documented):  ${redundantUq.map((i) => `${i.t}: MySQL also has a redundant unique index on (${i.cols}) beside the primary key; PostgreSQL enforces the same rule with the primary key`).join("; ") || "none"}\n`);
	for (const [g, e] of byArea) console.log(`${e.bad ? "FAIL" : "ok  "}  ${g}: ${e.ok} passed${e.bad ? `, ${e.bad} FAILED` : ""}`);
	if (failures.length) {
		console.log(`\n${failures.length} check(s) failed:`);
		for (const f of failures.slice(0, 40)) console.log(" - " + f.slice(0, 600));
		process.exitCode = 1;
	} else {
		console.log("\nRESULT: schemas match.");
	}
} finally {
	await my.end();
	await pgc.end();
}
