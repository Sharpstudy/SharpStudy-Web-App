// Incremental MySQL -> PostgreSQL catch-up for rows that changed in MySQL AFTER the full copy (yarn db:migrate-data --execute).
//
//   yarn db:sync-delta                       report only (default): read-only on both databases
//   yarn db:sync-delta --apply --backup <f>  apply, inside ONE PostgreSQL transaction, committed only if the read-back matches
//
// Rules (nothing else is ever done):
//   * a row that exists only in MySQL is INSERTED into PostgreSQL (parents first);
//   * a row that differs is UPDATED in PostgreSQL only when MySQL's updated_at is NEWER than PostgreSQL's; otherwise it is left alone
//     and reported (never overwrite newer data with older data);
//   * a row that exists only in PostgreSQL is never touched;
//   * no TRUNCATE, no DELETE, no DDL. MySQL is read through a READ ONLY snapshot.
//   * --apply needs an existing, non-empty --backup file (take it with pg_dump first).
// Values are converted by the same rules as the full copy (scripts/db/lib/data-convert.mjs).
import fs from "node:fs";
import { toPgParam, rowHash, rowKey } from "./lib/data-convert.mjs";
import { IDENT, MYSQL_META_TABLE, PG_META_TABLE, HISTORY_TABLE, openMysql, openPg, mysqlSchema, pgSchema, dependencyOrder, readMysqlTable, readPgTable } from "./lib/migration-io.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const backup = args.includes("--backup") ? args[args.indexOf("--backup") + 1] : null;
if (APPLY && !(backup && fs.existsSync(backup) && fs.statSync(backup).size > 1000)) {
	console.error("Refusing to apply: --backup <existing non-empty file> is required.");
	process.exit(2);
}

const my = await openMysql();
const pgc = await openPg();
let committed = false;
try {
	const mys = await mysqlSchema(my);
	const pgs = await pgSchema(pgc);
	const tables = Object.keys(mys.tables).filter((t) => t !== MYSQL_META_TABLE && t !== PG_META_TABLE && t !== HISTORY_TABLE && pgs[t]);
	const plan = [];
	for (const t of tables) {
		const cols = pgs[t].columns;
		if (JSON.stringify(cols) !== JSON.stringify(mys.tables[t].columns)) throw new Error(`column lists differ for ${t}; run yarn db:compare-schema`);
		if (!pgs[t].pk.length) continue;
		const kinds = cols.map((c) => pgs[t].kinds[c]);
		const pk = pgs[t].pk;
		const mRows = await readMysqlTable(my, t, { pk });
		const pRows = await readPgTable(pgc, t, { pk, columns: cols, kinds: pgs[t].kinds });
		const pMap = new Map(pRows.map((r) => [rowKey(pk, cols, kinds, r, "pg"), r]));
		const item = { t, cols, kinds, pk, inserts: [], updates: [], skipped: [], mCount: mRows.length, pCount: pRows.length };
		const seen = new Set();
		for (const r of mRows) {
			const k = rowKey(pk, cols, kinds, r, "mysql");
			seen.add(k);
			const p = pMap.get(k);
			if (!p) item.inserts.push(r);
			else if (rowHash(cols, kinds, r, "mysql") !== rowHash(cols, kinds, p, "pg")) {
				const mu = r.updated_at ? Date.parse(String(r.updated_at).replace(" ", "T") + "Z") : NaN;
				const pu = p.updated_at ? new Date(p.updated_at).getTime() : NaN;
				if (cols.includes("updated_at") && mu > pu) item.updates.push(r);
				else item.skipped.push({ key: k, reason: cols.includes("updated_at") ? "PostgreSQL row is as new or newer" : "no updated_at to compare" });
			}
		}
		item.onlyPg = pRows.filter((r) => !seen.has(rowKey(pk, cols, kinds, r, "pg"))).length;
		if (item.inserts.length || item.updates.length || item.skipped.length || item.onlyPg) plan.push(item);
	}
	console.log(`Compared ${tables.length} tables.`);
	if (!plan.length) console.log("No differences: PostgreSQL matches MySQL.");
	for (const i of plan) {
		console.log(`${i.t}: MySQL ${i.mCount} rows, PostgreSQL ${i.pCount} rows -> insert ${i.inserts.length}, update ${i.updates.length}, left alone ${i.skipped.length}, PostgreSQL-only ${i.onlyPg}`);
		for (const r of i.inserts) console.log(`   insert  ${rowKey(i.pk, i.cols, i.kinds, r, "mysql")}`);
		for (const r of i.updates) console.log(`   update  ${rowKey(i.pk, i.cols, i.kinds, r, "mysql")} (MySQL updated_at ${r.updated_at})`);
		for (const s of i.skipped) console.log(`   skipped ${s.key}: ${s.reason}`);
	}
	if (!APPLY) {
		console.log("\nREPORT ONLY: nothing was written.");
	} else {
		const work = plan.filter((i) => i.inserts.length || i.updates.length);
		const order = dependencyOrder(work.map((i) => i.t), mys.fks);
		const orderedTables = Array.isArray(order) ? order : order.order || work.map((i) => i.t);
		await pgc.query("BEGIN");
		const ph = (kind, n) => (kind === "jsonb" ? `$${n}::jsonb` : `$${n}`);
		for (const t of orderedTables) {
			const i = work.find((w) => w.t === t);
			if (!i) continue;
			for (const r of i.inserts) {
				const p = i.cols.map((c, n) => toPgParam(i.kinds[n], r[c]));
				await pgc.query(`INSERT INTO ${IDENT(t)} (${i.cols.map(IDENT).join(", ")}) VALUES (${i.cols.map((c, n) => ph(i.kinds[n], n + 1)).join(", ")})`, p);
			}
			for (const r of i.updates) {
				const set = i.cols.filter((c) => !i.pk.includes(c));
				const p = [...set.map((c) => toPgParam(i.kinds[i.cols.indexOf(c)], r[c])), ...i.pk.map((c) => toPgParam(i.kinds[i.cols.indexOf(c)], r[c]))];
				const sql = `UPDATE ${IDENT(t)} SET ${set.map((c, n) => `${IDENT(c)} = ${ph(i.kinds[i.cols.indexOf(c)], n + 1)}`).join(", ")} WHERE ${i.pk.map((c, n) => `${IDENT(c)} = $${set.length + n + 1}`).join(" AND ")}`;
				const res = await pgc.query(sql, p);
				if (res.rowCount !== 1) throw new Error(`update of ${t} touched ${res.rowCount} rows`);
			}
		}
		// read-back inside the transaction: every row we wrote must now hash identically to MySQL
		let bad = 0;
		for (const i of work) {
			const rows = await readPgTable(pgc, i.t, { pk: i.pk, columns: i.cols, kinds: pgs[i.t].kinds });
			const m = new Map(rows.map((r) => [rowKey(i.pk, i.cols, i.kinds, r, "pg"), rowHash(i.cols, i.kinds, r, "pg")]));
			for (const r of [...i.inserts, ...i.updates]) if (m.get(rowKey(i.pk, i.cols, i.kinds, r, "mysql")) !== rowHash(i.cols, i.kinds, r, "mysql")) bad++;
		}
		if (bad) {
			await pgc.query("ROLLBACK");
			throw new Error(`${bad} written row(s) did not read back identically: rolled back, nothing changed`);
		}
		await pgc.query("COMMIT");
		committed = true;
		console.log("\nAPPLIED and verified by read-back; transaction committed.");
	}
} catch (e) {
	if (!committed) await pgc.query("ROLLBACK").catch(() => {});
	console.error(`STOPPED: ${e.message}`);
	process.exitCode = 1;
} finally {
	await my.end().catch(() => {});
	await pgc.end().catch(() => {});
}
