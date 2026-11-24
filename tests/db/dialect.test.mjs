// Dialect selection for database/connection.js: MySQL must stay the default, PostgreSQL is opt-in,
// and PostgreSQL credentials must never be hard-coded. No database connection is opened here.
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const connectionUrl = (n) => pathToFileURL(path.join(root, "database", "connection.js")).href + `?case=${n}`;
const configUrl = pathToFileURL(path.join(root, "database", "config", "config.mjs")).href;

const KEYS = ["DB_DIALECT", "NODE_ENV", "PG_HOST", "PG_PORT", "PG_DATABASE", "PG_USER", "PG_PASSWORD", "PG_HOST_PROD", "PG_DATABASE_PROD", "PG_USER_PROD", "PG_PASSWORD_PROD"];
let n = 0;
async function load(env) {
	const saved = {};
	for (const k of KEYS) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
	Object.assign(process.env, env);
	try {
		return (await import(connectionUrl(++n))).default;
	} finally {
		for (const k of KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	}
}

// config.mjs reads process.env once per process, so env-dependent cases run in a fresh node process.
function inChild(env) {
	const clean = { ...process.env };
	for (const k of KEYS) delete clean[k];
	const code = `import c from ${JSON.stringify(connectionUrl("child"))}; console.log(JSON.stringify({ dialect: c.getDialect(), host: c.config.host, port: Number(c.config.port), database: c.config.database, username: c.config.username, password: c.config.password, tz: c.options.timezone }));`;
	const r = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", code], { env: { ...clean, ...env }, encoding: "utf8" });
	assert.equal(r.status, 0, r.stderr);
	return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
}

test("MySQL is the default when DB_DIALECT is not set", async () => {
	const c = await load({});
	assert.equal(c.getDialect(), "mysql");
});

test("DB_DIALECT=mysql (any case, with spaces) selects MySQL", async () => {
	assert.equal((await load({ DB_DIALECT: " MySQL " })).getDialect(), "mysql");
});

test("DB_DIALECT=postgres selects PostgreSQL, in UTC, with the development defaults", async () => {
	const c = await load({ DB_DIALECT: "postgres" });
	assert.equal(c.getDialect(), "postgres");
	assert.equal(c.config.host, "localhost");
	assert.equal(Number(c.config.port), 5432);
	assert.equal(c.config.database, "sharpstudy_dev");
	assert.equal(c.options.timezone, "+00:00");
});

test("PostgreSQL host, port, database and user come from the environment", () => {
	const c = inChild({ DB_DIALECT: "postgres", PG_HOST: "db.example.test", PG_PORT: "6543", PG_DATABASE: "other_db", PG_USER: "other_user" });
	assert.equal(c.dialect, "postgres");
	assert.equal(c.host, "db.example.test");
	assert.equal(c.port, 6543);
	assert.equal(c.database, "other_db");
	assert.equal(c.username, "other_user");
	assert.ok(c.password == null, "no password may be configured so that pgpass.conf is used");
});

test("without PG_PASSWORD no password key is configured, so the driver falls back to pgpass.conf", async () => {
	const dev = (await import(configUrl)).default.postgres_development;
	assert.equal(Object.prototype.hasOwnProperty.call(dev, "password"), false);
});

test("PG_PASSWORD, when provided, is passed through (never defaulted)", () => {
	assert.equal(inChild({ DB_DIALECT: "postgres", PG_PASSWORD: "from-env" }).password, "from-env");
});

test("unknown dialects are rejected instead of silently using MySQL", async () => {
	await assert.rejects(() => load({ DB_DIALECT: "oracle" }), /Unsupported DB_DIALECT/);
});

test("the MySQL configuration blocks are unchanged", async () => {
	const cfg = (await import(configUrl)).default;
	assert.equal(cfg.development.dialect, "mysql");
	assert.equal(cfg.production.dialect, "mysql");
	assert.deepEqual(cfg.production.pool, { max: 2, min: 0, idle: 10000, acquire: 30000 });
	assert.equal(cfg.production.dialectOptions.ssl.rejectUnauthorized, true);
});

test("PostgreSQL production requires TLS and reads everything from the environment", async () => {
	const cfg = (await import(configUrl)).default.postgres_production;
	assert.equal(cfg.dialect, "postgres");
	assert.equal(cfg.dialectOptions.ssl.rejectUnauthorized, true);
	assert.equal(cfg.timezone, "+00:00");
});

test("no PostgreSQL password is written in the tracked configuration files", async () => {
	const fs = await import("node:fs");
	for (const f of ["database/config/config.mjs", "database/connection.js"]) {
		const src = fs.readFileSync(path.join(root, f), "utf8");
		assert.equal(/password\s*:\s*["'`][^"'`]+["'`]/.test(src), false, `${f} must not contain a literal password`);
	}
});
