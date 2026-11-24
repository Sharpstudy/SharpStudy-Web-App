// Independent reconciliation of the MySQL -> PostgreSQL data migration. Read-only on BOTH databases.
//
//   yarn db:reconcile [--manifest <file>] [--backup-dir <dir>]
//
// It opens its own fresh connections (nothing is shared with the migration tool), re-reads every table of both databases and
// compares them row by row. Exit code 0 only when everything is identical.
import fs from "node:fs";
import path from "node:path";
import { rowHash, rowKey, tableChecksum } from "./lib/data-convert.mjs";
import {
	IDENT, MYSQL_META_TABLE, PG_META_TABLE, HISTORY_TABLE, EXPECTED_PG_MIGRATIONS,
	openMysql, openPg, mysqlSchema, pgSchema, dependencyOrder, readMysqlTable, readPgTable, verifyLatestBackup, mysqlFingerprint, mysqlSessionWriteCounters,
} from "./lib/migration-io.mjs";

const args = process.argv.slice(2);
const argValue = (n) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : null);
const BACKUP_DIR = argValue("--backup-dir") || path.join(process.cwd(), "..", "SharpStudy-DB-Backups");
const failures = [];
const fail = (m) => failures.push(m);
const line = (s = "") => console.log(s);
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

// business totals: the same question asked of both databases (actual table and column names)
const BUSINESS = [
	["users by role and status", "SELECT role, status, COUNT(*) AS n FROM users GROUP BY role, status ORDER BY role, status", "SELECT role, status::int AS status, COUNT(*) AS n FROM users GROUP BY role, status ORDER BY role, status"],
	["users: confirmed e-mails / distinct lower-case e-mails", "SELECT SUM(email_confirmed) AS confirmed, COUNT(DISTINCT LOWER(email)) AS distinct_emails FROM users", "SELECT SUM(email_confirmed::int) AS confirmed, COUNT(DISTINCT LOWER(email)) AS distinct_emails FROM users"],
	["categories", "SELECT COUNT(*) AS n FROM categories", "SELECT COUNT(*) AS n FROM categories"],
	["courses: count, approved, list price, original price", "SELECT COUNT(*) AS n, SUM(approved) AS approved, ROUND(SUM(latest_price),3) AS latest, ROUND(SUM(before_price),3) AS before_price FROM courses", "SELECT COUNT(*) AS n, SUM(approved::int) AS approved, ROUND(SUM(latest_price::double precision)::numeric,3) AS latest, ROUND(SUM(before_price::double precision)::numeric,3) AS before_price FROM courses"],
	["enrolments: count and purchased-price total, by status", "SELECT status, COUNT(*) AS n, ROUND(SUM(bought_price),3) AS total FROM enrolments GROUP BY status ORDER BY status", "SELECT status, COUNT(*) AS n, ROUND(SUM(bought_price::double precision)::numeric,3) AS total FROM enrolments GROUP BY status ORDER BY status"],
	["instructor earnings", "SELECT COUNT(*) AS n, ROUND(SUM(earnings),3) AS total FROM instructor_earnings", "SELECT COUNT(*) AS n, ROUND(SUM(earnings::double precision)::numeric,3) AS total FROM instructor_earnings"],
	["coupons and discounts", "SELECT COUNT(*) AS n, ROUND(SUM(discount),3) AS total FROM coupons", "SELECT COUNT(*) AS n, ROUND(SUM(discount::double precision)::numeric,3) AS total FROM coupons"],
	["book orders by payment status", "SELECT status, COUNT(*) AS n, SUM(amount_cents) AS cents FROM book_orders GROUP BY status ORDER BY status", "SELECT status, COUNT(*) AS n, SUM(amount_cents) AS cents FROM book_orders GROUP BY status ORDER BY status"],
	["books", "SELECT status, COUNT(*) AS n, SUM(price_cents) AS cents FROM books GROUP BY status ORDER BY status", "SELECT status, COUNT(*) AS n, SUM(price_cents) AS cents FROM books GROUP BY status ORDER BY status"],
	["Mastery Ladder attempts", "SELECT COUNT(*) AS n, ROUND(SUM(accuracy),4) AS accuracy, SUM(duration_ms) AS duration_ms, SUM(hints_used) AS hints, SUM(stars) AS stars FROM ml_attempts", "SELECT COUNT(*) AS n, ROUND(SUM(accuracy::double precision)::numeric,4) AS accuracy, SUM(duration_ms) AS duration_ms, SUM(hints_used) AS hints, SUM(stars) AS stars FROM ml_attempts"],
	["Mastery Ladder daily activity (worksheets, stars, seconds)", "SELECT COUNT(*) AS n, SUM(worksheets) AS worksheets, SUM(stars) AS stars, SUM(seconds) AS seconds FROM ml_daily_activity", "SELECT COUNT(*) AS n, SUM(worksheets) AS worksheets, SUM(stars) AS stars, SUM(seconds) AS seconds FROM ml_daily_activity"],
	["Mastery Ladder learners / progress / enrolments / assignments / roles", "SELECT (SELECT COUNT(*) FROM ml_learners) AS learners, (SELECT COUNT(*) FROM ml_progress) AS progress, (SELECT COUNT(*) FROM ml_subject_enrolments) AS enrolments, (SELECT COUNT(*) FROM ml_assignments) AS assignments, (SELECT COUNT(*) FROM ml_roles) AS roles, (SELECT COUNT(*) FROM ml_user_roles) AS user_roles", "SELECT (SELECT COUNT(*) FROM ml_learners) AS learners, (SELECT COUNT(*) FROM ml_progress) AS progress, (SELECT COUNT(*) FROM ml_subject_enrolments) AS enrolments, (SELECT COUNT(*) FROM ml_assignments) AS assignments, (SELECT COUNT(*) FROM ml_roles) AS roles, (SELECT COUNT(*) FROM ml_user_roles) AS user_roles"],
	["parent / student links (guardians, link codes by status, devices)", "SELECT (SELECT COUNT(*) FROM ml_learner_guardians) AS guardians, (SELECT COUNT(*) FROM fam_devices) AS devices, (SELECT COUNT(*) FROM fam_pins) AS pins, (SELECT COUNT(*) FROM fam_link_codes WHERE status = 'used') AS link_used, (SELECT COUNT(*) FROM fam_link_codes WHERE status = 'replaced') AS link_replaced, (SELECT COUNT(*) FROM fam_link_codes WHERE requested_by IS NOT NULL) AS link_requested, (SELECT COUNT(*) FROM fam_link_codes WHERE code_hash IS NULL) AS link_no_hash", "SELECT (SELECT COUNT(*) FROM ml_learner_guardians) AS guardians, (SELECT COUNT(*) FROM fam_devices) AS devices, (SELECT COUNT(*) FROM fam_pins) AS pins, (SELECT COUNT(*) FROM fam_link_codes WHERE status = 'used') AS link_used, (SELECT COUNT(*) FROM fam_link_codes WHERE status = 'replaced') AS link_replaced, (SELECT COUNT(*) FROM fam_link_codes WHERE requested_by IS NOT NULL) AS link_requested, (SELECT COUNT(*) FROM fam_link_codes WHERE code_hash IS NULL) AS link_no_hash"],
	["live classes: sessions by status, attendance by status, enrolments", "SELECT status, COUNT(*) AS n FROM lc_classes GROUP BY status ORDER BY status", "SELECT status, COUNT(*) AS n FROM lc_classes GROUP BY status ORDER BY status"],
	["live attendance by status", "SELECT status, COUNT(*) AS n FROM lc_attendance GROUP BY status ORDER BY status", "SELECT status, COUNT(*) AS n FROM lc_attendance GROUP BY status ORDER BY status"],
	["meeting requests by status / follow-ups / call logs", "SELECT (SELECT COUNT(*) FROM meeting_requests WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM meeting_requests) AS requests, (SELECT COUNT(*) FROM meeting_followups) AS followups, (SELECT COUNT(*) FROM meeting_call_logs) AS calls, (SELECT COUNT(*) FROM meeting_followup_events) AS followup_events, (SELECT COUNT(*) FROM meeting_request_events) AS request_events", "SELECT (SELECT COUNT(*) FROM meeting_requests WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM meeting_requests) AS requests, (SELECT COUNT(*) FROM meeting_followups) AS followups, (SELECT COUNT(*) FROM meeting_call_logs) AS calls, (SELECT COUNT(*) FROM meeting_followup_events) AS followup_events, (SELECT COUNT(*) FROM meeting_request_events) AS request_events"],
	["telecaller / instructor applications and profiles", "SELECT (SELECT COUNT(*) FROM telecaller_applications) AS tc_apps, (SELECT COUNT(*) FROM telecaller_profiles) AS tc_profiles, (SELECT COUNT(*) FROM telecaller_resumes) AS tc_resumes, (SELECT COUNT(*) FROM instructor_applications) AS inst_apps, (SELECT COUNT(*) FROM instructor_profiles) AS inst_profiles, (SELECT COUNT(*) FROM student_removal_requests) AS removals", "SELECT (SELECT COUNT(*) FROM telecaller_applications) AS tc_apps, (SELECT COUNT(*) FROM telecaller_profiles) AS tc_profiles, (SELECT COUNT(*) FROM telecaller_resumes) AS tc_resumes, (SELECT COUNT(*) FROM instructor_applications) AS inst_apps, (SELECT COUNT(*) FROM instructor_profiles) AS inst_profiles, (SELECT COUNT(*) FROM student_removal_requests) AS removals"],
	["audit history (Mastery Ladder + live classes) and notifications", "SELECT (SELECT COUNT(*) FROM ml_audit_logs) AS ml_audit, (SELECT COUNT(*) FROM lc_audit_logs) AS lc_audit, (SELECT COUNT(*) FROM notifications) AS notifications", "SELECT (SELECT COUNT(*) FROM ml_audit_logs) AS ml_audit, (SELECT COUNT(*) FROM lc_audit_logs) AS lc_audit, (SELECT COUNT(*) FROM notifications) AS notifications"],
];

// Rows are compared as a SET: MySQL sorts an ENUM column by its definition order, PostgreSQL sorts text alphabetically, so ORDER BY alone
// would make identical data look different. (The application never orders by an enum column.)
const normRows = (rows) => JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v === null ? null : Number.isNaN(Number(v)) ? String(v) : Number(Number(v).toFixed(3))]))).map((o) => JSON.stringify(o)).sort());

async function main() {
	const my = await openMysql();
	const pgc = await openPg();
	try {
		// ---------------------------------------------------------------- schemas and manifest
		const mySchema = await mysqlSchema(my);
		const pgs = await pgSchema(pgc);
		const appTables = Object.keys(mySchema.tables).filter((t) => t !== MYSQL_META_TABLE);
		const order = dependencyOrder(appTables, mySchema.fks).order;
		const manifestFile = argValue("--manifest") || (fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("phase5-migration-manifest-")).sort().pop() : null);
		const manifest = manifestFile ? JSON.parse(fs.readFileSync(path.isAbsolute(manifestFile) ? manifestFile : path.join(BACKUP_DIR, manifestFile), "utf8")) : null;
		if (!manifest) fail("migration manifest not found");

		// ---------------------------------------------------------------- A. every table, content row by row
		line("=========== A. TABLE-BY-TABLE RECONCILIATION (66 application tables) ===========");
		line(pad("table", 32) + num("MySQL", 6) + num("PG", 6) + "  " + pad("primary keys", 13) + pad("content (all columns)", 24) + "result");
		const cell = { binary: 0, binaryBytes: 0, json: 0, jsonNull: 0, timestamps: 0, dates: 0, floats: 0, uuids: 0, nulls: 0, emptyStrings: 0 };
		let totalMy = 0, totalPg = 0, identical = 0;
		for (const t of order) {
			const m = mySchema.tables[t];
			const p = pgs[t];
			if (!p) {
				fail(`${t}: missing in PostgreSQL`);
				continue;
			}
			const cols = p.columns;
			const kinds = cols.map((c) => p.kinds[c]);
			const myRows = await readMysqlTable(my, t, m);
			const pgRows = await readPgTable(pgc, t, p);
			totalMy += myRows.length;
			totalPg += pgRows.length;
			const myMap = new Map();
			const dupMy = [];
			for (const r of myRows) {
				const k = rowKey(m.pk, cols, kinds, r, "mysql");
				if (myMap.has(k)) dupMy.push(k);
				myMap.set(k, rowHash(cols, kinds, r, "mysql"));
			}
			const pgMap = new Map();
			const dupPg = [];
			for (const r of pgRows) {
				const k = rowKey(m.pk, cols, kinds, r, "pg");
				if (pgMap.has(k)) dupPg.push(k);
				pgMap.set(k, rowHash(cols, kinds, r, "pg"));
			}
			const missing = [...myMap.keys()].filter((k) => !pgMap.has(k));
			const extra = [...pgMap.keys()].filter((k) => !myMap.has(k));
			const differ = [...myMap.keys()].filter((k) => pgMap.has(k) && pgMap.get(k) !== myMap.get(k));
			const checksum = tableChecksum([...pgMap.values()]);
			const sourceChecksum = tableChecksum([...myMap.values()]);
			const manifestChecksum = manifest && manifest.tables[t] ? manifest.tables[t].checksum : null;
			const pkOk = !missing.length && !extra.length && !dupMy.length && !dupPg.length && myRows.length === pgRows.length;
			const contentOk = !differ.length && checksum === sourceChecksum;
			const manifestOk = manifestChecksum === null || manifestChecksum === checksum;
			if (!pkOk) fail(`${t}: primary keys differ (missing ${missing.length}, extra ${extra.length}, duplicates ${dupMy.length + dupPg.length}, rows ${myRows.length} vs ${pgRows.length})`);
			if (!contentOk) fail(`${t}: content differs for ${differ.length} row(s), first key ${differ[0]}`);
			if (!manifestOk) fail(`${t}: checksum differs from the migration manifest (PostgreSQL changed after the copy?)`);
			if (pkOk && contentOk && manifestOk) identical++;
			line(pad(t, 32) + num(myRows.length, 6) + num(pgRows.length, 6) + "  " + pad(pkOk ? "identical" : "DIFFERENT", 13) + pad(contentOk ? "identical" : `DIFFERENT (${differ.length})`, 24) + (pkOk && contentOk && manifestOk ? "PASS" : "FAIL"));
			// statistics for the special-data section
			for (const r of pgRows) {
				cols.forEach((c, i) => {
					const v = r[c];
					if (v === null) cell.nulls++;
					else if (v === "") cell.emptyStrings++;
					if (v === null) return;
					if (kinds[i] === "bytea") {
						cell.binary++;
						cell.binaryBytes += v.length;
					} else if (kinds[i] === "jsonb") {
						cell.json++;
						if (v === "null") cell.jsonNull++;
					} else if (kinds[i] === "timestamptz") cell.timestamps++;
					else if (kinds[i] === "date") cell.dates++;
					else if (kinds[i] === "real") cell.floats++;
					else if (kinds[i] === "uuid") cell.uuids++;
				});
			}
		}
		line(`\nTotals: MySQL ${totalMy} rows, PostgreSQL ${totalPg} rows; ${identical} of ${order.length} tables identical (row counts, primary keys and every column of every row).`);
		if (totalMy !== totalPg) fail(`total rows differ: ${totalMy} vs ${totalPg}`);
		if (identical !== 66) fail(`only ${identical} of 66 tables are fully identical`);

		// ---------------------------------------------------------------- B. foreign keys
		line("\n=========== B. FOREIGN KEYS ===========");
		const fkq = await pgc.query(`select c.relname as t, k.conname as name, k.convalidated as validated, r.relname as rt, k.confdeltype as del,
			(select string_agg(format('a.%I = b.%I', a.attname, b2.attname), ' and ' order by x.ord) from unnest(k.conkey, k.confkey) with ordinality x(l, r, ord) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.l join pg_attribute b2 on b2.attrelid = k.confrelid and b2.attnum = x.r) as on_clause,
			(select string_agg(format('a.%I is not null', a.attname), ' and ') from unnest(k.conkey) x(l) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.l) as notnull_clause,
			(select format('b.%I', b2.attname) from unnest(k.confkey) with ordinality x(r, ord) join pg_attribute b2 on b2.attrelid = k.confrelid and b2.attnum = x.r order by x.ord limit 1) as ref_col
			from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class r on r.oid = k.confrelid join pg_namespace n on n.oid = k.connamespace where n.nspname = 'public' and k.contype = 'f' order by 1, 2`);
		let orphanTotal = 0, validated = 0;
		const rules = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL" };
		const ruleCount = {};
		for (const f of fkq.rows) {
			const n = Number((await pgc.query(`select count(*) as n from ${IDENT(f.t)} a left join ${IDENT(f.rt)} b on ${f.on_clause} where ${f.notnull_clause} and ${f.ref_col} is null`)).rows[0].n);
			orphanTotal += n;
			if (f.validated) validated++;
			ruleCount[rules[f.del]] = (ruleCount[rules[f.del]] || 0) + 1;
			if (n) fail(`foreign key ${f.t}.${f.name}: ${n} orphaned row(s)`);
			if (!f.validated) fail(`foreign key ${f.t}.${f.name} is not validated`);
		}
		line(`Foreign keys in PostgreSQL: ${fkq.rows.length} (MySQL ${mySchema.fks.length}); validated ${validated}; orphaned rows ${orphanTotal}; delete rules ${JSON.stringify(ruleCount)}`);
		if (fkq.rows.length !== mySchema.fks.length || fkq.rows.length !== 105) fail(`foreign key count ${fkq.rows.length} vs MySQL ${mySchema.fks.length}`);
		line("Delete rules and referenced columns are compared with MySQL by `yarn db:compare-schema` (run separately).");

		// ---------------------------------------------------------------- C. business data
		line("\n=========== C. IMPORTANT BUSINESS DATA (same question asked of both databases) ===========");
		for (const [name, mq, pq] of BUSINESS) {
			const a = normRows((await my.query(mq))[0]);
			const b = normRows((await pgc.query(pq)).rows);
			const ok = a === b;
			if (!ok) fail(`business check "${name}": MySQL ${a} vs PostgreSQL ${b}`);
			line(`${ok ? "PASS" : "FAIL"}  ${pad(name, 70)} ${a.length > 150 ? a.slice(0, 150) + "..." : a}`);
		}

		// ---------------------------------------------------------------- D. binary / JSON / timestamps / dates
		line("\n=========== D. BINARY, JSON, TIMESTAMP AND DATE VERIFICATION ===========");
		line(`Binary values compared by length + SHA-256: ${cell.binary} (${cell.binaryBytes} bytes in total); JSON values compared as parsed structures: ${cell.json} (JSON null values: ${cell.jsonNull}); timestamps compared as UTC instants: ${cell.timestamps}; plain dates: ${cell.dates}; single-precision floats: ${cell.floats}; UUIDs: ${cell.uuids}; NULL cells: ${cell.nulls}; empty strings: ${cell.emptyStrings}`);
		for (const [t, c] of [["live_question_images", "data"], ["telecaller_resumes", "data"]]) {
			const a = (await my.query(`SELECT LENGTH(\`${c}\`) AS len, SHA2(\`${c}\`, 256) AS sha FROM \`${t}\` ORDER BY id`))[0];
			const b = (await pgc.query(`SELECT octet_length(${IDENT(c)}) AS len, encode(sha256(${IDENT(c)}), 'hex') AS sha FROM ${IDENT(t)} ORDER BY id`)).rows;
			const ok = JSON.stringify(a.map((r) => [Number(r.len), r.sha])) === JSON.stringify(b.map((r) => [Number(r.len), r.sha]));
			if (!ok) fail(`binary column ${t}.${c} differs`);
			line(`${ok ? "PASS" : "FAIL"}  ${t}.${c}: ${a.length} file(s), bytes ${a.map((r) => r.len).join(", ")}, SHA-256 computed independently by MySQL and by PostgreSQL ${ok ? "identical" : "DIFFERENT"}`);
		}
		const jsonCols = [];
		for (const t of order) for (const c of pgs[t].columns) if (pgs[t].kinds[c] === "jsonb") jsonCols.push([t, c]);
		// JSON values are compared as parsed structures inside the row-by-row comparison of section A (jsonb is read back as text)
		line(`JSON columns (${jsonCols.length}): ${jsonCols.map(([t, c]) => `${t}.${c}`).join(", ")}`);
		line(`All ${cell.json} JSON values were compared by parsed structure (key order and spacing ignored, content not).`);
		const tz = await pgc.query("select min(created_at) as a, max(created_at) as b, current_setting('TimeZone') as tz from users");
		line(`Sample instant check - users.created_at spans ${new Date(tz.rows[0].a).toISOString()} .. ${new Date(tz.rows[0].b).toISOString()} (UTC); MySQL stores the same range as ${(await my.query("select min(created_at) as a, max(created_at) as b from users"))[0][0].a} .. ${(await my.query("select min(created_at) as a, max(created_at) as b from users"))[0][0].b}`);

		// ---------------------------------------------------------------- E. sequences, migration history, PostgreSQL history untouched
		line("\n=========== E. SEQUENCES AND MIGRATION HISTORY ===========");
		const seqs = (await pgc.query("select c.relname as seq, (select s.seqrelid from pg_sequence s where s.seqrelid = c.oid) is not null as is_seq from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S' order by 1")).rows;
		line(`Sequences in public: ${seqs.length} (${seqs.map((s) => s.seq).join(", ") || "none"}). Every application primary key is a UUID, so none of the 66 tables needs a sequence.`);
		if (seqs.length !== 1 || seqs[0].seq !== "mysql_migration_history_id_seq") fail(`unexpected sequences: ${seqs.map((s) => s.seq).join(", ")}`);
		const seqState = (await pgc.query("select last_value, is_called from mysql_migration_history_id_seq")).rows[0];
		const maxId = Number((await pgc.query(`select max(id) as m from ${IDENT(HISTORY_TABLE)}`)).rows[0].m);
		const seqOk = Number(seqState.last_value) === maxId && seqState.is_called === true;
		if (!seqOk) fail(`history sequence is at ${seqState.last_value} (is_called ${seqState.is_called}), max id ${maxId}`);
		line(`${seqOk ? "PASS" : "FAIL"}  mysql_migration_history_id_seq: last_value ${seqState.last_value}, is_called ${seqState.is_called}, max(id) ${maxId} -> the next value would be ${maxId + 1} (read from the catalog; no row was inserted to test it)`);
		const myMeta = (await my.query(`SELECT name FROM \`${MYSQL_META_TABLE}\` ORDER BY name`))[0].map((r) => r.name);
		const hist = (await pgc.query(`select id, name from ${IDENT(HISTORY_TABLE)} order by id`)).rows;
		const histOk = hist.length === myMeta.length && hist.every((r, i) => r.id === i + 1 && r.name === myMeta[i]);
		if (!histOk) fail("mysql_migration_history does not equal MySQL's migration history");
		line(`${histOk ? "PASS" : "FAIL"}  mysql_migration_history: ${hist.length} records, names and original order identical to MySQL's ${myMeta.length}`);
		const pgMeta = (await pgc.query(`select name from ${IDENT(PG_META_TABLE)} order by name`)).rows.map((r) => r.name);
		const metaOk = JSON.stringify(pgMeta) === JSON.stringify([...EXPECTED_PG_MIGRATIONS].sort());
		if (!metaOk) fail(`PostgreSQL sequelizemeta changed: ${pgMeta.join(", ")}`);
		line(`${metaOk ? "PASS" : "FAIL"}  PostgreSQL sequelizemeta: ${pgMeta.length} records, unchanged (${pgMeta.length === 4 ? "the 4 PostgreSQL migrations of Phase 3" : "UNEXPECTED"}); no historical MySQL migration was inserted or executed`);

		// ---------------------------------------------------------------- F. leftovers
		line("\n=========== F. LEFTOVERS ===========");
		const schemas = (await pgc.query("select nspname from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema' order by 1")).rows.map((r) => r.nspname);
		const tables = (await pgc.query("select count(*) as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")).rows[0].n;
		line(`PostgreSQL schemas: ${schemas.join(", ")} | tables in public: ${tables} (66 application + sequelizemeta + ${HISTORY_TABLE})`);
		if (schemas.join() !== "public") fail(`leftover schemas: ${schemas.join(", ")}`);
		if (Number(tables) !== 68) fail(`public has ${tables} tables, expected 68`);

		// ---------------------------------------------------------------- G. MySQL preservation
		line("\n=========== G. MYSQL PRESERVATION ===========");
		const fp = await mysqlFingerprint(my, mySchema);
		const before = manifest ? manifest.fingerprintBefore : null;
		const check = (label, ok, detail) => {
			line(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
			if (!ok) fail(`MySQL preservation: ${label}`);
		};
		check("table count", fp.tableCount === 67, `${fp.tableCount} (was ${before ? before.tableCount : "?"})`);
		if (before) {
			check("schema (columns, types, keys, indexes) identical to before the copy", fp.schemaSha256 === before.schemaSha256, fp.schemaSha256.slice(0, 16) + "...");
			check("migration history unchanged", fp.migrationHistorySha256 === before.migrationHistorySha256 && fp.migrationHistoryCount === before.migrationHistoryCount, `${fp.migrationHistoryCount} records`);
			const drift = Object.keys(before.counts).filter((t) => before.counts[t] !== fp.counts[t]);
			check("row counts of all 67 tables identical to before the copy", drift.length === 0 && fp.totalRows === before.totalRows, `${fp.totalRows} rows now, ${before.totalRows} before${drift.length ? "; changed: " + drift.map((t) => `${t} ${before.counts[t]}->${fp.counts[t]}`).join(", ") : ""}`);
		}
		const counters = await mysqlSessionWriteCounters(my);
		check("this tool's MySQL session issued no write statement", Object.values(counters).every((v) => v === 0), "INSERT/UPDATE/DELETE/DDL counters all 0");
		const bk = verifyLatestBackup(BACKUP_DIR);
		check("MySQL backups present and checksum-valid", bk.ok, bk.results ? bk.results.map((r) => r.file).join(", ") : bk.reason);

		line(`\n=========== RESULT: ${failures.length ? failures.length + " PROBLEM(S)" : "ALL CHECKS PASSED"} ===========`);
		for (const f of failures) line(" - " + f);
		process.exitCode = failures.length ? 1 : 0;
	} finally {
		await my.query("ROLLBACK").catch(() => {});
		await my.end().catch(() => {});
		await pgc.end().catch(() => {});
	}
}

main().catch((e) => {
	console.error(`${e.name}: ${e.message}`);
	process.exitCode = 1;
});
