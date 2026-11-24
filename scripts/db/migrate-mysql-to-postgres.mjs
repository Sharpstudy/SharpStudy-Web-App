// MySQL -> PostgreSQL DATA migration for SharpStudy (Phase 5).
//
//   yarn db:migrate-data                 audit only: read-only on both databases, nothing is written (default)
//   yarn db:migrate-data --rehearse      the complete copy + verification inside a PostgreSQL transaction that is ALWAYS rolled back
//   yarn db:migrate-data --execute       the same run, COMMITTED only if every check inside the transaction passed
//
// Design (see docs/postgres/data-migration.md):
//   * MySQL is only ever read: one READ ONLY transaction with a consistent snapshot; the server rejects any write on it.
//   * PostgreSQL gets the whole copy in ONE transaction. Any failure rolls everything back, so there is never a partial copy
//     to clean up. There is no resume, merge or overwrite mode: the tool refuses to run unless all application tables are empty.
//   * Values are bound as parameters (never concatenated into SQL) and converted by the rules in lib/data-convert.mjs.
//   * Before COMMIT every copied row is read back from PostgreSQL and compared with the source (row count, primary keys, and a
//     canonical hash of every column). A single difference rolls the transaction back.
//   * The 35 MySQL migration records go to a separate table (mysql_migration_history); PostgreSQL's own sequelizemeta is untouched.
import fs from "node:fs";
import path from "node:path";
import { mapType } from "./lib/pg-schema-map.mjs";
import { ConversionError, toPgParam, rowHash, rowKey, tableChecksum } from "./lib/data-convert.mjs";
import {
	IDENT, MYSQL_META_TABLE, PG_META_TABLE, HISTORY_TABLE, EXPECTED_PG_MIGRATIONS,
	openMysql, openPg, mysqlSchema, pgSchema, dependencyOrder, readMysqlTable, readPgTable, verifyLatestBackup, mysqlFingerprint, mysqlSessionWriteCounters,
} from "./lib/migration-io.mjs";

const args = process.argv.slice(2);
const MODE = args.includes("--execute") ? "execute" : args.includes("--rehearse") ? "rehearse" : "audit";
const argValue = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : null;
};
const BACKUP_DIR = argValue("--backup-dir") || path.join(process.cwd(), "..", "SharpStudy-DB-Backups");
const BASELINE_FILE = argValue("--baseline");
const HISTORY_DDL = fs.readFileSync(path.join(process.cwd(), "database", "migrations-pg", "sql", "data-migration-history.sql"), "utf8");
const BATCH_PARAM_LIMIT = 30000;

const line = (s = "") => console.log(s);
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

class MigrationError extends Error {
	constructor(message, detail) {
		super(message);
		this.name = "MigrationError";
		this.detail = detail;
	}
}

// ================================================================================================================
// Audit: read-only on both databases. Returns everything the copy needs, plus the list of problems found.
// ================================================================================================================
async function audit(my, pgc) {
	const issues = [];
	const note = [];
	const A = { issues, note };

	// ---- MySQL
	const [[mv]] = await my.query("select version() as version, database() as db");
	A.mysql = { version: mv.version, database: mv.db };
	if (mv.db !== "sharpstudy_dev") issues.push(`MySQL database is "${mv.db}", expected sharpstudy_dev`);
	if (!/^8\.0\./.test(mv.version)) issues.push(`MySQL version ${mv.version} is not the audited 8.0.x`);
	const my_ = await mysqlSchema(my);
	A.mySchema = my_;
	const allTables = Object.keys(my_.tables);
	A.appTables = allTables.filter((t) => t !== MYSQL_META_TABLE);
	A.fingerprint = await mysqlFingerprint(my, my_);
	A.mysql.tableCount = allTables.length;
	A.mysql.appTableCount = A.appTables.length;
	if (allTables.length !== 67) issues.push(`MySQL has ${allTables.length} tables, expected 67`);
	if (A.appTables.length !== 66) issues.push(`MySQL has ${A.appTables.length} application tables, expected 66`);
	if (!allTables.includes(MYSQL_META_TABLE)) issues.push("MySQL migration history table (sequelizemeta) not found");
	A.appRows = A.appTables.reduce((s, t) => s + A.fingerprint.counts[t], 0);
	A.historyCount = A.fingerprint.migrationHistoryCount;
	if (A.historyCount !== 35) issues.push(`MySQL migration history has ${A.historyCount} records, expected 35`);

	// duplicate primary keys and orphaned foreign keys (read-only SQL)
	A.pkDuplicates = [];
	for (const t of A.appTables) {
		const pk = my_.tables[t].pk;
		if (!pk.length) {
			issues.push(`MySQL table ${t} has no primary key`);
			continue;
		}
		const cols = pk.map((c) => "`" + c + "`").join(", ");
		const [r] = await my.query(`SELECT COUNT(*) AS n FROM (SELECT ${cols} FROM \`${t}\` GROUP BY ${cols} HAVING COUNT(*) > 1) d`);
		if (Number(r[0].n)) A.pkDuplicates.push(t);
	}
	if (A.pkDuplicates.length) issues.push(`duplicate primary keys in: ${A.pkDuplicates.join(", ")}`);
	A.orphans = [];
	for (const f of my_.fks) {
		const on = f.cols.map((c, i) => `a.\`${c}\` = b.\`${f.refCols[i]}\``).join(" AND ");
		const nn = f.cols.map((c) => `a.\`${c}\` IS NOT NULL`).join(" AND ");
		const [r] = await my.query(`SELECT COUNT(*) AS n FROM \`${f.table}\` a LEFT JOIN \`${f.ref}\` b ON ${on} WHERE ${nn} AND b.\`${f.refCols[0]}\` IS NULL`);
		if (Number(r[0].n)) A.orphans.push(`${f.table}.${f.name}: ${r[0].n}`);
	}
	if (A.orphans.length) issues.push(`orphaned foreign-key rows in MySQL: ${A.orphans.join("; ")}`);
	A.fkCount = my_.fks.length;

	// ---- PostgreSQL
	const [{ version, db, usr }] = (await pgc.query("select version() as version, current_database() as db, current_user as usr")).rows;
	A.pg = { version: version.split(",")[0], database: db, user: usr };
	if (!/^PostgreSQL 18\./.test(version)) issues.push(`PostgreSQL version is "${A.pg.version}", expected 18.x`);
	const pgs = await pgSchema(pgc);
	A.pgSchema = pgs;
	const pgTables = Object.keys(pgs);
	A.pgAppTables = pgTables.filter((t) => t !== PG_META_TABLE && t !== HISTORY_TABLE);
	const missing = A.appTables.filter((t) => !pgs[t]);
	const extra = A.pgAppTables.filter((t) => !my_.tables[t]);
	if (missing.length) issues.push(`tables missing in PostgreSQL: ${missing.join(", ")}`);
	if (extra.length) issues.push(`unexpected extra tables in PostgreSQL: ${extra.join(", ")}`);
	if (A.pgAppTables.length !== 66) issues.push(`PostgreSQL has ${A.pgAppTables.length} application tables, expected 66`);

	A.schemaMismatch = [];
	for (const t of A.appTables) {
		if (!pgs[t]) continue;
		const m = my_.tables[t];
		const p = pgs[t];
		if (JSON.stringify(m.columns) !== JSON.stringify(p.columns)) {
			A.schemaMismatch.push(`${t}: column list/order differs`);
			continue;
		}
		if (JSON.stringify(m.pk) !== JSON.stringify(p.pk)) A.schemaMismatch.push(`${t}: primary key differs`);
		for (const c of m.columns) {
			let expected;
			try {
				expected = mapType(m.types[c]).fmt;
			} catch (e) {
				A.schemaMismatch.push(`${t}.${c}: ${e.message}`);
				continue;
			}
			if (expected !== p.fmts[c]) A.schemaMismatch.push(`${t}.${c}: PostgreSQL type is ${p.fmts[c]}, approved mapping says ${expected}`);
		}
	}
	if (A.schemaMismatch.length) issues.push(`schema mismatch: ${A.schemaMismatch.slice(0, 8).join("; ")}${A.schemaMismatch.length > 8 ? " ..." : ""}`);

	// target must be empty
	A.pgCounts = {};
	for (const t of A.pgAppTables) A.pgCounts[t] = Number((await pgc.query(`select count(*) as n from ${IDENT(t)}`)).rows[0].n);
	A.pgRows = Object.values(A.pgCounts).reduce((a, b) => a + b, 0);
	const nonEmpty = Object.entries(A.pgCounts).filter(([, n]) => n > 0);
	if (nonEmpty.length) issues.push(`PostgreSQL application tables are NOT empty: ${nonEmpty.map(([t, n]) => `${t}=${n}`).join(", ")}`);

	// migration history of PostgreSQL itself must be exactly what Phase 3 created
	const metaNames = (await pgc.query(`select name from ${IDENT(PG_META_TABLE)} order by name`)).rows.map((r) => r.name);
	A.pgMeta = metaNames;
	if (JSON.stringify(metaNames) !== JSON.stringify([...EXPECTED_PG_MIGRATIONS].sort())) issues.push(`PostgreSQL sequelizemeta is not the expected 4 migration records: ${metaNames.join(", ")}`);

	// history table: absent, or present-and-empty with the expected shape; anything else is unexpected
	A.historyTable = pgs[HISTORY_TABLE] ? "exists" : "absent";
	if (pgs[HISTORY_TABLE]) {
		const n = Number((await pgc.query(`select count(*) as n from ${IDENT(HISTORY_TABLE)}`)).rows[0].n);
		if (n > 0) issues.push(`${HISTORY_TABLE} already exists and contains ${n} rows`);
		else issues.push(`${HISTORY_TABLE} already exists (empty): inspect it before continuing`);
	}

	// no leftover test schemas, no other schemas, no sequences
	const schemas = (await pgc.query("select nspname from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema' order by 1")).rows.map((r) => r.nspname);
	A.pgSchemas = schemas;
	if (schemas.join() !== "public") issues.push(`PostgreSQL has schemas other than public (leftover test schemas?): ${schemas.join(", ")}`);
	A.pgSequences = Number((await pgc.query("select count(*) as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S'")).rows[0].n);
	const fkRows = (await pgc.query("select count(*) as n, count(*) filter (where convalidated) as validated from pg_constraint k join pg_namespace n on n.oid = k.connamespace where n.nspname = 'public' and k.contype = 'f'")).rows[0];
	A.pgFks = { total: Number(fkRows.n), validated: Number(fkRows.validated) };
	if (A.pgFks.total !== A.fkCount || A.pgFks.validated !== A.pgFks.total) issues.push(`PostgreSQL foreign keys: ${A.pgFks.total} (validated ${A.pgFks.validated}), MySQL has ${A.fkCount}`);

	// insert order
	const dep = dependencyOrder(A.appTables, my_.fks);
	A.order = dep.order;
	if (dep.unordered.length) issues.push(`circular foreign-key dependencies, cannot order: ${dep.unordered.join(", ")}`);
	if (dep.selfRef.length) issues.push(`self-referencing foreign keys need row ordering: ${dep.selfRef.join(", ")}`);

	// backups
	A.backup = verifyLatestBackup(BACKUP_DIR);
	if (!A.backup.ok) issues.push(`MySQL backup verification failed: ${A.backup.reason || JSON.stringify(A.backup.results.filter((r) => !r.ok))}`);

	// source data vs the previous audit (informational; a surprise is judged by the person reading this)
	A.drift = [];
	if (BASELINE_FILE && fs.existsSync(BASELINE_FILE)) {
		const base = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")).counts || {};
		for (const t of A.appTables) if (base[t] !== undefined && base[t] !== A.fingerprint.counts[t]) A.drift.push(`${t}: ${base[t]} -> ${A.fingerprint.counts[t]}`);
	}

	// ---- dry-run conversion of EVERY row (no PostgreSQL write): conversion problems are found before anything is copied
	A.data = {};
	A.conversionErrors = [];
	A.sourceHashes = {};
	for (const t of A.order) {
		if (!pgs[t] || JSON.stringify(my_.tables[t].columns) !== JSON.stringify(pgs[t].columns)) continue;
		const cols = pgs[t].columns;
		const kinds = cols.map((c) => pgs[t].kinds[c]);
		const rows = await readMysqlTable(my, t, my_.tables[t]);
		A.data[t] = { cols, kinds, rows, pk: my_.tables[t].pk };
		A.sourceHashes[t] = [];
		for (const row of rows) {
			const key = rowKey(my_.tables[t].pk, cols, kinds, row, "mysql");
			cols.forEach((c, i) => {
				try {
					toPgParam(kinds[i], row[c]);
				} catch (e) {
					if (e instanceof ConversionError) A.conversionErrors.push(`${t}[${key}].${c}: ${e.message}`);
					else throw e;
				}
			});
			A.sourceHashes[t].push(rowHash(cols, kinds, row, "mysql"));
		}
		if (rows.length !== A.fingerprint.counts[t]) issues.push(`${t}: read ${rows.length} rows but COUNT(*) says ${A.fingerprint.counts[t]}`);
	}
	if (A.conversionErrors.length) issues.push(`${A.conversionErrors.length} value(s) cannot be converted: ${A.conversionErrors.slice(0, 5).join("; ")}`);
	return A;
}

function printAudit(A) {
	line("================ PRE-MIGRATION AUDIT ================");
	line(`Source  : MySQL ${A.mysql.version}  database ${A.mysql.database}  tables ${A.mysql.tableCount} (application ${A.mysql.appTableCount} + sequelizemeta)`);
	line(`Target  : ${A.pg.version}  database ${A.pg.database}  user ${A.pg.user}  tables ${A.pgAppTables.length} application (+ sequelizemeta${A.historyTable === "exists" ? " + " + HISTORY_TABLE : ""})`);
	line(`Source application rows ${A.appRows}   |   MySQL migration-history records ${A.historyCount}   |   target application rows ${A.pgRows}`);
	line(`Foreign keys: MySQL ${A.fkCount}, PostgreSQL ${A.pgFks.total} (validated ${A.pgFks.validated})   |   PostgreSQL sequences in public: ${A.pgSequences}   |   schemas: ${A.pgSchemas.join(", ")}`);
	line(`PostgreSQL sequelizemeta: ${A.pgMeta.length} records, unchanged by this tool`);
	line(`Backups: ${A.backup.results ? A.backup.results.map((r) => `${r.file} ${r.ok ? "checksum OK" : "CHECKSUM/ FILE PROBLEM"}`).join("; ") : A.backup.reason}`);
	line(`Primary-key duplicates in MySQL: ${A.pkDuplicates.length ? A.pkDuplicates.join(", ") : "none"}   |   orphaned FK rows: ${A.orphans.length ? A.orphans.join("; ") : "none"}`);
	line(`Insert order (parents first): ${A.order.length} tables, ${A.order.slice(0, 6).join(" > ")} ...`);
	line(`Dry-run conversion of all ${Object.values(A.data).reduce((s, d) => s + d.rows.length, 0)} source rows: ${A.conversionErrors.length ? A.conversionErrors.length + " ERRORS" : "all values convert"}`);
	line(A.drift.length ? `Difference from the Stage 1 audit counts: ${A.drift.join("; ")}` : "Source row counts equal the Stage 1 audit baseline.");
	line();
	line(pad("table", 34) + num("MySQL", 7) + num("PG now", 8));
	for (const t of A.order) line(pad(t, 34) + num(A.fingerprint.counts[t], 7) + num(A.pgCounts[t] ?? "-", 8));
	line();
	line(A.issues.length ? `STOP - ${A.issues.length} problem(s):\n  - ${A.issues.join("\n  - ")}` : "AUDIT RESULT: no safety issue found.");
}

// ================================================================================================================
// Copy (rehearse = rolled back, execute = committed after every in-transaction check passed)
// ================================================================================================================
const pgValue = (kind, v) => toPgParam(kind, v);
const placeholder = (kind, n) => (kind === "jsonb" ? `$${n}::jsonb` : `$${n}`);

async function insertBatch(pgc, table, cols, kinds, rows, pkCols) {
	const params = [];
	const tuples = rows.map((row) => {
		const ph = cols.map((c, i) => {
			params.push(pgValue(kinds[i], row[c]));
			return placeholder(kinds[i], params.length);
		});
		return `(${ph.join(", ")})`;
	});
	const sql = `INSERT INTO ${IDENT(table)} (${cols.map(IDENT).join(", ")}) VALUES ${tuples.join(", ")}`;
	await pgc.query("SAVEPOINT batch");
	try {
		await pgc.query(sql, params);
		await pgc.query("RELEASE SAVEPOINT batch");
	} catch (e) {
		await pgc.query("ROLLBACK TO SAVEPOINT batch");
		// find the exact row (and primary key) that PostgreSQL refuses, for the report
		let failing = null;
		for (const row of rows) {
			const p = [];
			const ph = cols.map((c, i) => {
				p.push(pgValue(kinds[i], row[c]));
				return placeholder(kinds[i], p.length);
			});
			await pgc.query("SAVEPOINT one");
			try {
				await pgc.query(`INSERT INTO ${IDENT(table)} (${cols.map(IDENT).join(", ")}) VALUES (${ph.join(", ")})`, p);
				await pgc.query("RELEASE SAVEPOINT one");
			} catch (e2) {
				await pgc.query("ROLLBACK TO SAVEPOINT one");
				failing = { key: rowKey(pkCols, cols, kinds, row, "mysql"), code: e2.code, message: e2.message, detail: e2.detail, constraint: e2.constraint, column: e2.column };
				break;
			}
		}
		throw new MigrationError(`insert into ${table} failed`, failing || { code: e.code, message: e.message, detail: e.detail });
	}
}

async function verifyTable(pgc, table, d, pgInfo) {
	const back = await readPgTable(pgc, table, pgInfo);
	const problems = [];
	if (back.length !== d.rows.length) problems.push(`row count: MySQL ${d.rows.length}, PostgreSQL ${back.length}`);
	const want = new Map();
	for (const row of d.rows) want.set(rowKey(d.pk, d.cols, d.kinds, row, "mysql"), rowHash(d.cols, d.kinds, row, "mysql"));
	const got = new Map();
	const gotHashes = [];
	for (const row of back) {
		const h = rowHash(d.cols, d.kinds, row, "pg");
		got.set(rowKey(d.pk, d.cols, d.kinds, row, "pg"), h);
		gotHashes.push(h);
	}
	for (const [k, h] of want) {
		if (!got.has(k)) problems.push(`missing primary key ${k}`);
		else if (got.get(k) !== h) problems.push(`content differs for primary key ${k}`);
	}
	for (const k of got.keys()) if (!want.has(k)) problems.push(`unexpected primary key ${k}`);
	return { problems, checksum: tableChecksum(gotHashes), sourceChecksum: tableChecksum([...want.values()]), rows: back.length };
}

async function copy(A, my, pgc, commit) {
	const result = { tables: {}, history: null };
	await pgc.query("BEGIN");
	try {
		// --- the separate table for the 35 historical MySQL migration records
		await pgc.query(HISTORY_DDL);
		const [metaRows] = await my.query(`SELECT name FROM \`${MYSQL_META_TABLE}\` ORDER BY name`);
		const names = metaRows.map((r) => r.name);
		if (names.length !== 35) throw new MigrationError("MySQL migration history changed during the run", { count: names.length });

		// --- application tables, parents first
		for (const t of A.order) {
			const d = A.data[t];
			const maxRows = Math.max(1, Math.floor(BATCH_PARAM_LIMIT / d.cols.length));
			for (let i = 0; i < d.rows.length; i += maxRows) await insertBatch(pgc, t, d.cols, d.kinds, d.rows.slice(i, i + maxRows), d.pk);
			const v = await verifyTable(pgc, t, d, A.pgSchema[t]);
			result.tables[t] = { source: d.rows.length, target: v.rows, problems: v.problems, checksum: v.checksum, sourceChecksum: v.sourceChecksum };
			if (v.problems.length) throw new MigrationError(`verification of ${t} failed inside the transaction`, v.problems.slice(0, 10));
		}

		// --- migration history (explicit ids keep the original order), then the identity sequence
		await pgc.query(`INSERT INTO ${IDENT(HISTORY_TABLE)} ("id", "name") SELECT ord, name FROM unnest($1::text[]) WITH ORDINALITY AS t(name, ord)`, [names]);
		await pgc.query(`SELECT setval(pg_get_serial_sequence('${HISTORY_TABLE}', 'id'), (SELECT max("id") FROM ${IDENT(HISTORY_TABLE)}))`);
		const h = (await pgc.query(`SELECT "id", "name" FROM ${IDENT(HISTORY_TABLE)} ORDER BY "id"`)).rows;
		const historyOk = h.length === names.length && h.every((r, i) => r.id === i + 1 && r.name === names[i]);
		result.history = { source: names.length, target: h.length, ok: historyOk };
		if (!historyOk) throw new MigrationError("migration history copy does not match", {});

		// --- foreign keys of the copied data, checked while the transaction is still open
		await pgc.query("SET CONSTRAINTS ALL IMMEDIATE");
		const meta = (await pgc.query(`select name from ${IDENT(PG_META_TABLE)} order by name`)).rows.map((r) => r.name);
		if (JSON.stringify(meta) !== JSON.stringify(A.pgMeta)) throw new MigrationError("PostgreSQL sequelizemeta changed", { meta });

		if (commit) {
			await pgc.query("COMMIT");
			result.committed = true;
		} else {
			await pgc.query("ROLLBACK");
			result.committed = false;
		}
	} catch (e) {
		await pgc.query("ROLLBACK").catch(() => {});
		result.error = e;
		result.committed = false;
	}
	return result;
}

// ================================================================================================================
async function main() {
	const my = await openMysql();
	const pgc = await openPg();
	let exitCode = 0;
	try {
		const A = await audit(my, pgc);
		printAudit(A);
		if (A.issues.length) {
			line("\nNothing was written. Resolve the problem(s) above first.");
			exitCode = 2;
			return;
		}
		if (MODE === "audit") {
			line("\nAudit only (no --rehearse / --execute): nothing was written to either database.");
			return;
		}

		line(`\n================ ${MODE === "execute" ? "COPY (will COMMIT only if every check passes)" : "REHEARSAL (always rolled back)"} ================`);
		const r = await copy(A, my, pgc, MODE === "execute");
		if (r.error) {
			line(`FAILED: ${r.error.message}`);
			if (r.error.detail) line("  detail: " + JSON.stringify(r.error.detail));
			line("The PostgreSQL transaction was rolled back: no data was kept. MySQL was not touched.");
			exitCode = 1;
		} else {
			let copied = 0;
			line(pad("table", 34) + num("MySQL", 7) + num("copied", 8) + "  verified-in-transaction");
			for (const t of A.order) {
				const x = r.tables[t];
				copied += x.target;
				line(pad(t, 34) + num(x.source, 7) + num(x.target, 8) + "  " + (x.checksum === x.sourceChecksum && !x.problems.length ? "identical" : "DIFFERENT"));
			}
			line(pad(HISTORY_TABLE, 34) + num(r.history.source, 7) + num(r.history.target, 8) + "  " + (r.history.ok ? "identical, original order" : "DIFFERENT"));
			line(`\nApplication rows copied: ${copied} of ${A.appRows}   |   history records: ${r.history.target} of ${A.historyCount}`);
			line(r.committed ? "RESULT: COMMITTED." : "RESULT: rehearsal succeeded and was rolled back (PostgreSQL unchanged).");
			if (r.committed) {
				await pgc.query("ANALYZE"); // planner statistics only
				fs.mkdirSync(BACKUP_DIR, { recursive: true });
				const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
				const manifest = {
					createdAt: new Date().toISOString(),
					mysql: A.mysql,
					postgres: A.pg,
					fingerprintBefore: A.fingerprint,
					tables: Object.fromEntries(A.order.map((t) => [t, { rows: r.tables[t].target, checksum: r.tables[t].checksum }])),
					history: r.history,
				};
				const file = path.join(BACKUP_DIR, `phase5-migration-manifest-${stamp}.json`);
				fs.writeFileSync(file, JSON.stringify(manifest, null, 1), { flag: "wx" });
				line(`Manifest (counts + checksums, no data): ${file}`);
			}
		}
		const counters = await mysqlSessionWriteCounters(my);
		line(`\nMySQL write statements issued by this tool's session: ${JSON.stringify(counters)}`);
		if (Object.values(counters).some((v) => v > 0)) {
			line("UNEXPECTED: the MySQL session reports write statements.");
			exitCode = 3;
		}
	} finally {
		await my.query("ROLLBACK").catch(() => {});
		await my.end().catch(() => {});
		await pgc.end().catch(() => {});
		process.exitCode = exitCode;
	}
}

main().catch((e) => {
	console.error(`${e.name}: ${e.message}`);
	process.exitCode = 1;
});
