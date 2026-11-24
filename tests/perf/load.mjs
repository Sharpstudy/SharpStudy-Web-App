// Staged, journey-based load test for a RUNNING SharpStudy instance. LOCAL / ISOLATED TEST INSTANCES ONLY (localhost), test accounts only.
// No payment, e-mail or enrolment-write endpoints are exercised (those would hit real third-party services).
//
//   node tests/perf/load.mjs <baseUrl> <label> <vus,vus,...> [secondsPerStage=30] [outFile]
//   env: PERF_SERVER_PID   process id of `next start`   (RSS is sampled every second)
//        PERF_PG_DIR       directory with pw.txt + certs/ca.crt of the throw-away PostgreSQL cluster (connections + load sampled)
//
// Every virtual user loops over one journey for the stage duration, with 1.5-4 s of think time between steps:
//   visitor 50%   /  ->  /courses/  ->  /api/all-courses/
//   student 38%   /learning/my-courses/ -> /api/users/update/ -> /study/ -> /family/
//   instructor 8% /instructor/courses/ -> /api/users/update/
//   admin 4%      /admin/ -> /admin/meetings/
// Sessions: by default each account signs in ONCE before the stage and its virtual users reuse that session (signed-in users mostly
// navigate; they do not log in again). PERF_LOGIN=1 makes every virtual user sign in itself at the start (a login storm).
// It reports requests/second, mean / p50 / p95 / p99 latency, error percentage (non-2xx/3xx or network failure or timeout), peak RSS and
// peak PostgreSQL connections. The load generator runs on the same machine, so results are a LOWER bound for the server.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import pg from "pg";

const [, , BASE, LABEL = "run", VUS = "50", SECONDS_ARG = "30", OUT] = process.argv;
if (!/^http:\/\/localhost:\d+$/.test(BASE || "")) throw new Error("load tests run against localhost test instances only");
const STAGES = VUS.split(",").map(Number);
const SECONDS = Number(SECONDS_ARG);
const PASSWORD = process.env.PERF_PASSWORD || "Perf-Test-Pass-1!";
const TIMEOUT_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const think = () => sleep(1500 + Math.random() * 2500);
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)] : 0);

const accounts = { student: "perf.student@example.test", instructor: "perf.instructor@example.test", admin: "perf.admin@example.test" };
const journeys = {
	visitor: [["", "/", "page"], ["", "/courses/", "page"], ["", "/api/all-courses/", "api"]],
	student: [["student", "/learning/my-courses/", "page"], ["student", "/api/users/update/", "api"], ["student", "/study/", "page"], ["student", "/family/", "page"]],
	instructor: [["instructor", "/instructor/courses/", "page"], ["instructor", "/api/users/update/", "api"]],
	admin: [["admin", "/admin/", "page"], ["admin", "/admin/meetings/", "page"]],
};
const pick = () => { const r = Math.random(); return r < 0.5 ? "visitor" : r < 0.88 ? "student" : r < 0.96 ? "instructor" : "admin"; };

let db = null;
if (process.env.PERF_PG_DIR) {
	const T = process.env.PERF_PG_DIR;
	db = new pg.Client({ host: "localhost", port: 55432, database: "ss_perf", user: "tlsadmin", password: fs.readFileSync(T + "/pw.txt", "utf8").trim(), ssl: { ca: fs.readFileSync(T + "/certs/ca.crt", "utf8") } });
	await db.connect();
}
const rssMb = () => {
	if (!process.env.PERF_SERVER_PID) return null;
	try {
		const out = execFileSync("tasklist", ["/FI", `PID eq ${process.env.PERF_SERVER_PID}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
		const m = out.match(/"([\d,]+) K"/);
		return m ? Math.round(Number(m[1].replace(/,/g, "")) / 1024) : null;
	} catch { return null; }
};

async function req(headers, path, sink) {
	const t0 = performance.now();
	let ok = false, status = 0;
	try {
		const res = await fetch(BASE + path, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
		await res.arrayBuffer();
		status = res.status;
		ok = status < 400;
	} catch { status = 0; }
	sink.lat.push(performance.now() - t0);
	sink.n++;
	if (!ok) { sink.err++; sink.codes[status] = (sink.codes[status] || 0) + 1; }
}

async function login(email, sink) {
	const t0 = performance.now();
	try {
		const res = await fetch(BASE + "/api/users/signin/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }), signal: AbortSignal.timeout(TIMEOUT_MS) });
		const j = await res.json();
		sink.login.push(performance.now() - t0);
		return j.edmy_users_token || null;
	} catch { sink.login.push(performance.now() - t0); sink.loginErr++; return null; }
}

const shared = {};
async function vu(stop, sink) {
	const kind = pick();
	await sleep(Math.random() * 5000); // ramp: spread the start over 5 s
	const tokens = {};
	for (const [who] of journeys[kind]) {
		if (!who || who in tokens) continue;
		if (process.env.PERF_LOGIN === "1") tokens[who] = await login(accounts[who], sink);
		else { shared[who] ??= await login(accounts[who], sink); tokens[who] = shared[who]; }
	}
	while (performance.now() < stop) {
		for (const [who, path, type] of journeys[kind]) {
			if (performance.now() >= stop) break;
			const headers = {};
			if (who && tokens[who]) type === "api" ? (headers.authorization = tokens[who]) : (headers.cookie = `edmy_users_token=${tokens[who]}`);
			await req(headers, path, sink);
			await think();
		}
	}
}

const results = [];
for (const vus of STAGES) {
	const sink = { lat: [], n: 0, err: 0, codes: {}, login: [], loginErr: 0 };
	const t0 = performance.now();
	const stop = t0 + SECONDS * 1000;
	let peakRss = 0, peakConn = 0, peakActive = 0;
	const sampler = setInterval(async () => {
		const r = rssMb(); if (r) peakRss = Math.max(peakRss, r);
		if (db) { try { const q = (await db.query("select count(*)::int as c, count(*) filter (where state='active')::int as a from pg_stat_activity where datname='ss_perf'")).rows[0]; peakConn = Math.max(peakConn, q.c); peakActive = Math.max(peakActive, q.a); } catch { /* ignore */ } }
	}, 1000);
	await Promise.all(Array.from({ length: vus }, () => vu(stop, sink)));
	clearInterval(sampler);
	const secs = (performance.now() - t0) / 1000;
	const lat = sink.lat.sort((a, b) => a - b);
	const login = sink.login.sort((a, b) => a - b);
	const row = {
		vus, seconds: +secs.toFixed(1), requests: sink.n, rps: +(sink.n / secs).toFixed(1),
		mean_ms: +(lat.reduce((s, x) => s + x, 0) / Math.max(1, lat.length)).toFixed(1), p50_ms: +pct(lat, 50).toFixed(1), p95_ms: +pct(lat, 95).toFixed(1), p99_ms: +pct(lat, 99).toFixed(1),
		error_pct: +((100 * sink.err) / Math.max(1, sink.n)).toFixed(2), error_codes: sink.codes, login_p50_ms: +pct(login, 50).toFixed(1), login_p95_ms: +pct(login, 95).toFixed(1), login_failures: sink.loginErr,
		peak_server_rss_mb: peakRss || null, peak_pg_connections: db ? peakConn : null, peak_pg_active: db ? peakActive : null,
	};
	results.push(row);
	console.log(JSON.stringify(row));
	await sleep(3000); // let the server settle between stages
}
if (db) await db.end();
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, base: BASE, stages: results }, null, 1));
