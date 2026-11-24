// Creates the ISOLATED PostgreSQL test schema used by the Phase 7 application regression tests, and removes it again.
//
//   node tests/e2e-pg/provision.mjs create <state.json>     schema + copy of the migrated data + dedicated test accounts
//   node tests/e2e-pg/provision.mjs drop   <state.json>     drops ONLY the schema recorded in the state file
//
// Safety:
//   * everything is written to a NEW schema ss_e2e_<random>; the real `public` schema is only ever READ (INSERT ... SELECT source);
//   * the application / test processes are pinned to the new schema with PG_SEARCH_PATH (database/config/config.mjs), `public`
//     is not on their search path, so a table missing from the test schema is an error, never a silent fallback to real data;
//   * `drop` refuses anything that is not a schema recorded by `create` in the state file;
//   * the test accounts exist only inside the test schema; real accounts are never touched.
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import bcrypt from "bcrypt";

export const TEST_PASSWORD = "Phase7-Test-Pass-1!";
const [, , action, stateFile] = process.argv;

const connect = async () => {
	const c = new pg.Client({
		host: process.env.PG_HOST || "localhost",
		port: Number(process.env.PG_PORT) || 5432,
		database: process.env.PG_DATABASE || "sharpstudy_dev",
		user: process.env.PG_USER || "sharpstudy_dev",
		...(process.env.PG_PASSWORD ? { password: process.env.PG_PASSWORD } : {}),
	});
	await c.connect();
	return c;
};

async function create() {
	if (!stateFile) throw new Error("state file path required");
	if (fs.existsSync(stateFile)) throw new Error("state file already exists: a previous run was not torn down (run drop first)");
	const c = await connect();
	const schema = "ss_e2e_" + randomBytes(5).toString("hex");
	try {
		// refuse to start when another test schema exists (it may belong to a running test)
		const other = await c.query("select nspname from pg_namespace where starts_with(nspname, 'ss_e2e_')");
		if (other.rows.length) throw new Error(`test schema(s) already exist: ${other.rows.map((r) => r.nspname).join(", ")}`);
		await c.query("SET default_transaction_read_only = off");
		await c.query(`create schema "${schema}"`);
		fs.writeFileSync(stateFile, JSON.stringify({ schema, createdAt: new Date().toISOString() }), { flag: "wx" });

		// 1. empty copy of the real schema (same SQL the migrations run), plus the e-mail index
		await c.query(`set search_path to "${schema}"`);
		const dir = "database/migrations-pg/sql/";
		for (const f of ["001_tables.sql", "002_indexes.sql", "003_foreign_keys.sql"]) await c.query(fs.readFileSync(dir + f, "utf8"));
		await c.query('create unique index "uq_users_email_lower" on "users" (lower("email"))');
		await c.query("set search_path to public");

		// 2. copy the migrated data INTO the test schema, parents first (public is only read)
		const tables = (await c.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name not in ('sequelizemeta','mysql_migration_history')")).rows.map((r) => r.table_name);
		const fks = (await c.query("select c.relname as t, r.relname as rt from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class r on r.oid = k.confrelid where k.contype = 'f' and k.connamespace = 'public'::regnamespace")).rows;
		const deps = new Map(tables.map((t) => [t, new Set(fks.filter((f) => f.t === t && f.rt !== t).map((f) => f.rt))]));
		const order = [];
		const done = new Set();
		while (order.length < tables.length) {
			const next = tables.filter((t) => !done.has(t) && [...deps.get(t)].every((d) => done.has(d)));
			if (!next.length) throw new Error("circular dependencies between tables");
			for (const t of next.sort()) {
				order.push(t);
				done.add(t);
			}
		}
		let copied = 0;
		await c.query("BEGIN");
		for (const t of order) copied += (await c.query(`insert into "${schema}"."${t}" select * from public."${t}"`)).rowCount;
		await c.query("COMMIT");

		// 3. dedicated test accounts (exist only in the test schema)
		const hash = await bcrypt.hash(TEST_PASSWORD, 4);
		const users = [
			["student", "E2E", "Student", "e2e.student@example.test", "student", true, true],
			["instructor", "E2E", "Instructor", "e2e.instructor@example.test", "instructor", true, true],
			["admin", "E2E", "Admin", "e2e.admin@example.test", "admin", true, true],
			["disabled", "E2E", "Disabled", "e2e.disabled@example.test", "student", true, false],
			["unconfirmed", "E2E", "Unconfirmed", "e2e.unconfirmed@example.test", "student", false, true],
			["other_student", "E2E", "Other", "e2e.other@example.test", "student", true, true],
			["child", "E2E", "Child", "e2e.child@example.test", "student", true, true],
			["parent_a", "E2E", "ParentA", "e2e.parent-a@example.test", "student", true, true],
			["parent_b", "E2E", "ParentB", "e2e.parent-b@example.test", "student", true, true],
		];
		const ids = {};
		for (const [key, first, last, email, role, confirmed, active] of users) {
			const r = await c.query(
				`insert into "${schema}"."users" (id, first_name, last_name, email, password, role, email_confirmed, status) values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7) returning id`,
				[first, last, email, hash, role, confirmed, active]
			);
			ids[key] = r.rows[0].id;
		}
		const rows = Object.fromEntries((await c.query(`select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int as n from information_schema.tables where table_schema = '${schema}' and table_type = 'BASE TABLE'`)).rows.map((r) => [r.table_name, r.n]));
		const state = { schema, createdAt: new Date().toISOString(), copiedRows: copied, testUsers: ids, testEmails: Object.fromEntries(users.map((u) => [u[0], u[3]])), tables: Object.keys(rows).length, rowsInSchema: Object.values(rows).reduce((a, b) => a + b, 0) };
		fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
		console.log(`test schema ${schema} created: ${state.tables} tables, ${copied} rows copied from public, ${users.length} dedicated test accounts added (total rows ${state.rowsInSchema})`);
	} catch (e) {
		await c.query("ROLLBACK").catch(() => {});
		if (fs.existsSync(stateFile)) await c.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
		if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
		throw e;
	} finally {
		await c.end();
	}
}

async function drop() {
	if (!stateFile || !fs.existsSync(stateFile)) throw new Error("state file not found: nothing recorded to drop");
	const { schema } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
	if (!/^ss_e2e_[0-9a-f]{10}$/.test(schema)) throw new Error("refusing to drop a schema that is not a recorded test schema");
	const c = await connect();
	try {
		await c.query(`drop schema "${schema}" cascade`);
		fs.unlinkSync(stateFile);
		const left = (await c.query("select nspname from pg_namespace where starts_with(nspname, 'ss_e2e_')")).rows.length;
		console.log(`test schema ${schema} dropped; remaining ss_e2e_ schemas: ${left}`);
	} finally {
		await c.end();
	}
}

if (action === "create") await create();
else if (action === "drop") await drop();
else if (action) {
	console.error("usage: provision.mjs create|drop <state.json>");
	process.exitCode = 2;
}
