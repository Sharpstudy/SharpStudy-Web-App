// Creates a THROW-AWAY PostgreSQL schema containing the real application schema, so integration tests can write
// real rows without ever touching the `public` schema (which stays empty until the data migration).
//
//   * the schema is built from the same SQL files the migrations execute (+ the e-mail unique index migration),
//   * the application connection is pointed at it with PG_SEARCH_PATH (database/config/config.mjs), `public` is NOT on its path,
//   * it is dropped afterwards; any leftovers of an earlier crashed run (ss_test_*) are removed first.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { pathToFileURL } from "node:url";

const sqlDir = path.join(process.cwd(), "database", "migrations-pg", "sql");

const settings = () => ({
	host: process.env.PG_HOST || "localhost",
	port: Number(process.env.PG_PORT) || 5432,
	database: process.env.PG_DATABASE || "sharpstudy_dev",
	user: process.env.PG_USER || "sharpstudy_dev",
	...(process.env.PG_PASSWORD ? { password: process.env.PG_PASSWORD } : {}), // otherwise pgpass.conf
	connectionTimeoutMillis: 4000,
});

export async function pgReachable() {
	const c = new pg.Client(settings());
	try {
		await c.connect();
		await c.query("select 1");
		return true;
	} catch {
		return false;
	} finally {
		await c.end().catch(() => {});
	}
}

export async function createTestSchema() {
	const c = new pg.Client(settings());
	await c.connect();
	try {
		// remove leftovers of crashed runs (only schemas with our prefix)
		const old = await c.query("select nspname from pg_namespace where starts_with(nspname, 'ss_test_')");
		for (const r of old.rows) await c.query(`drop schema "${r.nspname}" cascade`);
		const name = "ss_test_" + randomBytes(5).toString("hex");
		await c.query(`create schema "${name}"`);
		await c.query(`set search_path to "${name}"`);
		for (const f of ["001_tables.sql", "002_indexes.sql", "003_foreign_keys.sql"]) await c.query(fs.readFileSync(path.join(sqlDir, f), "utf8"));
		await c.query('create unique index "uq_users_email_lower" on "users" (lower("email"))'); // migration 20261101000004
		// migration 20261123000006 (Free Demo columns on meeting_requests): run the REAL migration against this schema, so the tests also prove it applies
		const free = (await import(pathToFileURL(path.join(process.cwd(), "database", "migrations-pg", "20261123000006-pg-meeting-requests-free-demo.js")).href)).default;
		await free.up({ sequelize: { getDialect: () => "postgres", transaction: async (fn) => fn(undefined), query: async (sql) => [(await c.query(sql)).rows] } });
		return name;
	} finally {
		await c.end();
	}
}

export async function dropTestSchema(name) {
	if (!/^ss_test_[0-9a-f]{10}$/.test(name)) throw new Error("refusing to drop a schema that is not a test schema");
	const c = new pg.Client(settings());
	await c.connect();
	try {
		await c.query(`drop schema "${name}" cascade`);
	} finally {
		await c.end();
	}
}

// Row counts of every table in `public` (must stay 0 while the data migration has not been run).
export async function publicRowTotal() {
	const c = new pg.Client(settings());
	await c.connect();
	try {
		const t = await c.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'sequelizemeta'");
		let total = 0;
		for (const r of t.rows) total += Number((await c.query(`select count(*) n from public."${r.table_name}"`)).rows[0].n);
		return { tables: t.rows.length, rows: total };
	} finally {
		await c.end();
	}
}
