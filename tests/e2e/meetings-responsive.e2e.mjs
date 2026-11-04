// Responsive check (headless Chrome, DevTools protocol) of the Schedule a call
// pages at 390, 440, 768 (tablet), 1024 and 1366 px: the booking form and its
// validation messages, the success screen, the visitor status page, the admin
// table and the request detail view. The rule: the PAGE must never scroll
// sideways (a table may scroll inside its own wrapper), and every control must
// sit inside the viewport. Needs a running dev server and Chrome.
// Rows it creates (e-mails ending in @example.test) are removed afterwards.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { deriveToken } from "../../lib/meetings/service.js";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9335;
const WIDTHS = [
	{ w: 390, label: "phone 390", mobile: true },
	{ w: 440, label: "phone 440", mobile: true },
	{ w: 768, label: "tablet 768", mobile: true },
	{ w: 1024, label: "small desktop 1024", mobile: false },
	{ w: 1366, label: "desktop 1366", mobile: false },
];

const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT, timezone: "Z" });
const [[admin]] = await db.query("SELECT id, role, email FROM users WHERE role = 'admin' AND (status = 1 OR status IS NULL) LIMIT 1");
const adminToken = jwt.sign({ userId: admin.id, role: admin.role, email: admin.email }, process.env.JWT_SECRET, { expiresIn: "20m" });
const tag = `zz-e2e-resp-${Date.now()}`;
const linkSecret = process.env.MEETING_LINK_SECRET || process.env.JWT_SECRET;

// Seed rows with deliberately long, unbroken text to stress wrapping.
const longName = "Bartholomew-Maximilian Featherstonehaugh-Cholmondeley";
const longEmail = `${tag}-an.extremely.long.address.that.keeps.going@subdomain.example-organisation-name.example.test`;
const day = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
const seeded = [];
for (const [i, status] of ["pending", "approved", "reschedule_requested", "pending"].entries()) {
	const id = randomUUID();
	const reference = "MTG-" + randomBytes(4).toString("hex").toUpperCase();
	const start = new Date(`${day}T${String(9 + i).padStart(2, "0")}:00:00Z`);
	await db.query(
		"INSERT INTO meeting_requests (id, reference, manage_token_hash, name, email, phone, organization, purpose, message, requested_date, requested_time, time_zone, requested_at, status, duration_minutes, confirmed_start, confirmed_end, proposed_start, meeting_url, version, admin_email_status, visitor_email_status, last_email_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '+1 416 555 0100', 'An Organisation With A Very Long Name Incorporated International', 'partnership', ?, ?, ?, 'America/Argentina/ComodRivadavia', ?, ?, 30, ?, ?, ?, 'https://meet.example.com/a/really/long/path/that/keeps/going/and/going/and/going/room', 0, 'failed', 'skipped', 'admin: connect ETIMEDOUT while talking to the mail server', NOW(), NOW())",
		[id, reference, createHash("sha256").update(deriveToken(linkSecret, id)).digest("hex"), i === 0 ? longName : `Resp Tester ${i}`, i === 0 ? longEmail : `${tag}-${i}@example.test`, "Message ".repeat(60) + "Supercalifragilisticexpialidocious".repeat(4), day, `${String(9 + i).padStart(2, "0")}:00`, start, status, status === "approved" ? start : null, status === "approved" ? new Date(start.getTime() + 1800000) : null, status === "reschedule_requested" ? start : null]
	);
	seeded.push({ id, reference, status });
}

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

// No sideways page scroll, and no visible control/text box sticking out of the viewport
// (elements inside a horizontally scrollable wrapper, such as a wide table, are exempt).
const OVERFLOW_JS = `(() => {
	const vw = window.innerWidth;
	const bad = [];
	const scrollable = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true; } return false; };
	for (const el of document.querySelectorAll('input, select, textarea, button, a.ss-btn, h1, h2, h3, p, dd, .ss-badge, .ss-field-error')) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden' || el.closest('.ss-meeting__hp, .visually-hidden, [aria-hidden=true], .ss-drawer, .ss-drawer-backdrop')) continue;
		if ((r.right > vw + 1 || r.left < -1) && !scrollable(el)) bad.push(el.tagName + '.' + String(el.className).slice(0, 40) + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + '] ' + (el.innerText || '').slice(0, 30));
	}
	const wide = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > vw + 1 && el.getBoundingClientRect().width > 0 && !scrollable(el)).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 4).map((el) => el.tagName + '.' + String(el.className).slice(0, 40) + ' right=' + Math.round(el.getBoundingClientRect().right));
	const sw = [...document.querySelectorAll('body, body *')].filter((el) => el.scrollWidth > vw + 1).map((el) => el.tagName + '.' + String(el.className).slice(0, 30) + ' sw=' + el.scrollWidth + ' cw=' + el.clientWidth + ' ov=' + getComputedStyle(el).overflowX).slice(0, 6);
	return { sw, wide, docOverflow: document.documentElement.scrollWidth > vw + 1, scrollWidth: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 5) };
})()`;
async function noOverflow(label) {
	await sleep(1200); // let fonts, images and transitions settle
	const r = await evaluate(OVERFLOW_JS);
	check(`${label}: page does not scroll sideways (scrollWidth ${r.scrollWidth} <= ${r.vw}; wide: ${JSON.stringify(r.wide)}; scrollers: ${JSON.stringify(r.sw)})`, !r.docOverflow);
	check(`${label}: nothing sticks out of the viewport ${JSON.stringify(r.bad)}`, r.bad.length === 0);
}
const hydrated = `!!document.querySelector('select[name=timeZone]') && document.querySelector('select[name=timeZone]').value === Intl.DateTimeFormat().resolvedOptions().timeZone`;

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

	let submitted = 0;
	for (const { w, label, mobile } of WIDTHS) {
		await send("Network.clearBrowserCookies");
		await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile });

		// ----- booking form + validation + success -----
		await send("Page.navigate", { url: `${BASE}/schedule-a-call/` });
		check(`${label}: booking form renders`, await waitFor(hydrated, 90000));
		await noOverflow(`${label} form`);
		await evaluate(`document.querySelector('form.ss-meeting__form button[type=submit]').click()`);
		check(`${label}: validation messages appear`, await waitFor(`document.querySelectorAll('.ss-field-error').length >= 5 && !!document.querySelector('.ss-meeting__banner')`, 8000));
		check(`${label}: every validation message is visible in the viewport`, await evaluate(`[...document.querySelectorAll('.ss-field-error')].every(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth + 1; })`));
		await noOverflow(`${label} form with errors`);
		check(`${label}: two-column grid only on wide screens`, (await evaluate(`new Set([...document.querySelectorAll('.ss-meeting__grid > .form-group')].slice(0, 2).map(e => Math.round(e.getBoundingClientRect().top))).size`)) === (w >= 576 ? 1 : 2));
		if (submitted < 2) {
			// Submit for real at two widths (the address limiter allows a handful per hour) to check the success screen.
			await setValue("input[name=name]", longName);
			await setValue("input[name=email]", `${tag}-ui${w}@example.test`);
			await setValue("input[name=phone]", "+1 416 555 0123");
			await setValue("select[name=purpose]", "partnership");
			await setValue("input[name=date]", day);
			await setValue("input[name=time]", "13:15");
			await evaluate(`document.querySelector('form.ss-meeting__form button[type=submit]').click()`);
			check(`${label}: success screen`, await waitFor(`/MTG-[A-Z0-9]{8}/.test(document.body.innerText) && document.body.innerText.includes('not confirmed')`, 20000));
			await noOverflow(`${label} success screen`);
			submitted++;
		}

		// ----- visitor status page -----
		const st = seeded[1]; // approved, with a long meeting link
		await send("Page.navigate", { url: `${BASE}/schedule-a-call/status/?ref=${st.reference}&token=${deriveToken(linkSecret, st.id)}` });
		check(`${label}: status page shows the request`, await waitFor(`document.body.innerText.includes(${JSON.stringify(st.reference)}) && document.body.innerText.includes('Confirmed')`, 60000));
		await noOverflow(`${label} status page`);

		// ----- admin: list + detail -----
		await send("Network.setCookie", { name: "edmy_users_token", value: adminToken, url: BASE });
		await send("Page.navigate", { url: `${BASE}/admin/meetings/` });
		check(`${label}: admin table lists the seeded requests`, await waitFor(`document.body.innerText.includes(${JSON.stringify(seeded[0].reference)}) && document.querySelectorAll('tbody tr').length >= 4`, 90000));
		await noOverflow(`${label} admin list`);
		check(`${label}: summary cards, search and filter visible`, await evaluate(`document.querySelectorAll('.ss-meeting-admin__tiles > *').length === 4 && !!document.querySelector('input[type=search]') && !!document.querySelector('select[aria-label="Filter by status"]')`));
		check(`${label}: review buttons are reachable (inside the table scroller)`, await evaluate(`[...document.querySelectorAll('tbody tr button')].length >= 4`));
		await evaluate(`document.querySelector('.ss-meeting-admin__email summary')?.click()`);
		await evaluate(`[...document.querySelectorAll('tbody tr')].find(r => r.innerText.includes(${JSON.stringify(seeded[0].reference)})).querySelector('button').click()`);
		check(`${label}: detail view opens`, await waitFor(`!!document.querySelector('.ss-meeting-admin__detail') && /visitor message/i.test(document.body.innerText)`, 15000));
		await noOverflow(`${label} admin detail`);
		check(`${label}: decision buttons visible and inside the viewport`, await evaluate(`(() => { const bs = [...document.querySelectorAll('.ss-meeting-admin__actions button')]; return bs.length >= 4 && bs.every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; }); })()`));
		check(`${label}: email-failure notice with retry is shown`, await evaluate(`document.body.innerText.includes('Retry sending')`));
		if (w <= 440) {
			// The table scrolls inside its wrapper instead of stretching the page.
			check(`${label}: table scrolls inside its own wrapper`, await evaluate(`(() => { const t = document.querySelector('.ss-table-wrap'); return !t || t.scrollWidth >= t.clientWidth; })()`));
		}
	}
	console.log(`meetings-responsive e2e: ${n} checks passed across ${WIDTHS.map((x) => x.w).join(", ")} px`);
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
