// node tests/auth-db/schema.mjs create <state.json> | drop <state.json>. Creates an EMPTY throw-away schema (ss_authtest_<8 hex>) from the baseline SQL; never writes to `public`; drop refuses any other name.
import { createRequire } from "node:module";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
const require = createRequire(process.cwd() + "/package.json");
const pg = require("pg");
const [, , action, stateFile] = process.argv;
const c = new pg.Client({ host: process.env.PG_HOST || "localhost", port: Number(process.env.PG_PORT) || 5432, database: process.env.PG_DATABASE || "sharpstudy_dev", user: process.env.PG_USER || "sharpstudy_dev", connectionTimeoutMillis: 15000, ...(process.env.PG_PASSWORD ? { password: process.env.PG_PASSWORD } : {}) });
await c.connect();
try {
  if (action === "create") {
    if (fs.existsSync(stateFile)) throw new Error("state file exists");
    const other = await c.query("select nspname from pg_namespace where starts_with(nspname,'ss_authtest_')");
    if (other.rows.length) throw new Error("test schema already exists: " + other.rows.map((r) => r.nspname));
    const schema = "ss_authtest_" + randomBytes(4).toString("hex");
    await c.query(`create schema "${schema}"`);
    fs.writeFileSync(stateFile, JSON.stringify({ schema }), { flag: "wx" });
    await c.query(`set search_path to "${schema}"`);
    for (const f of ["001_tables.sql", "002_indexes.sql", "003_foreign_keys.sql"]) await c.query(fs.readFileSync("database/migrations-pg/sql/" + f, "utf8"));
    await c.query('create unique index "uq_users_email_lower" on "users" (lower("email"))');
    const t = await c.query("select count(*)::int n from information_schema.tables where table_schema=$1", [schema]);
    console.log("created", schema, "with", t.rows[0].n, "tables (empty)");
  } else if (action === "drop") {
    const { schema } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (!/^ss_authtest_[0-9a-f]{8}$/.test(schema)) throw new Error("refusing to drop " + schema);
    await c.query(`drop schema "${schema}" cascade`);
    fs.unlinkSync(stateFile);
    console.log("dropped", schema);
  }
} catch (e) { console.log("ERR", e.message); process.exitCode = 1; } finally { await c.end(); }
