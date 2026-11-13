// Real-browser check (headless Chrome over the DevTools protocol) that the live
// class page mounts exactly ONE Jitsi iframe, in development mode where React
// StrictMode runs effects twice, and that the Live Questions panel still works
// next to it. Needs: a running dev server, Chrome, and internet access to
// meet.jit.si (the Jitsi script). Camera/microphone are faked by Chrome flags;
// no one joins a real meeting beyond opening the room. localhost only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;

const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT });
const [users] = await db.query("SELECT id, role, email FROM users WHERE status = 1 OR status IS NULL ORDER BY created_at");
const teacher = users.find((u) => u.role === "instructor");
const student = users.find((u) => u.role === "student");
const [[cat]] = await db.query("SELECT id FROM categories LIMIT 1");
const tag = `zz-e2e-jitsi-${Date.now()}`;
const courseId = randomUUID();
await db.query("INSERT INTO courses (id, title, slug, userId, catId, approved, is_class, latest_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, 0, NOW(), NOW())", [courseId, tag, tag, teacher.id, cat.id]);
await db.query("INSERT INTO enrolments (id, userId, courseId, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())", [randomUUID(), student.id, courseId]);
const token = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email, first_name: "Test" }, process.env.JWT_SECRET, { expiresIn: "10m" });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ss-chrome-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--disable-gpu", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--window-size=1366,900", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
	for (let i = 0; i < 50; i++) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
			const page = list.find((t) => t.type === "page");
			if (page) return page.webSocketDebuggerUrl;
		} catch (e) {
			/* not up yet */
		}
		await sleep(200);
	}
	throw new Error("Chrome did not start");
}
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
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
	return r.result.value;
};
const waitFor = async (expression, ms = 30000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await evaluate(expression).catch(() => false)) return true;
		await sleep(300);
	}
	return false;
};

let n = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	n++;
};

async function openClass(user, label) {
	await send("Network.setCookie", { name: "edmy_users_token", value: token(user), url: BASE });
	await send("Page.navigate", { url: `${BASE}/learning/course/class/${tag}/` });
	const formShown = await waitFor(`!!document.querySelector('form.ss-live button[type=submit]')`, 90000);
	if (!formShown) console.log(`debug ${label}:`, await evaluate(`location.href + ' | ' + document.body.innerText.slice(0, 300)`));
	check(`${label}: class page shows the join form`, formShown);
	// The form is server-rendered before React hydrates; keep clicking until the click is handled.
	let appeared = false;
	for (let i = 0; i < 40 && !appeared; i++) {
		await evaluate(`document.querySelector('form.ss-live button[type=submit]')?.click()`);
		appeared = await waitFor(`!!document.querySelector('[data-jitsi-container]')`, 1500);
	}
	check(`${label}: meeting container appears`, appeared);
}

try {
	ws = new WebSocket(await connect());
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
	await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

	// ---- instructor ----
	await openClass(teacher, "instructor");
	const loaded = await waitFor(`document.querySelectorAll('[data-jitsi-container] iframe').length >= 1`, 45000);
	if (!loaded) {
		console.log("SKIPPED: Jitsi's iframe never appeared (is meet.jit.si reachable from this machine?)");
		console.log("status:", await evaluate(`document.querySelector('.ss-jitsi')?.innerText`));
	} else {
		await sleep(4000); // give a second (duplicate) instance every chance to appear
		check("exactly ONE iframe on the whole page", (await evaluate(`document.querySelectorAll('iframe').length`)) === 1);
		check("exactly one Jitsi container, holding one iframe", (await evaluate(`document.querySelectorAll('[data-jitsi-container]').length`)) === 1 && (await evaluate(`document.querySelectorAll('[data-jitsi-container] iframe').length`)) === 1);
		check("the iframe points at the course room on meet.jit.si", (await evaluate(`document.querySelector('iframe').src`)).includes(`meet.jit.si/${tag}`));
		check("no leftover duplicate containers (old react-jutsu id)", (await evaluate(`document.querySelectorAll('#jitsi-container').length`)) === 0);
		const rect = JSON.parse(await evaluate(`JSON.stringify(((a,b)=>({v:a.getBoundingClientRect().toJSON(),q:b.getBoundingClientRect().toJSON()}))(document.querySelector('.ss-live-room__video'),document.querySelector('.ss-lq')))`));
		check("desktop: meeting on the left, Live Questions on the right, side by side", rect.q.left >= rect.v.right - 1 && Math.abs(rect.q.top - rect.v.top) < 120);
		check("desktop: meeting is the larger column", rect.v.width > rect.q.width * 2);
	}
	check("Live Questions panel is present beside the video (instructor controls)", await waitFor(`document.body.innerText.includes('Ask a question')`, 20000));
	await evaluate(`[...document.querySelectorAll('button')].find(b=>/Review saved results/.test(b.innerText)).click()`);
	check("saved results can be reviewed", await waitFor(`document.body.innerText.includes('Saved results')`, 10000));
	await evaluate(`[...document.querySelectorAll('button')].find(b=>/Ask a question/.test(b.innerText)).click()`);
	check("composer opens without touching the video", (await waitFor(`!!document.querySelector('#lq-text')`)) && (!loaded || (await evaluate(`document.querySelectorAll('iframe').length`)) === 1));

	// ---- narrow viewport: stacked ----
	await send("Emulation.setDeviceMetricsOverride", { width: 600, height: 900, deviceScaleFactor: 1, mobile: true });
	await sleep(800);
	const m = JSON.parse(await evaluate(`JSON.stringify(((a,b)=>({v:a.getBoundingClientRect().toJSON(),q:b.getBoundingClientRect().toJSON()}))(document.querySelector('.ss-live-room__video'),document.querySelector('.ss-lq')))`));
	check("mobile: Live Questions stacked under the meeting, both full width", m.q.top >= m.v.bottom - 1 && m.v.width > 500 && m.q.width > 500);
	if (loaded) check("mobile: still exactly one iframe", (await evaluate(`document.querySelectorAll('iframe').length`)) === 1);

	// ---- student sees the panel without instructor controls ----
	await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
	await send("Network.clearBrowserCookies");
	await openClass(student, "student");
	check("student: panel shows the waiting state, no instructor controls", (await waitFor(`document.body.innerText.includes('No question yet')`, 20000)) && !(await evaluate(`document.body.innerText.includes('Ask a question')`)));
	if (loaded) {
		await sleep(3000);
		check("student: exactly one iframe", (await evaluate(`document.querySelectorAll('iframe').length`)) === 1);
	}
	console.log(`jitsi-single e2e: ${n} checks passed${loaded ? "" : " (iframe checks SKIPPED: no access to meet.jit.si)"}`);
} finally {
	try {
		ws && ws.close();
	} catch (e) {
		/* ignore */
	}
	chrome.kill();
	await sleep(500);
	await db.query("DELETE FROM courses WHERE id = ?", [courseId]);
	await db.end();
	try {
		fs.rmSync(profile, { recursive: true, force: true });
	} catch (e) {
		/* chrome may still hold files */
	}
}
