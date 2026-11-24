// Phase 7H: read-only response-time comparison, PostgreSQL test instance (3001) vs read-only MySQL instance (3002).
// Same code, same mode (next dev), same real fixture users, requests ALTERNATE between the two servers so both see the same
// machine conditions. GET requests only. Low volume (no stress test): N timed requests per endpoint after a warm-up.
//
//   node tests/e2e-pg/perf-compare.mjs <state.json> <fixtures.json> <secretPg> <secretMy> <logMy> <out.json> [N]
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const [, , stateFile, fxFile, secretPg, secretMy, logMy, outFile, nArg] = process.argv;
const N = nArg === undefined ? 30 : Number(nArg);
const pgLog = process.argv[9]; // optional: file written by server-preload.cjs (E2E_PG_QUERY_LOG)
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const fx = JSON.parse(fs.readFileSync(fxFile, "utf8"));
const side = { pg: { port: 3001, secret: secretPg }, my: { port: 3002, secret: secretMy } };
const mon = new pg.Client({ host: "localhost", database: "sharpstudy_dev", user: "sharpstudy_dev", options: `-c default_transaction_read_only=on` });
await mon.connect();

const tok = (s, u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, side[s].secret, { expiresIn: "30m" });
const headersFor = (s, u, page) => (!u ? {} : page ? { Cookie: `edmy_users_token=${tok(s, u)}` } : { authorization: tok(s, u) });
async function once(s, e) {
	const t0 = performance.now();
	const r = await fetch(`http://localhost:${side[s].port}${e.path}`, { headers: headersFor(s, e.user, e.page), redirect: "manual" });
	const firstByte = performance.now() - t0;
	await r.arrayBuffer();
	return { status: r.status, ms: performance.now() - t0, ttfb: firstByte };
}
const pct = (arr, p) => {
	const a = [...arr].sort((x, y) => x - y);
	return a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
};
const stats = (arr) => ({ avg: arr.reduce((x, y) => x + y, 0) / arr.length, median: pct(arr, 50), p95: pct(arr, 95), min: Math.min(...arr), max: Math.max(...arr) });
const f = (n) => n.toFixed(1);

const E = [
	["login lookup (token -> account + profile)", "/api/users/update/", fx.student],
	["student: my courses", "/api/learnings/", fx.student],
	["student: purchase history", "/api/learnings/my-purchases/", fx.student],
	["course listing", "/api/all-courses/", fx.student],
	["course details", `/api/courses/course/?slug=${fx.courseSlug}`, fx.student],
	["mastery overview (learners)", "/api/mastery/learners/", fx.student],
	["notifications", "/api/notifications/", fx.student],
	["instructor dashboard", "/api/instructor/dashboard/", fx.instructor],
	["instructor student directory", "/api/instructor/students/", fx.instructor],
	["admin: courses", "/api/admin/courses/", fx.admin],
	["admin: meeting list", "/api/admin/meetings/", fx.admin],
	["admin: books", "/api/admin/books/", fx.admin],
	["page: home (SSR)", "/", null, true],
	["page: student dashboard (SSR)", "/learning/my-courses/", fx.student, true],
	["page: instructor dashboard (SSR)", "/instructor/dashboard/", fx.instructor, true],
	["page: admin home (SSR)", "/admin/", fx.admin, true],
].map(([label, path, user, page]) => ({ label, path, user, page: !!page }));

// database round-trips per request: PostgreSQL = delta of committed transactions (each autocommit statement is one), MySQL = SQL lines the
// instance logged for that request. Approximate; measured on a separate pass of 3 requests per endpoint.
const pgTx = async () => {
	await new Promise((r) => setTimeout(r, 1300));
	return Number((await mon.query("select xact_commit + xact_rollback as n from pg_stat_database where datname = 'sharpstudy_dev'")).rows[0].n);
};
const myLines = () => (fs.readFileSync(logMy, "utf8").match(/Executing \(default\):/g) || []).length;

const pgLines = () => (pgLog && fs.existsSync(pgLog) ? fs.readFileSync(pgLog, "utf8").split("\n").filter(Boolean).length : null);
const out = [];
for (const e of E) {
	// warm-up (dev mode compiles on first use)
	for (let i = 0; i < 3; i++) {
		await once("pg", e);
		await once("my", e);
	}
	const res = { pg: [], my: [] };
	const st = { pg: new Set(), my: new Set() };
	for (let i = 0; i < N; i++) {
		for (const s of i % 2 ? ["my", "pg"] : ["pg", "my"]) {
			const r = await once(s, e);
			res[s].push(r.ms);
			st[s].add(r.status);
		}
	}
	// query counts
	const qc = { pg: 0, my: 0 };
	if (pgLines() !== null) {
		const p0 = pgLines();
		for (let i = 0; i < 3; i++) await once("pg", e);
		qc.pg = (pgLines() - p0) / 3;
	} else {
		const c0 = await pgTx();
		for (let i = 0; i < 3; i++) await once("pg", e);
		qc.pg = (await pgTx() - c0) / 3;
	}
	const l0 = myLines();
	for (let i = 0; i < 3; i++) await once("my", e);
	qc.my = (myLines() - l0) / 3;
	const row = { label: e.label, path: e.path, n: N, status: { pg: [...st.pg].join("/"), my: [...st.my].join("/") }, pg: N ? stats(res.pg) : null, my: N ? stats(res.my) : null, queries: qc };
	out.push(row);
	if (!N) {
		console.log(`${e.label.padEnd(44)} db queries per request: PostgreSQL ${qc.pg.toFixed(1)} | MySQL ${qc.my.toFixed(1)}`);
		continue;
	}
	console.log(`${e.label.padEnd(44)} HTTP ${row.status.pg.padEnd(4)}/${row.status.my.padEnd(4)}  PG avg ${f(row.pg.avg).padStart(7)} med ${f(row.pg.median).padStart(7)} p95 ${f(row.pg.p95).padStart(7)} | MySQL avg ${f(row.my.avg).padStart(7)} med ${f(row.my.median).padStart(7)} p95 ${f(row.my.p95).padStart(7)} | db queries/request PG ~${qc.pg.toFixed(1)} MySQL ${qc.my.toFixed(1)}`);
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
await mon.end();
