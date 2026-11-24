// Meeting-request API against a RUNNING dev server and the dev database
// (localhost only), using the real Sequelize repository. E-mail is NOT sent by
// this test unless your .env contains SES credentials AND MEETING_ADMIN_EMAIL
// (the test addresses end in @example.test). All rows created here are removed.
// The request limiter is in memory: restart the dev server between runs if you see 429s.
// Set E2E_RATE=1 to also exercise the per-address request limiter.
import fs from "node:fs";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { deriveToken } from "../../lib/meetings/service.js";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");
const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT, timezone: "Z" });
const [users] = await db.query("SELECT id, role, email FROM users WHERE status = 1 OR status IS NULL ORDER BY created_at");
const admin = users.find((u) => u.role === "admin");
const student = users.find((u) => u.role === "student");
const instructor = users.find((u) => u.role === "instructor");
const tok = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "10m" });

const tag = `zz-e2e-${Date.now()}`;
const email = (n) => `${tag}-${n}@example.test`;
const dayOut = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
let n = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	n++;
};
const call = async (method, path, { as, raw, body, query } = {}) => {
	const headers = { "Content-Type": "application/json" };
	if (as) headers.Authorization = tok(as);
	if (raw) headers.Authorization = raw;
	const res = await fetch(`${BASE}${path}${query ? `?${new URLSearchParams(query)}` : ""}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch (e) {
		/* not json */
	}
	return { status: res.status, json, text };
};
const valid = (i, extra = {}) => ({ name: `Test Visitor ${i}`, email: email(i), phone: "+1 416 555 0100", organization: "E2E Co", purpose: "product_demo", message: "hello <b>there</b>", date: dayOut(10), time: "10:00", timeZone: "America/Toronto", submissionKey: `${tag}-key-${i}`, ...extra });
// Direct insert of a pending request: the per-address API limiter (30/hour, in memory) is not what these bulk cases test.
const insertPending = async (key, date, time) => {
	const id = randomUUID();
	const reference = "MTG-" + randomBytes(4).toString("hex").toUpperCase();
	await db.query(
		"INSERT INTO meeting_requests (id, reference, manage_token_hash, name, email, phone, purpose, requested_date, requested_time, time_zone, requested_at, status, duration_minutes, version, admin_email_status, visitor_email_status, created_at, updated_at) VALUES (?, ?, ?, 'Bulk Tester', ?, '+1 416 555 0100', 'other', ?, ?, 'UTC', ?, 'pending', 30, 0, 'skipped', 'skipped', NOW(), NOW())",
		[id, reference, createHash("sha256").update(randomBytes(8)).digest("hex"), email(key), date, time, new Date(`${date}T${time}:00Z`)]
	);
	return id;
};
const row = async (ref) => (await db.query("SELECT * FROM meeting_requests WHERE reference = ?", [ref]))[0][0];

try {
	// ===== public submission =====
	const bad = [
		[{ name: "" }, "name"], [{ email: "nope" }, "email"], [{ phone: "x" }, "phone"], [{ purpose: "zzz" }, "purpose"], [{ timeZone: "Mars/Base" }, "timeZone"],
		[{ date: dayOut(-2) }, "date"], [{ date: "2026-02-30" }, "date"], [{ time: "" }, "time"],
	];
	for (const [extra, field] of bad) {
		const r = await call("POST", "/api/meetings/request/", { body: valid(0, { submissionKey: undefined, ...extra }) });
		check(`submit: invalid ${field} -> 422 with field error`, r.status === 422 && r.json.fields && field in r.json.fields);
	}
	check("submit: GET not allowed", (await call("GET", "/api/meetings/request/")).status === 405);
	check("submit: invalid requests stored nothing", (await db.query("SELECT COUNT(*) n FROM meeting_requests WHERE email LIKE ?", [`${tag}%`]))[0][0].n === 0);

	const a = await call("POST", "/api/meetings/request/", { body: valid(1) });
	check("submit: valid -> 201 with reference, pending, secret token", a.status === 201 && /^MTG-[A-Z0-9]{8}$/.test(a.json.reference) && a.json.status === "pending" && /^[a-f0-9]{48}$/.test(a.json.manageToken));
	const rowA = await row(a.json.reference);
	check("stored as pending, unconfirmed, token only hashed", rowA.status === "pending" && rowA.confirmed_start === null && rowA.manage_token_hash !== a.json.manageToken && rowA.manage_token_hash.length === 64);
	const utc = await call("POST", "/api/meetings/request/", { body: valid(3, { timeZone: "UTC", time: "13:45" }) });
	check("requested_at is stored as the exact UTC instant", new Date((await row(utc.json.reference)).requested_at).toISOString() === `${dayOut(10)}T13:45:00.000Z`);
	const dup = await call("POST", "/api/meetings/request/", { body: valid(1) });
	check("submit: same submission key -> one request, no new secret", dup.status === 200 && dup.json.duplicate === true && dup.json.reference === a.json.reference && !dup.json.manageToken);
	check("submit: still exactly one row", (await db.query("SELECT COUNT(*) n FROM meeting_requests WHERE email = ?", [email(1)]))[0][0].n === 1);
	const hp = await call("POST", "/api/meetings/request/", { body: valid(9, { website: "http://spam.example" }) });
	check("submit: honeypot filled -> accepted silently, nothing stored", hp.status === 201 && (await db.query("SELECT COUNT(*) n FROM meeting_requests WHERE email = ?", [email(9)]))[0][0].n === 0);
	check("e-mail outcome recorded (sent / skipped / failed), request kept", ["sent", "skipped", "failed"].includes(rowA.admin_email_status) && ["sent", "skipped", "failed"].includes(rowA.visitor_email_status));

	// ===== visitor link =====
	const ref = a.json.reference;
	const tokA = a.json.manageToken;
	let v = await call("GET", "/api/meetings/manage/", { query: { ref, token: tokA } });
	check("visitor: own request visible without private data", v.status === 200 && v.json.request.status === "pending" && !/@example\.test|admin_notes|manage_token|"id"/.test(v.text));
	check("visitor: wrong token / unknown reference / injection all 404", (await call("GET", "/api/meetings/manage/", { query: { ref, token: "0".repeat(48) } })).status === 404 && (await call("GET", "/api/meetings/manage/", { query: { ref: "MTG-ZZZZZZZZ", token: tokA } })).status === 404 && (await call("GET", "/api/meetings/manage/", { query: { ref: "' OR 1=1 --", token: tokA } })).status === 404 && (await call("GET", "/api/meetings/manage/", { query: { ref } })).status === 404);

	// ===== admin endpoints are admin-only =====
	check("admin list: anonymous 401, fake token 401", (await call("GET", "/api/admin/meetings/")).status === 401 && (await call("GET", "/api/admin/meetings/", { raw: "x" })).status === 401);
	check("admin list: student 403, instructor 403", (await call("GET", "/api/admin/meetings/", { as: student })).status === 403 && (await call("GET", "/api/admin/meetings/", { as: instructor })).status === 403);
	check("admin detail / actions: student and anonymous refused", (await call("GET", `/api/admin/meetings/${rowA.id}/`, { as: student })).status === 403 && (await call("POST", `/api/admin/meetings/${rowA.id}/`, { as: student, body: { action: "approve", version: 0 } })).status === 403 && (await call("POST", `/api/admin/meetings/${rowA.id}/`, { body: { action: "approve", version: 0 } })).status === 401);
	check("request unchanged after refused attempts", (await row(ref)).status === "pending");
	const list = await call("GET", "/api/admin/meetings/", { as: admin, query: { q: tag } });
	check("admin list: search finds the request, counts present", list.status === 200 && list.json.total >= 1 && list.json.requests.some((r) => r.reference === ref) && typeof list.json.counts.pending === "number");
	check("admin list: status filter", (await call("GET", "/api/admin/meetings/", { as: admin, query: { q: tag, status: "approved" } })).json.total === 0);
	check("admin list never contains the token hash", !list.text.includes("manage_token"));
	const detail = await call("GET", `/api/admin/meetings/${rowA.id}/`, { as: admin });
	check("admin detail: contact data and history", detail.status === 200 && detail.json.request.email === email(1) && detail.json.events.length === 1);

	// ===== decisions =====
	const act = (id, body, as = admin) => call("POST", `/api/admin/meetings/${id}/`, { as, body });
	check("approve without a link is refused", (await act(rowA.id, { action: "approve", version: 0 })).status === 422 || !!process.env.MEETING_DEFAULT_URL);
	check("approve with an unsafe link is refused", (await act(rowA.id, { action: "approve", version: 0, meetingUrl: "javascript:alert(1)" })).status === 422);
	check("approve with a stale version is refused", (await act(rowA.id, { action: "approve", version: 7, meetingUrl: "https://meet.example.com/e2e" })).status === 409);
	// Two admins act on the same version at the same moment (a separate request): exactly one wins.
	const race = await call("POST", "/api/meetings/request/", { body: valid(4, { time: "16:00" }) });
	const rowR = await row(race.json.reference);
	const [r1, r2] = await Promise.all([act(rowR.id, { action: "approve", version: 0, meetingUrl: "https://meet.example.com/race" }), act(rowR.id, { action: "reject", version: 0 })]);
	check("two simultaneous decisions: exactly one wins, the other gets 409", [r1.status, r2.status].sort().join() === "200,409");
	check("race: only one status change recorded", (await db.query("SELECT COUNT(*) n FROM meeting_request_events WHERE meeting_request_id = ? AND actor = 'admin'", [rowR.id]))[0][0].n === 1);
	const ok = await act(rowA.id, { action: "approve", version: 0, meetingUrl: "https://meet.example.com/e2e", notes: "private note", processedBy: student.id });
	check("approve (body processedBy ignored)", ok.status === 200 && ok.json.request.status === "approved");
	const after = await row(ref);
	check("processed_by is the verified admin (not a body value), version bumped once", after.processed_by === admin.id && after.version === 1 && after.processed_at);
	{
		check("approved: confirmed slot stored with the link", after.confirmed_start && after.meeting_url === "https://meet.example.com/e2e" && new Date(after.confirmed_end) - new Date(after.confirmed_start) === 30 * 60000);
		check("double approval with the old version -> 409", (await act(rowA.id, { action: "approve", version: 0, meetingUrl: "https://meet.example.com/e2e" })).status === 409);
		check("visitor now sees the link, still no admin notes", (await call("GET", "/api/meetings/manage/", { query: { ref, token: tokA } })).text.includes("meet.example.com/e2e") && !(await call("GET", "/api/meetings/manage/", { query: { ref, token: tokA } })).text.includes("private note"));

		// overlapping request for the same slot
		const b = await call("POST", "/api/meetings/request/", { body: valid(2, { time: "10:15" }) });
		const rowB = await row(b.json.reference);
		const clash = await act(rowB.id, { action: "approve", version: 0, meetingUrl: "https://meet.example.com/e2e-b" });
		check("overlapping meeting refused (409 overlap)", clash.status === 409 && clash.json.code === "overlap");
		const prop = await act(rowB.id, { action: "reschedule", version: 0, meetingUrl: "https://meet.example.com/e2e-b", date: dayOut(12), time: "09:00" });
		check("propose a different time", prop.status === 200 && prop.json.request.status === "reschedule_requested" && prop.json.request.proposedStart);
		const tokB = b.json.manageToken;
		const acc = await call("POST", "/api/meetings/manage/", { body: { ref: b.json.reference, token: tokB, action: "accept" } });
		check("visitor accepts the proposal -> approved", acc.status === 200 && acc.json.request.status === "approved");
		check("another visitor's token cannot act on this request", (await call("POST", "/api/meetings/manage/", { body: { ref: b.json.reference, token: tokA, action: "cancel" } })).status === 404);
		const cancel = await call("POST", "/api/meetings/manage/", { body: { ref, token: tokA, action: "cancel" } });
		check("visitor cancels their own meeting", cancel.status === 200 && cancel.json.request.status === "cancelled");
		check("cancelled request cannot be approved again", (await act(rowA.id, { action: "approve", version: 2, meetingUrl: "https://meet.example.com/e2e" })).status === 409);
	}
	const events = (await db.query("SELECT to_status, actor FROM meeting_request_events WHERE meeting_request_id = ? ORDER BY created_at", [rowA.id]))[0];
	check("status history recorded", events.length >= 2 && events.some((e) => e.to_status === "pending" && e.actor === "visitor") && events.some((e) => e.actor === "admin"));

	// ===== resend / notes =====
	const note = await act(rowA.id, { action: "note", notes: "later note" });
	check("admin notes can be saved without a status change", note.status === 200 && note.json.request.adminNotes === "later note");
	const resend = await act(rowA.id, { action: "resend_email" });
	check("retry-email action works and reports delivery state", resend.status === 200 && ["sent", "skipped", "failed"].includes(resend.json.request.visitorEmailStatus));

	// ===== status link survives later decisions (derived token, only a hash is stored) =====
	const linkSecret = process.env.MEETING_LINK_SECRET || process.env.JWT_SECRET;
	check("the returned token is the derived one and the database holds only its hash", a.json.manageToken === deriveToken(linkSecret, rowA.id) && !(JSON.stringify(await row(ref))).includes(a.json.manageToken));
	const c5 = await call("POST", "/api/meetings/request/", { body: valid(5, { time: "17:00" }) });
	const row5 = await row(c5.json.reference);
	await act(row5.id, { action: "reject", version: 0 });
	const tok5 = deriveToken(linkSecret, row5.id); // what the rejection e-mail links to
	const v5 = await call("GET", "/api/meetings/manage/", { query: { ref: c5.json.reference, token: tok5 } });
	check("after a rejection the visitor can still open their status page with the e-mailed link", v5.status === 200 && v5.json.request.status === "rejected");
	check("a token for another request does not open it", (await call("GET", "/api/meetings/manage/", { query: { ref: c5.json.reference, token: deriveToken(linkSecret, rowA.id) } })).status === 404);
	check("status page has a no-referrer policy and is not indexed", (await (await fetch(`${BASE}/schedule-a-call/status/`)).text()).includes('name="referrer" content="no-referrer"'));

	// ===== real-database concurrency: simultaneous approvals of overlapping requests =====
	const overlapping = async (idsRef) => {
		const rows = (await db.query("SELECT confirmed_start s, confirmed_end e FROM meeting_requests WHERE status = 'approved' AND email LIKE ? ORDER BY confirmed_start", [`${tag}%`]))[0];
		return rows.some((r, i) => i > 0 && new Date(rows[i - 1].e) > new Date(r.s));
	};
	for (let round = 0; round < 4; round++) {
		const day = dayOut(30 + round);
		const ids = [];
		for (let i = 0; i < 6; i++) {
			ids.push(await insertPending(`c${round}${i}`, day, `14:${String(i * 3).padStart(2, "0")}`));
		}
		const results = await Promise.all(ids.map((id) => act(id, { action: "approve", version: 0, meetingUrl: "https://meet.example.com/c" })));
		const wins = results.filter((r) => r.status === 200).length;
		check(`round ${round + 1}: 6 simultaneous overlapping approvals -> exactly 1 succeeds`, wins === 1);
		if (results.filter((r) => r.status === 409 && r.json.code === "overlap").length !== 5) console.log("debug", results.map((r) => `${r.status}:${r.json && r.json.code}`).join(" "));
		check(`round ${round + 1}: all others get 409 overlap`, results.filter((r) => r.status === 409 && r.json.code === "overlap").length === 5);
		check(`round ${round + 1}: no overlapping approved meetings in the database`, !(await overlapping()));
	}
	{
		// non-overlapping slots are still all approvable at once
		const ids = [];
		for (let i = 0; i < 4; i++) {
			ids.push(await insertPending(`d${i}`, dayOut(40), `${String(9 + i).padStart(2, "0")}:00`));
		}
		const results = await Promise.all(ids.map((id) => act(id, { action: "approve", version: 0, meetingUrl: "https://meet.example.com/d" })));
		check("separate slots can all be approved concurrently", results.every((r) => r.status === 200));
	}

	// ===== e-mail configuration check (never reveals values, never sends unasked) =====
	check("email-check: anonymous 401, student 403", (await call("GET", "/api/admin/meetings/email-check/")).status === 401 && (await call("GET", "/api/admin/meetings/email-check/", { as: student })).status === 403 && (await call("POST", "/api/admin/meetings/email-check/", { as: student, body: { action: "send_test", confirm: true } })).status === 403);
	const cfg = await call("GET", "/api/admin/meetings/email-check/", { as: admin });
	check("email-check: admin sees presence flags only", cfg.status === 200 && typeof cfg.json.config.ready === "boolean" && !/AKIA/.test(cfg.text) && !cfg.text.includes(process.env.JWT_SECRET) && !cfg.text.includes(process.env.DB_PASSWORD));
	check("email-check: sending a test needs explicit confirmation", (await call("POST", "/api/admin/meetings/email-check/", { as: admin, body: { action: "send_test" } })).status === 422);
	if (!cfg.json.config.ready) {
		const t = await call("POST", "/api/admin/meetings/email-check/", { as: admin, body: { action: "send_test", confirm: true, to: "someone@else.test" } });
		check("email-check: unconfigured -> test refused (409), nothing sent", t.status === 409 && t.json.ok === false);
		check("email-check: verify without credentials is refused, not attempted", (await call("POST", "/api/admin/meetings/email-check/", { as: admin, body: { action: "verify" } })).status === 409);
	} else console.log("note: e-mail is configured in this environment; send_test/verify were not called by the automated test");
	check("email-check: unknown action refused", (await call("POST", "/api/admin/meetings/email-check/", { as: admin, body: { action: "x" } })).status === 422);

	// ===== pages =====
	const page = await fetch(`${BASE}/schedule-a-call/`);
	const html = await page.text();
	check("public booking page renders with the form", page.status === 200 && html.includes("Request a meeting") && html.includes("not confirmed"));
	check("public status page renders", (await fetch(`${BASE}/schedule-a-call/status/`)).status === 200);
	const home = await (await fetch(`${BASE}/`)).text();
	check("home page has no HubSpot redirect and links to the new flow", !/hubspot/i.test(home) && home.includes('href="/schedule-a-call/"'));

	if (process.env.E2E_RATE) {
		let limited = false;
		for (let i = 0; i < 40 && !limited; i++) limited = (await call("POST", "/api/meetings/request/", { body: valid(100 + i, { name: "" }) })).status === 429;
		check("request endpoint is rate limited (429)", limited);
	}
	console.log(`meetings e2e: ${n} checks passed`);
} finally {
	await db.query("DELETE FROM meeting_requests WHERE email LIKE ?", [`${tag}%`]); // events cascade
	await db.end();
}
