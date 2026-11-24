// Connections and introspection shared by the data-migration scripts. Credentials come from the environment
// (env-cmd loads the untracked .env; PostgreSQL uses pgpass.conf) and are never printed.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import pg from "pg";
import config from "../../../database/config/config.mjs";
import { kindOfPgType } from "./data-convert.mjs";

export const IDENT = (s) => '"' + String(s).replace(/"/g, '""') + '"';
export const MYID = (s) => "`" + String(s).replace(/`/g, "``") + "`";
export const MYSQL_META_TABLE = "sequelizemeta";
export const PG_META_TABLE = "sequelizemeta";
export const HISTORY_TABLE = "mysql_migration_history";
export const EXPECTED_PG_MIGRATIONS = [
	"20261101000001-pg-baseline-tables.js",
	"20261101000002-pg-baseline-indexes.js",
	"20261101000003-pg-baseline-foreign-keys.js",
	"20261101000004-pg-users-email-unique-ci.js",
];

const lower = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])));

// MySQL: one READ ONLY transaction with a consistent snapshot -> every table is read as of the same instant,
// and the server itself rejects any write on this connection.
export async function openMysql() {
	if (process.env.DB_NAME_DEVELOPMENT !== "sharpstudy_dev") throw new Error("Refusing to run: DB_NAME_DEVELOPMENT is not sharpstudy_dev");
	const conn = await mysql.createConnection({
		host: process.env.DB_HOSTNAME,
		port: Number(process.env.DB_PORT) || 3306,
		user: process.env.DB_USERNAME,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME_DEVELOPMENT,
		charset: "UTF8MB4_UNICODE_CI",
		dateStrings: true,
		timezone: "Z",
		// JSON arrives as raw text so SQL NULL and the JSON value null remain distinguishable
		typeCast: (field, next) => (field.type === "JSON" ? field.string() : next()),
	});
	await conn.query("SET SESSION TRANSACTION READ ONLY");
	await conn.query("SET time_zone = '+00:00'");
	await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
	return conn;
}

// PostgreSQL: the real `public` schema only. A search_path override (used by the throw-away test schemas) is refused.
export async function openPg() {
	if (process.env.PG_SEARCH_PATH) throw new Error("Refusing to run: PG_SEARCH_PATH is set (that is for test schemas only)");
	const cfg = config.postgres_development;
	const types = { getTypeParser: (oid, format) => (oid === 1082 ? (v) => v : pg.types.getTypeParser(oid, format)) }; // DATE stays plain text
	const client = new pg.Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.username, ...(cfg.password ? { password: cfg.password } : {}), types });
	await client.connect();
	await client.query("SET TIME ZONE 'UTC'");
	await client.query("SET search_path TO public");
	const [{ db }] = (await client.query("select current_database() as db")).rows;
	if (db !== "sharpstudy_dev") throw new Error("Refusing to run: connected database is not sharpstudy_dev");
	return client;
}

// ---- MySQL introspection --------------------------------------------------------------------------------------
export async function mysqlSchema(my) {
	const q = async (sql) => lower((await my.query(sql))[0]);
	const tables = (await q("select table_name from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE' order by 1")).map((r) => r.table_name);
	const cols = await q("select table_name, column_name, column_type from information_schema.columns where table_schema = database() order by table_name, ordinal_position");
	const stats = await q("select table_name, index_name, non_unique, seq_in_index, column_name from information_schema.statistics where table_schema = database() order by table_name, index_name, seq_in_index");
	const fks = await q(
		"select k.table_name, k.constraint_name, k.column_name, k.referenced_table_name, k.referenced_column_name from information_schema.key_column_usage k where k.table_schema = database() and k.referenced_table_name is not null order by 1, 2, k.ordinal_position"
	);
	const out = {};
	for (const t of tables) out[t] = { columns: [], types: {}, pk: [] };
	for (const c of cols) {
		out[c.table_name].columns.push(c.column_name);
		out[c.table_name].types[c.column_name] = c.column_type;
	}
	for (const s of stats) if (s.index_name === "PRIMARY") out[s.table_name].pk.push(s.column_name);
	const fkMap = new Map();
	for (const f of fks) {
		const k = `${f.table_name}.${f.constraint_name}`;
		if (!fkMap.has(k)) fkMap.set(k, { table: f.table_name, name: f.constraint_name, ref: f.referenced_table_name, cols: [], refCols: [] });
		fkMap.get(k).cols.push(f.column_name);
		fkMap.get(k).refCols.push(f.referenced_column_name);
	}
	return { tables: out, fks: [...fkMap.values()] };
}

// ---- PostgreSQL introspection ------------------------------------------------------------------------------------
export async function pgSchema(client) {
	const t = await client.query("select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1");
	const cols = await client.query(`select c.relname as t, a.attname as c, format_type(a.atttypid, a.atttypmod) as fmt, a.attnotnull as nn
		from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by c.relname, a.attnum`);
	const pks = await client.query(`select c.relname as t, (select array_agg(a.attname::text order by x.ord) from unnest(k.conkey) with ordinality x(attnum, ord) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.attnum) as cols
		from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and k.contype = 'p'`);
	const out = {};
	for (const r of t.rows) out[r.t] = { columns: [], fmts: {}, kinds: {}, pk: [] };
	for (const r of cols.rows) {
		out[r.t].columns.push(r.c);
		out[r.t].fmts[r.c] = r.fmt;
		out[r.t].kinds[r.c] = kindOfPgType(r.fmt);
	}
	for (const r of pks.rows) out[r.t].pk = r.cols;
	return out;
}

// parents first; reports tables that cannot be ordered (circular or self references)
export function dependencyOrder(tables, fks) {
	const deps = new Map(tables.map((t) => [t, new Set()]));
	const selfRef = [];
	for (const f of fks) {
		if (f.table === f.ref) selfRef.push(f.table);
		else if (deps.has(f.table) && deps.has(f.ref)) deps.get(f.table).add(f.ref);
	}
	const order = [];
	const done = new Set();
	let progress = true;
	while (order.length < tables.length && progress) {
		progress = false;
		for (const t of [...tables].sort()) {
			if (!done.has(t) && [...deps.get(t)].every((d) => done.has(d))) {
				order.push(t);
				done.add(t);
				progress = true;
			}
		}
	}
	return { order, unordered: tables.filter((t) => !done.has(t)), selfRef: [...new Set(selfRef)] };
}

export async function readMysqlTable(my, table, info) {
	const orderBy = info.pk.length ? " ORDER BY " + info.pk.map(MYID).join(", ") : "";
	const [rows] = await my.query(`SELECT * FROM ${MYID(table)}${orderBy}`);
	return rows;
}

export async function readPgTable(client, table, info) {
	const orderBy = info.pk.length ? " ORDER BY " + info.pk.map(IDENT).join(", ") : "";
	// jsonb is read back as raw text (not parsed by the driver) so a JSON scalar / JSON null is distinguishable from SQL NULL
	const select = info.columns.map((c) => (info.kinds && info.kinds[c] === "jsonb" ? `${IDENT(c)}::text AS ${IDENT(c)}` : IDENT(c))).join(", ");
	return (await client.query(`SELECT ${select} FROM ${IDENT(table)}${orderBy}`)).rows;
}

// ---- backup verification ---------------------------------------------------------------------------------------
export function verifyLatestBackup(dir) {
	if (!fs.existsSync(dir)) return { ok: false, reason: `backup folder not found: ${dir}` };
	const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
	if (!files.length) return { ok: false, reason: "no .sql backup found" };
	const results = files.map(({ f }) => {
		const full = path.join(dir, f);
		const shaFile = full + ".sha256";
		if (!fs.existsSync(shaFile)) return { file: f, ok: false, reason: "no .sha256 file" };
		const found = /[0-9a-f]{64}/i.exec(fs.readFileSync(shaFile, "utf8")); // the file may read "sha256 <hash>" or "<hash>  <name>"
		if (!found) return { file: f, ok: false, reason: "no SHA-256 value in the .sha256 file" };
		const expected = found[0].toLowerCase();
		const actual = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
		return { file: f, ok: expected === actual, bytes: fs.statSync(full).size, sha256: actual };
	});
	return { ok: results.every((r) => r.ok), results };
}

// fingerprint of the MySQL SOURCE used to prove it was not modified: schema, migration history and row counts
export async function mysqlFingerprint(my, schema) {
	const counts = {};
	for (const t of Object.keys(schema.tables)) counts[t] = Number((await my.query(`SELECT COUNT(*) AS n FROM ${MYID(t)}`))[0][0].n);
	const schemaText = JSON.stringify([schema.tables, schema.fks]);
	const [meta] = await my.query(`SELECT name FROM ${MYID(MYSQL_META_TABLE)} ORDER BY name`);
	const [idx] = await my.query("select table_name, index_name, seq_in_index, column_name, non_unique from information_schema.statistics where table_schema = database() order by 1,2,3");
	return {
		tableCount: Object.keys(schema.tables).length,
		counts,
		totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
		schemaSha256: createHash("sha256").update(schemaText + JSON.stringify(idx)).digest("hex"),
		migrationHistorySha256: createHash("sha256").update(meta.map((r) => r.name || r.NAME).join("\n")).digest("hex"),
		migrationHistoryCount: meta.length,
	};
}

// statements this MySQL session ever ran that could modify data or schema (must all be zero)
export async function mysqlSessionWriteCounters(my) {
	const names = ["Com_insert", "Com_update", "Com_delete", "Com_replace", "Com_truncate", "Com_create_table", "Com_alter_table", "Com_drop_table", "Com_rename_table", "Com_create_index", "Com_drop_index", "Com_create_db", "Com_drop_db", "Com_load", "Com_insert_select", "Com_update_multi", "Com_delete_multi", "Com_call_procedure", "Com_create_trigger", "Com_create_user", "Com_grant"];
	const [rows] = await my.query("SHOW SESSION STATUS WHERE Variable_name LIKE 'Com\\_%'");
	const map = Object.fromEntries(rows.map((r) => [r.Variable_name, Number(r.Value)]));
	const out = {};
	for (const n of names) if (n in map) out[n] = map[n];
	return out;
}
