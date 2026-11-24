// Runs the EXISTING end-to-end scripts (tests/e2e/*.mjs), unchanged, against the PostgreSQL test instance.
//
//   node tests/e2e-pg/run-e2e.mjs <state.json> <baseUrl> <jwtSecret> [script-name ...]
//
// Their `mysql2/promise` import is redirected to the PostgreSQL shim (tests/e2e-pg/hooks.mjs) which only talks to the isolated
// test schema; the MySQL variables handed to them are dummies, so even a bypass of the shim could not reach MySQL.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const [, , stateFile, baseUrl, jwtSecret, ...only] = process.argv;
const { schema } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const root = process.cwd();
const register = pathToFileURL(path.join(root, "tests", "e2e-pg", "register.mjs")).href;
const scripts = fs.readdirSync(path.join(root, "tests", "e2e")).filter((f) => f.endsWith(".mjs")).sort().filter((f) => !only.length || only.some((o) => f.includes(o)));

const env = {
	...process.env,
	E2E_BASE_URL: baseUrl,
	JWT_SECRET: jwtSecret,
	PG_SEARCH_PATH: schema,
	DB_HOSTNAME: "localhost",
	DB_PORT: "3306",
	DB_USERNAME: "unused-by-the-postgresql-test",
	DB_PASSWORD: "unused-by-the-postgresql-test",
	DB_NAME_DEVELOPMENT: "sharpstudy_dev",
	E2E_ALLOW_DB_WRITES: "sharpstudy_dev",
	NODE_ENV: "test",
};
delete env.DB_DIALECT;

const run = (file, args = []) =>
	new Promise((resolve) => {
		const t0 = Date.now();
		const child = spawn(process.execPath, ["--no-warnings", "--import", register, path.join("tests", "e2e", file), ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		const timer = setTimeout(() => child.kill(), 240000);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ file, code, ms: Date.now() - t0, out });
		});
	});

const results = [];
for (const f of scripts) {
	const r = await run(f);
	results.push(r);
	const tail = r.out.trim().split(/\r?\n/).slice(-4).join(" | ").slice(0, 300);
	console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${f.padEnd(34)} exit ${r.code}  ${(r.ms / 1000).toFixed(1)}s  ${tail}`);
	fs.writeFileSync(path.join(path.dirname(stateFile), `e2e-${f}.log`), r.out);
}
console.log(`\n${results.filter((r) => r.code === 0).length} of ${results.length} scripts exited 0`);
process.exitCode = results.every((r) => r.code === 0) ? 0 : 1;
