// DEVELOPMENT-ONLY: mark ONE test account's e-mail as confirmed, for environments with no e-mail service (no SES).
//
//   node scripts/dev/verify-test-account.mjs <email>          dry run: shows what it would change, changes nothing
//   node scripts/dev/verify-test-account.mjs <email> --yes    applies it
//
// What it does: sets users.email_confirmed = true and fills users.email_confirmed_at (if empty) for that ONE account. That is exactly what
// the confirmation link does (pages/api/users/confirm-email.js) and exactly the field sign-in checks (lib/auth/signinGuard.js); the
// confirmation token is not needed to sign in.
// What it never does: touch the password, the role, the status, the confirmation token, any telecaller application or profile (so it
// cannot approve anyone), or any other account. It prints no password hash and no token.
// Safety: refuses unless NODE_ENV is not "production", the database host is local, the database name ends in _dev or _test, and exactly
// one account matches. It does not read .env; connection settings are the same PG_* variables / pgpass the app uses (database/config/config.mjs).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const pg = require("pg");

const [, , emailArg, flag] = process.argv;
const die = (m) => {
	console.error("refusing: " + m);
	process.exit(1);
};
if (!emailArg || emailArg.startsWith("--")) die("usage: node scripts/dev/verify-test-account.mjs <email> [--yes]");
if (flag && flag !== "--yes") die(`unknown option ${flag}`);
if (process.env.NODE_ENV === "production") die("NODE_ENV is production");

const host = process.env.PG_HOST || "localhost";
const database = process.env.PG_DATABASE || "sharpstudy_dev";
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) die(`database host "${host}" is not local`);
if (!/(_dev|_test)$/.test(database)) die(`database "${database}" does not end in _dev or _test`);

const c = new pg.Client({ host, port: Number(process.env.PG_PORT) || 5432, database, user: process.env.PG_USER || "sharpstudy_dev", connectionTimeoutMillis: 15000, ...(process.env.PG_PASSWORD ? { password: process.env.PG_PASSWORD } : {}) });
await c.connect();
try {
	const email = emailArg.trim().toLowerCase();
	const found = (await c.query("select id, first_name, last_name, email, role, status, email_confirmed, email_confirmed_at from users where lower(email) = $1", [email])).rows;
	if (found.length !== 1) die(`${found.length} accounts match that e-mail (need exactly 1)`);
	const u = found[0];
	console.log(`database ${database}@${host}`);
	console.log(`account  ${u.id}  ${u.first_name} ${u.last_name} <${u.email}>  role=${u.role}  status=${u.status}`);
	console.log(`before   email_confirmed=${u.email_confirmed}  email_confirmed_at=${u.email_confirmed_at ? u.email_confirmed_at.toISOString() : "null"}`);
	if (u.email_confirmed === true && u.email_confirmed_at) {
		console.log("nothing to do: already confirmed.");
	} else if (flag !== "--yes") {
		console.log("DRY RUN: would set email_confirmed=true" + (u.email_confirmed_at ? "" : " and email_confirmed_at=now()") + ". Run again with --yes to apply.");
	} else {
		await c.query("begin");
		const r = await c.query("update users set email_confirmed = true, email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1", [u.id]);
		if (r.rowCount !== 1) {
			await c.query("rollback");
			die("unexpected row count; rolled back");
		}
		await c.query("commit");
		const a = (await c.query("select role, status, email_confirmed, email_confirmed_at from users where id = $1", [u.id])).rows[0];
		console.log(`after    email_confirmed=${a.email_confirmed}  email_confirmed_at=${a.email_confirmed_at.toISOString()}  role=${a.role} (unchanged)  status=${a.status} (unchanged)`);
	}
	const t = (await c.query("select (select count(*) from telecaller_applications where user_id = $1)::int as apps, (select count(*) from telecaller_profiles where user_id = $1)::int as profiles", [u.id])).rows[0];
	console.log(`telecaller records for this account: ${t.apps} application(s), ${t.profiles} profile(s)  (this tool never creates or changes them)`);
} finally {
	await c.end();
}
