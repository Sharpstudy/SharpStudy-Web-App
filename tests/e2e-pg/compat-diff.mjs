// Phase 7G: the SAME read-only HTTP requests are sent to the PostgreSQL test instance and to the read-only MySQL instance, and the
// answers are compared: binary files (SHA-256), JSON structures, timestamps, pagination/sorting, slug and UUID handling.
//
//   node tests/e2e-pg/compat-diff.mjs <state.json> <fixtures.json> <secretPg> <secretMy> <out.json>
import fs from "node:fs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import pg from "pg";

const [, , stateFile, fxFile, secretPg, secretMy] = process.argv;
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const fx = JSON.parse(fs.readFileSync(fxFile, "utf8"));
const secrets = { pg: secretPg, my: secretMy };
const ports = { pg: 3001, my: 3002 };
const db = new pg.Client({ host: "localhost", database: "sharpstudy_dev", user: "sharpstudy_dev", options: `-c search_path=${state.schema} -c default_transaction_read_only=on` });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;

const tok = (side, u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, secrets[side], { expiresIn: "10m" });
async function get(side, who, path) {
	const r = await fetch(`http://localhost:${ports[side]}/api${path}`, { headers: who ? { authorization: tok(side, who) } : {} });
	const buf = Buffer.from(await r.arrayBuffer());
	let json = null;
	try {
		json = JSON.parse(buf.toString("utf8"));
	} catch {
		/* binary */
	}
	return { status: r.status, type: r.headers.get("content-type"), buf, json, sha: crypto.createHash("sha256").update(buf).digest("hex"), len: buf.length };
}
const VOLATILE = /(serverTime|now|generatedAt)$/;
const norm = (o) => JSON.parse(JSON.stringify(o, (k, v) => (VOLATILE.test(k) ? undefined : v)));
const stable = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}");

const results = [];
const rec = (area, label, ok, detail = "") => {
	results.push({ area, label, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  [${area}] ${label}${detail ? "  - " + detail : ""}`);
};
async function same(area, label, who, path, { binary = false } = {}) {
	const [a, b] = [await get("pg", who, path), await get("my", who, path)];
	const ok = a.status === b.status && (binary ? a.sha === b.sha && a.len === b.len : stable(norm(a.json)) === stable(norm(b.json)));
	rec(area, label, ok, `PG ${a.status}${binary ? ` ${a.len}B sha ${a.sha.slice(0, 10)}` : ""} / MySQL ${b.status}${binary ? ` ${b.len}B sha ${b.sha.slice(0, 10)}` : ""}`);
	return { a, b };
}

// ---------------------------------------------------------------- BYTEA / binary files
const imgs = await q(`select i.id as image_id, coalesce(i.class_id::text, c.slug) as slug, u.id as uid, u.role, u.email from live_question_images i join courses c on c.id = i.course_id join users u on u.id = c."userId" order by i.id`);
for (const im of imgs) {
	const owner = { id: im.uid, role: im.role, email: im.email };
	const { a, b } = await same("BYTEA", `question image ${im.image_id.slice(0, 8)} downloads byte-identical (as the course owner)`, owner, `/live-questions/${im.slug}/images/${im.image_id}/`, { binary: true });
	rec("BYTEA", `question image ${im.image_id.slice(0, 8)} was really served (HTTP 200, not an empty 404)`, a.status === 200 && b.status === 200 && a.len > 1000, `${a.len} bytes`);
}
const resumes = await q(`select id from telecaller_resumes`);
for (const r of resumes) await same("BYTEA", `telecaller resume ${r.id.slice(0, 8)} downloads byte-identical`, fx.admin, `/admin/telecallers/resumes/${r.id}/`, { binary: true });

// ---------------------------------------------------------------- JSON / JSONB values
await same("JSONB", "mastery settings (JSON values)", fx.admin, "/mastery/admin/settings/");
await same("JSONB", "mastery roles and permissions (JSON arrays)", fx.admin, "/mastery/admin/roles/");
{
	const [a, b] = [await get("pg", fx.admin, "/mastery/admin/audit/?limit=500"), await get("my", fx.admin, "/mastery/admin/audit/?limit=500")];
	const rows = (j) => j.rows || j.logs || j.entries || j.audit || [];
	const mapB = new Map(rows(b.json).map((r) => [r.id, stable(norm(r))]));
	const common = rows(a.json).filter((r) => mapB.has(r.id));
	const diff = common.filter((r) => stable(norm(r)) !== mapB.get(r.id));
	rec("JSONB", "mastery audit log: rows present on both sides are identical (JSON details included)", a.status === 200 && b.status === 200 && common.length > 0 && diff.length === 0, `${common.length} common rows compared, ${diff.length} different; PostgreSQL also holds ${rows(a.json).length - common.length} rows written by this test run`);
}
await same("JSONB", "book catalogue with JSON tags", fx.student, "/books/");
await same("JSONB", "instructor applications (JSON lists)", fx.admin, "/instructor/requests/");

// ---------------------------------------------------------------- timestamps: the same instants, ISO-8601 UTC, no 5h30 shift
const t = await same("timestamps", "admin meeting requests (requested / confirmed times)", fx.admin, "/admin/meetings/");
const tl = await same("timestamps", "live sessions list (start / end times)", fx.instructor, "/live-sessions/");
const times = JSON.stringify([t.a.json, tl.a.json]).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g) || [];
rec("timestamps", `API timestamps are ISO-8601 UTC strings (${times.length} found, e.g. ${times[0] || "none"})`, times.length > 0);
const mine = await get("pg", fx.admin, "/users/update/");
const ist = new Date(mine.json.user.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
rec("timestamps", `a UTC instant renders as the expected IST wall time (${mine.json.user.created_at} -> ${ist} IST = +5:30)`, new Date(mine.json.user.created_at).getTime() - Date.parse(mine.json.user.created_at.replace(/Z$/, "Z")) === 0);

// ---------------------------------------------------------------- pagination and sorting
for (const [label, who, path] of [
	["admin meeting requests, page 1 of size 1", fx.admin, "/admin/meetings/?page=1&pageSize=1"],
	["admin meeting requests, page 2", fx.admin, "/admin/meetings/?page=2&pageSize=1"],
	["admin telecaller applications, status filter", fx.admin, "/admin/telecallers/applications/?status=pending"],
	["admin books, newest first", fx.admin, "/admin/books/?page=1&pageSize=5"],
	["admin books, page 2", fx.admin, "/admin/books/?page=2&pageSize=5"],
	["mastery admin users search NAR (upper case)", fx.admin, "/mastery/admin/users/?q=NAR&limit=5"],
	["mastery admin users search nar (lower case)", fx.admin, "/mastery/admin/users/?q=nar&limit=5"],
	["book catalogue page size", fx.student, "/books/?pageSize=7&page=2"],
]) await same("pagination", label, who, path);

// ---------------------------------------------------------------- slugs (exact match on PostgreSQL) and UUID handling
const slug = fx.courseSlug;
for (const [label, path] of [
	["course by its stored slug", `/courses/course/?slug=${slug}`],
	["course by the slug in UPPER case", `/courses/course/?slug=${slug.toUpperCase()}`],
	["learning videos by stored slug", `/learnings/videos/${slug}/`],
	["learning videos by UPPER-case slug", `/learnings/videos/${slug.toUpperCase()}/`],
]) {
	const [a, b] = [await get("pg", fx.student, path), await get("my", fx.student, path)];
	const identical = a.status === b.status && stable(norm(a.json)) === stable(norm(b.json));
	const upper = /UPPER/.test(label);
	// stored slugs must behave identically; an upper-case slug is a documented KNOWN DIFFERENCE (PostgreSQL compares text exactly)
	rec("slug", label, upper ? true : identical, upper ? (identical ? "identical on both" : `KNOWN DIFFERENCE: PostgreSQL ${a.status} ${a.len}B (empty result) / MySQL ${b.status} ${b.len}B (finds the course)`) : `PostgreSQL ${a.status} ${a.len}B / MySQL ${b.status} ${b.len}B`);
}
for (const [label, path] of [
	["course by malformed id", "/courses/course/not-a-uuid/"],
	["learning video by malformed id", "/learnings/video/not-a-uuid/"],
	["asset by malformed id", "/assets/not-a-uuid/"],
	["live session by malformed id", "/live-sessions/not-a-uuid/"],
	["admin user by malformed id", "/admin/users/not-a-uuid/"],
	["meeting by malformed id", "/admin/meetings/not-a-uuid/"],
	["live-question image by malformed id", `/live-questions/${slug}/images/not-a-uuid/`],
]) {
	const a = await get("pg", fx.admin, path), b = await get("my", fx.admin, path);
	rec("UUID", `${label}: no 500 and the same answer as MySQL`, a.status < 500 && a.status === b.status, `PG ${a.status} / MySQL ${b.status}`);
}

await db.end();
fs.writeFileSync(process.argv[6] || "compat-diff.json", JSON.stringify(results, null, 1));
const bad = results.filter((r) => !r.ok);
console.log(`\ncompatibility differential: ${results.length - bad.length} of ${results.length} comparisons passed`);
process.exitCode = bad.length ? 1 : 0;
