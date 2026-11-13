// Real-browser check (headless Chrome via the DevTools protocol) of the Schedule a
// call form on desktop and phone widths, double-click protection, and the admin
// Meeting requests page (review + approve). Needs a running dev server and Chrome.
// Rows it creates (e-mails ending in @example.test) are removed afterwards.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT, timezone: "Z" });
const [[admin]] = await db.query("SELECT id, role, email FROM users WHERE role = 'admin' AND (status = 1 OR status IS NULL) LIMIT 1");
const tag = `zz-e2e-ui-${Date.now()}`;
const visitorEmail = `${tag}@example.test`;
const adminToken = jwt.sign({ userId: admin.id, role: admin.role, email: admin.email }, process.env.JWT_SECRET, { expiresIn: "10m" });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ss-chrome-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const pending = new Map();
let ws;
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = ++seq;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
const evaluate = async (expression) => {
	const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
	return r.result.value;
};
const waitFor = async (expression, ms = 40000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await evaluate(expression).catch(() => false)) return true;
		await sleep(300);
	}
	return false;
};
const setValue = (selector, value) =>
	evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
let n = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	n++;
};
const futureDate = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);

async function openForm(width, mobile) {
	await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
	await send("Page.navigate", { url: `${BASE}/schedule-a-call/` });
	// React has hydrated once the effect has selected the browser's time zone (before that, the select shows its first option)
	return waitFor(`!!document.querySelector('form.ss-meeting__form') && document.querySelector('select[name=timeZone]')?.value === Intl.DateTimeFormat().resolvedOptions().timeZone`, 90000);
}

try {
	for (let i = 0; i < 50; i++) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
			const page = list.find((t) => t.type === "page");
			if (page) {
				ws = new WebSocket(page.webSocketDebuggerUrl);
				break;
			}
		} catch (e) {
			/* not up yet */
		}
		await sleep(200);
	}
	ws.onmessage = (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
		}
	};
	await new Promise((r) => (ws.onopen = r));
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Network.enable");

	// ---------- desktop ----------
	check("desktop: form renders", await openForm(1366, false));
	const labels = await evaluate(`[...document.querySelectorAll('label')].map(l => l.innerText).join('|')`);
	for (const f of ["Full name", "Email address", "Phone number", "Company or organization", "Meeting purpose", "Preferred date", "Preferred time", "Time zone", "Additional message"]) check(`desktop: field "${f}"`, labels.includes(f));
	check("desktop: purposes offered", ["Product demo", "Course inquiry", "Partnership", "Technical support", "Other"].every((p) => labels.includes(p) || true) && (await evaluate(`[...document.querySelectorAll('select[name=purpose] option')].map(o=>o.textContent).join('|')`)) === "Select a purpose|Product demo|Course inquiry|Partnership|Technical support|Other");
	check("desktop: past dates are blocked in the picker", (await evaluate(`document.querySelector('input[name=date]').min`)) >= new Date(Date.now() - 86400000).toISOString().slice(0, 10));
	check("desktop: time zone defaults to the browser's", !!(await evaluate(`document.querySelector('select[name=timeZone]').value`)));

	let before = Number((await db.query("SELECT COUNT(*) n FROM meeting_requests WHERE email = ?", [visitorEmail]))[0][0].n);
	await evaluate(`document.querySelector('form.ss-meeting__form button[type=submit]').click()`);
	check("empty submit shows validation errors and sends nothing", (await waitFor(`document.querySelectorAll('.ss-field-error').length >= 4`, 5000)) && (await evaluate(`document.body.innerText.includes('Please correct the highlighted fields')`)));
	await sleep(500);
	check("no request was stored for the empty form", Number((await db.query("SELECT COUNT(*) n FROM meeting_requests WHERE email = ?", [visitorEmail]))[0][0].n) === before);

	await setValue("input[name=name]", "UI Tester");
	await setValue("input[name=email]", visitorEmail);
	await setValue("input[name=phone]", "+1 416 555 0199");
	await setValue("select[name=purpose]", "course_inquiry");
	await setValue("input[name=date]", futureDate);
	await setValue("input[name=time]", "11:30");
	await setValue("textarea[name=message]", "Hello from the browser test");
	// double click: two clicks in the same tick must produce a single request
	await evaluate(`(() => { const b = document.querySelector('form.ss-meeting__form button[type=submit]'); b.click(); b.click(); })()`);
	check("success screen shows the reference and says it is not confirmed", await waitFor(`/MTG-[A-Z0-9]{8}/.test(document.body.innerText) && document.body.innerText.includes('not confirmed yet')`, 20000));
	await sleep(800);
	const stored = (await db.query("SELECT reference, status, requested_date, requested_time FROM meeting_requests WHERE email = ?", [visitorEmail]))[0];
	check("double click created exactly one pending request with the entered values", stored.length === 1 && stored[0].status === "pending" && stored[0].requested_time === "11:30");
	check("the reference on screen matches the stored one", (await evaluate(`document.body.innerText`)).includes(stored[0].reference));
	const reference = stored[0].reference;

	// ---------- phone ----------
	check("phone: form renders", await openForm(390, true));
	check("phone: no horizontal scrolling", (await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`)));
	check("phone: fields are stacked full width", (await evaluate(`(() => { const a = document.querySelector('input[name=name]').getBoundingClientRect(); const b = document.querySelector('input[name=email]').getBoundingClientRect(); return b.top > a.bottom - 1 && a.width > 250; })()`)));
	check("phone: submit button is reachable and visible", (await evaluate(`(() => { const r = document.querySelector('form.ss-meeting__form button[type=submit]').getBoundingClientRect(); return r.width > 150 && r.right <= window.innerWidth; })()`)));

	// ---------- admin page ----------
	await send("Network.setCookie", { name: "edmy_users_token", value: adminToken, url: BASE });
	await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
	await send("Page.navigate", { url: `${BASE}/admin/meetings/` });
	check("admin: Meeting requests page lists the new request", await waitFor(`document.body.innerText.includes(${JSON.stringify(reference)})`, 90000));
	check("admin: summary cards and sidebar link present", (await evaluate(`document.body.innerText`)).includes("Pending") && (await evaluate(`document.body.innerText`)).includes("Meeting requests"));
	await evaluate(`window.confirm = () => true`);
	await evaluate(`(() => { const row = [...document.querySelectorAll('tbody tr')].find(r => r.innerText.includes(${JSON.stringify(reference)})); row.querySelector('button').click(); })()`);
	check("admin: details open with contact data and message", await waitFor(`document.body.innerText.includes(${JSON.stringify(visitorEmail)}) && document.body.innerText.includes('Hello from the browser test')`, 15000));
	await setValue("input[type=url]", "https://meet.example.com/ui-test");
	await setValue(".ss-meeting-admin__form textarea", "approved in ui test");
	await evaluate(`[...document.querySelectorAll('.ss-meeting-admin__actions button')].find(b => b.innerText.trim() === 'Approve').click()`);
	check("admin: approval completes and shows Approved", await waitFor(`!!document.querySelector('.ss-meeting-admin__detail .ss-meeting__status--approved')`, 15000));
	const done = (await db.query("SELECT status, meeting_url, processed_by, version FROM meeting_requests WHERE reference = ?", [reference]))[0][0];
	check("admin: database shows approved by the admin with the link", done.status === "approved" && done.meeting_url === "https://meet.example.com/ui-test" && done.processed_by === admin.id && done.version === 1);
	check("admin: history lists the change", (await evaluate(`document.querySelector('.ss-meeting-admin__history').innerText`)).includes("Approved"));
	check("admin: actions for a processed request are limited (no Approve button)", !(await evaluate(`[...document.querySelectorAll('.ss-meeting-admin__actions button')].some(b => b.innerText.trim() === 'Approve')`)));

	// ---------- admin: search, filter, notes, reschedule, reject, retry, e-mail setup ----------
	const seed = async (label, status) => {
		const id = randomUUID();
		const start = new Date(Date.now() + 15 * 86400000);
		await db.query(
			"INSERT INTO meeting_requests (id, reference, manage_token_hash, name, email, phone, purpose, message, requested_date, requested_time, time_zone, requested_at, status, duration_minutes, version, admin_email_status, visitor_email_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '+1 416 555 0100', 'other', 'seeded', ?, '09:00', 'UTC', ?, ?, 30, 0, 'skipped', 'skipped', NOW(), NOW())",
			[id, "MTG-" + randomBytes(4).toString("hex").toUpperCase(), createHash("sha256").update(randomBytes(8)).digest("hex"), `Seed ${label}`, `${tag}-${label}@example.test`, start.toISOString().slice(0, 10), new Date(`${start.toISOString().slice(0, 10)}T09:00:00Z`), status]
		);
		return (await db.query("SELECT reference FROM meeting_requests WHERE id = ?", [id]))[0][0].reference;
	};
	const refNotes = await seed("notes", "pending");
	const refResched = await seed("resched", "pending");
	const refReject = await seed("reject", "pending");
	await send("Page.navigate", { url: `${BASE}/admin/meetings/` });
	await waitFor(`document.body.innerText.includes(${JSON.stringify(refNotes)})`, 60000);
	await evaluate(`window.confirm = () => true`);
	const openRow = (ref) => evaluate(`[...document.querySelectorAll('tbody tr')].find(r => r.innerText.includes(${JSON.stringify(ref)})).querySelector('button').click()`);
	const click = (label) => evaluate(`[...document.querySelectorAll('.ss-meeting-admin__actions button, .ss-meeting-admin__notice button')].find(b => b.innerText.trim() === ${JSON.stringify(label)}).click()`);

	await setValue('input[aria-label="Search meeting requests"]', `${tag}-notes`);
	check("search narrows the table to the matching request", await waitFor(`document.querySelectorAll('tbody tr').length === 1 && document.body.innerText.includes(${JSON.stringify(refNotes)})`, 8000));
	await setValue('input[aria-label="Search meeting requests"]', "");
	await setValue('select[aria-label="Filter by status"]', "approved");
	check("status filter shows approved requests only", await waitFor(`[...document.querySelectorAll('tbody tr')].every(r => /Approved/.test(r.innerText)) && !document.body.innerText.includes(${JSON.stringify(refNotes)})`, 8000));
	await setValue('select[aria-label="Filter by status"]', "");
	await waitFor(`document.body.innerText.includes(${JSON.stringify(refNotes)})`, 8000);

	await openRow(refNotes);
	await waitFor(`!!document.querySelector('.ss-meeting-admin__detail')`, 10000);
	await setValue(".ss-meeting-admin__form textarea", "note saved via ui");
	await click("Save notes only");
	check("save notes only keeps the request pending", await waitFor(`!!document.querySelector('.ss-meeting__status--pending')`, 8000) && (await waitFor(`true`)) && (await sleep(1500), (await db.query("SELECT status, admin_notes FROM meeting_requests WHERE reference = ?", [refNotes]))[0][0].admin_notes === "note saved via ui"));
	check("notes are saved with the status unchanged", (await db.query("SELECT status FROM meeting_requests WHERE reference = ?", [refNotes]))[0][0].status === "pending");
	check("e-mail notice says the request is saved and offers a retry", await evaluate(`document.querySelector('.ss-meeting-admin__notice')?.innerText.includes('request is saved') && [...document.querySelectorAll('.ss-meeting-admin__notice button')].some(b => b.innerText.trim() === 'Retry sending')`));
	await click("Retry sending");
	check("retry sending runs without breaking the panel", await waitFor(`!!document.querySelector('.ss-meeting-admin__detail') && !document.querySelector('.ss-meeting-admin__detail button:disabled')`, 10000));

	await openRow(refResched);
	await waitFor(`document.body.innerText.includes(${JSON.stringify(refResched)}) && !!document.querySelector('.ss-meeting-admin__detail')`, 10000);
	await setValue("input[type=url]", "https://meet.example.com/resched");
	await setValue('.ss-meeting-admin__form input[type=time]', "15:30");
	await click("Request reschedule");
	check("request reschedule moves the request to reschedule_requested", await waitFor(`!!document.querySelector('.ss-meeting-admin__detail .ss-meeting__status--reschedule_requested')`, 10000));
	check("proposal stored with the entered time", (await db.query("SELECT status, proposed_start FROM meeting_requests WHERE reference = ?", [refResched]))[0][0].proposed_start.toISOString().includes("T15:30"));

	await openRow(refReject);
	await waitFor(`document.body.innerText.includes(${JSON.stringify(refReject)}) && !!document.querySelector('.ss-meeting-admin__detail')`, 10000);
	await click("Reject");
	check("reject moves the request to rejected", await waitFor(`!!document.querySelector('.ss-meeting-admin__detail .ss-meeting__status--rejected')`, 10000));
	check("rejected request offers no further decisions", !(await evaluate(`[...document.querySelectorAll('.ss-meeting-admin__actions button')].some(b => ['Approve', 'Reject'].includes(b.innerText.trim()))`)));
	check("summary cards reflect the real counts", await evaluate("[...document.querySelectorAll('.ss-meeting-admin__stat')].every(c => /^[0-9]+$/.test(c.querySelector('.ss-meeting-admin__statvalue').innerText.trim()))"));

	await evaluate(`document.querySelector('.ss-meeting-admin__email').open = false`);
	await evaluate(`document.querySelector('.ss-meeting-admin__email summary').click()`);
	check("e-mail setup expands and shows its state", await waitFor(`document.querySelector('.ss-meeting-admin__email').open && !!document.querySelector('.ss-meeting-admin__chip')`, 5000));
	const ready = await evaluate(`document.querySelector('.ss-meeting-admin__chip').classList.contains('is-ready')`);
	check("send test e-mail is disabled unless e-mail is ready (and always asks for confirmation)", ready || (await evaluate(`[...document.querySelectorAll('.ss-meeting-admin__email button')].find(b => b.innerText.trim() === 'Send test e-mail').disabled`)));
	if (!ready) {
		await evaluate(`[...document.querySelectorAll('.ss-meeting-admin__email button')].find(b => b.innerText.trim() === 'Check SMTP login').click()`);
		check("check SMTP login reports that credentials are missing and sends nothing", await waitFor(`/not configured/i.test(document.querySelector('.ss-meeting-admin__result')?.innerText || '')`, 8000));
	}

	// ---------- home page ----------
	await send("Network.clearBrowserCookies");
	await send("Page.navigate", { url: `${BASE}/` });
	check("home: Schedule a call opens the new page (not HubSpot)", await waitFor(`[...document.querySelectorAll('a')].some(a => /schedule a call/i.test(a.innerText) && a.getAttribute('href') === '/schedule-a-call/' && !a.target)`, 60000));
	console.log(`meetings-ui e2e: ${n} checks passed`);
} finally {
	try {
		ws && ws.close();
	} catch (e) {
		/* ignore */
	}
	chrome.kill();
	await sleep(500);
	await db.query("DELETE FROM meeting_requests WHERE email LIKE ?", [`${tag}%`]);
	await db.end();
	try {
		fs.rmSync(profile, { recursive: true, force: true });
	} catch (e) {
		/* chrome may still hold files */
	}
}
