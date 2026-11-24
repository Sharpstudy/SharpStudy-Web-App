// Calls EVERY route under pages/api with each role (anonymous, student, instructor, admin) and with a valid-but-unknown id and a
// malformed id for the dynamic segments, and records the HTTP status and time of each call. Any HTTP 500 is a finding.
// The same sweep is run against the PostgreSQL test instance and the read-only MySQL instance, and the two are compared.
//
//   node tests/e2e-pg/api-sweep.mjs <baseUrl> <jwtSecret> <fixtures.json> <out.json> [method]
//
// Default method GET (reads only). Tokens are signed with the TEST secret of that server. Nothing is printed except
// route names and status codes (no tokens, no response bodies).
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";

const [, , baseUrl, secret, fixturesFile, outFile, method = "GET"] = process.argv;
const fx = JSON.parse(fs.readFileSync(fixturesFile, "utf8"));
const root = path.join(process.cwd(), "pages", "api");
const UNKNOWN = "11111111-2222-4333-8444-555555555555";
const MALFORMED = "not-a-uuid";

function* walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (/\.js$/.test(e.name)) yield p;
	}
}
const routes = [...walk(root)]
	.map((f) => "/" + path.relative(root, f).replace(/\\/g, "/").replace(/\.js$/, "").replace(/\/index$/, ""))
	.filter((r) => !/swagger\.json$/.test(r))
	.sort();

const token = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email, first_name: "T" }, secret, { expiresIn: "20m" });
const roles = { anonymous: null, student: fx.student, instructor: fx.instructor, admin: fx.admin };

const segmentValue = (seg, variant) => {
	if (variant === "malformed") return MALFORMED;
	if (variant === "unknown") return UNKNOWN;
	// "real": a value that exists in the data, chosen by the segment's name/route
	if (/slug/.test(seg)) return fx.courseSlug;
	return fx.courseId;
};

async function call(route, role, variant) {
	let url = "/api" + route.replace(/\[([^\]]+)\]/g, (_, seg) => encodeURIComponent(segmentValue(seg, variant)));
	const dynamic = /\[/.test(route);
	if (!dynamic && variant !== "real") return null;
	// the application uses trailingSlash: true, so API URLs end with "/" (otherwise Next answers 308)
	url += (url.endsWith("/") ? "" : "/") + `?slug=${fx.courseSlug}&id=${variant === "malformed" ? MALFORMED : fx.courseId}`;
	const headers = {};
	if (roles[role]) headers.authorization = token(roles[role]);
	const t0 = performance.now();
	try {
		const res = await fetch(baseUrl + url, { method, headers, redirect: "manual" });
		await res.arrayBuffer();
		return { status: res.status, ms: Math.round(performance.now() - t0) };
	} catch (e) {
		return { status: 0, ms: Math.round(performance.now() - t0), error: e.message.slice(0, 80) };
	}
}

const results = {};
let calls = 0;
for (const route of routes) {
	for (const role of Object.keys(roles)) {
		for (const variant of ["real", "unknown", "malformed"]) {
			const r = await call(route, role, variant);
			if (!r) continue;
			calls++;
			results[`${method} ${route} | ${role} | ${variant}`] = r;
		}
	}
}
fs.writeFileSync(outFile, JSON.stringify({ baseUrl: baseUrl.replace(/\/\/[^/@]*@/, "//"), method, calls, results }, null, 0));
const byStatus = {};
for (const r of Object.values(results)) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
const errors = Object.entries(results).filter(([, r]) => r.status >= 500 || r.status === 0);
console.log(`routes ${routes.length} | calls ${calls} | statuses ${JSON.stringify(byStatus)} | 5xx or connection errors: ${errors.length}`);
for (const [k, r] of errors.slice(0, 40)) console.log(`  ${r.status} ${k}${r.error ? " " + r.error : ""}`);
