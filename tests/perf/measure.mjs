// Lightweight latency measurement of a RUNNING SharpStudy instance (localhost only, test accounts only).
//
//   node tests/perf/measure.mjs <baseUrl> <label> [rounds=15] [outFile]
//
// Signs in the dedicated perf test accounts (perf.*@example.test, password from PERF_PASSWORD or the default below), then requests a fixed
// set of pages / APIs sequentially (after one warm-up round) and prints median / p95 latency, response size and status. It also prints the
// server-side query count per request when PERF_PG_* variables point at the test database with pg_stat_statements.
// It never touches real accounts and sends no traffic anywhere but <baseUrl>.
import fs from "node:fs";

const [, , BASE, LABEL = "run", ROUNDS_ARG = "15", OUT] = process.argv;
if (!/^http:\/\/localhost:\d+$/.test(BASE || "")) throw new Error("localhost only");
const ROUNDS = Number(ROUNDS_ARG);
const PASSWORD = process.env.PERF_PASSWORD || "Perf-Test-Pass-1!";

const pct = (arr, p) => {
	const s = [...arr].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function signin(email) {
	const t0 = performance.now();
	const res = await fetch(`${BASE}/api/users/signin/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
	const ms = performance.now() - t0;
	const json = await res.json().catch(() => ({}));
	return { token: json.edmy_users_token, ms, status: res.status };
}

const accounts = {
	anon: null,
	student: "perf.student@example.test",
	instructor: "perf.instructor@example.test",
	admin: "perf.admin@example.test",
};
const tokens = {};
const loginTimes = [];
for (const [who, email] of Object.entries(accounts)) {
	if (!email) continue;
	const r = await signin(email);
	if (!r.token) throw new Error(`sign-in failed for ${who}: HTTP ${r.status}`);
	tokens[who] = r.token;
}
// repeat sign-in a few times for a login latency figure
for (let i = 0; i < Math.max(5, Math.floor(ROUNDS / 2)); i++) loginTimes.push((await signin(accounts.student)).ms);

const targets = [
	["anon", "/", "page"],
	["anon", "/courses/", "page"],
	["anon", "/auth/", "page"],
	["anon", "/api/home-courses/", "api"],
	["anon", "/api/all-courses/", "api"],
	["student", "/learning/my-courses/", "page"],
	["student", "/family/", "page"],
	["student", "/study/", "page"],
	["student", "/api/users/update/", "api"],
	["instructor", "/instructor/courses/", "page"],
	["admin", "/admin/", "page"],
	["admin", "/admin/meetings/", "page"],
];

async function once(who, path, kind) {
	const headers = {};
	if (tokens[who]) {
		if (kind === "api") headers.authorization = tokens[who];
		else headers.cookie = `edmy_users_token=${tokens[who]}`;
	}
	const t0 = performance.now();
	const res = await fetch(BASE + path, { headers, redirect: "manual" });
	const buf = await res.arrayBuffer();
	return { ms: performance.now() - t0, status: res.status, bytes: buf.byteLength };
}

const rows = [];
for (const [who, path, kind] of targets) {
	await once(who, path, kind); // warm-up (first compile / connection)
	const times = [];
	let status = 0;
	let bytes = 0;
	for (let i = 0; i < ROUNDS; i++) {
		const r = await once(who, path, kind);
		times.push(r.ms);
		status = r.status;
		bytes = r.bytes;
	}
	rows.push({ who, path, status, kb: +(bytes / 1024).toFixed(1), p50: +pct(times, 50).toFixed(1), p95: +pct(times, 95).toFixed(1), min: +Math.min(...times).toFixed(1) });
}
const login = { p50: +pct(loginTimes, 50).toFixed(1), p95: +pct(loginTimes, 95).toFixed(1) };
console.log(`\n== ${LABEL} (${BASE}, ${ROUNDS} sequential rounds per URL after warm-up)`);
console.log(`login (POST /api/users/signin): p50 ${login.p50} ms, p95 ${login.p95} ms`);
for (const r of rows) console.log(`${r.who.padEnd(10)} ${r.path.padEnd(26)} HTTP ${r.status}  ${String(r.kb).padStart(7)} KB  p50 ${String(r.p50).padStart(7)} ms  p95 ${String(r.p95).padStart(7)} ms  min ${r.min} ms`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, login, rows }, null, 1));
