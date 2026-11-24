// Query count per request: resets pg_stat_statements on the TEST database, performs one request, prints how many statements ran.
//   node tests/perf/qcount.mjs <baseUrl> <stateDir> [label]      (stateDir holds pw.txt and certs/ca.crt of the throw-away cluster)
import fs from "node:fs"; import pg from "pg";
const [, , BASE, T, LABEL = "queries"] = process.argv;
if (!/^http:\/\/localhost:\d+$/.test(BASE || "")) throw new Error("localhost only");
const db = new pg.Client({ host: "localhost", port: 55432, database: "ss_perf", user: "tlsadmin", password: fs.readFileSync(T + "/pw.txt", "utf8").trim(), ssl: { ca: fs.readFileSync(T + "/certs/ca.crt", "utf8") } });
await db.connect();
const login = async (e) => (await (await fetch(BASE + "/api/users/signin/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: e, password: "Perf-Test-Pass-1!" }) })).json()).edmy_users_token;
const tok = { student: await login("perf.student@example.test"), instructor: await login("perf.instructor@example.test"), admin: await login("perf.admin@example.test") };
const targets = [["anon", "/", "page"], ["anon", "/courses/", "page"], ["anon", "/api/home-courses/", "api"], ["student", "/learning/my-courses/", "page"], ["student", "/family/", "page"], ["student", "/study/", "page"], ["student", "/api/users/update/", "api"], ["instructor", "/instructor/courses/", "page"], ["admin", "/admin/", "page"]];
console.log(`== ${LABEL}: database statements per request (one request each, after warm-up)`);
for (const [who, path, kind] of targets) {
	const h = {}; if (tok[who]) kind === "api" ? (h.authorization = tok[who]) : (h.cookie = `edmy_users_token=${tok[who]}`);
	await fetch(BASE + path, { headers: h, redirect: "manual" }).then((r) => r.arrayBuffer());
	await db.query("select pg_stat_statements_reset()");
	await fetch(BASE + path, { headers: h, redirect: "manual" }).then((r) => r.arrayBuffer());
	await new Promise((r) => setTimeout(r, 300));
	const r = (await db.query("select coalesce(sum(calls),0)::int as n, coalesce(round(sum(total_exec_time)::numeric,1),0) as ms from pg_stat_statements where dbid=(select oid from pg_database where datname='ss_perf') and query not ilike '%pg_stat_statements%'")).rows[0];
	console.log(`${who.padEnd(10)} ${path.padEnd(26)} ${String(r.n).padStart(3)} statements, ${r.ms} ms total DB execution time`);
}
await db.end();
