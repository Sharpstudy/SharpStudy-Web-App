// Renders pages in headless Chrome AFTER hydration and reports what a person would see: navigation links, page width and every visible
// element that sticks out of the viewport (the closed navigation drawer and horizontally scrollable wrappers are not counted).
//
//   node tests/e2e-pg/browser-probe.mjs <baseUrl> <secret> <fixtures.json> <outDir> <spec> [spec ...]
//   spec = <who>:<path>:<widths>[:<shotName>]   who = student | instructor | admin | anon | <user-id>   widths = 390,440,768
//
// Prints one JSON line per page view. Screenshots (PNG) go to <outDir>.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import jwt from "jsonwebtoken";

const [, , BASE, secret, fxFile, outDir, ...specs] = process.argv;
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error("localhost only");
const fx = JSON.parse(fs.readFileSync(fxFile, "utf8"));
fs.mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.PROBE_PORT || 9351);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ss-probe-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
	const id = ++seq;
	pending.set(id, { resolve, reject });
	ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
let targets;
for (let i = 0; i < 60 && !targets; i++) {
	try {
		targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
	} catch {
		await sleep(500);
	}
}
ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => {
	const msg = JSON.parse(m.data);
	if (msg.id && pending.has(msg.id)) {
		const p = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
	}
};
await send("Page.enable");
await send("Network.enable");

const MEASURE = (ref) => `(() => {
	const vw = ${ref} || window.innerWidth; // __REF__: the width the page SHOULD fit (a page wider than the phone makes the browser enlarge the layout viewport, so innerWidth would hide the overflow)
	const inScrollable = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true; } return false; };
	const hidden = (el) => !!el.closest('.ss-drawer, .ss-drawer-backdrop, [aria-hidden=true], .visually-hidden');
	const out = [];
	for (const el of document.querySelectorAll('body *')) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none' || hidden(el) || inScrollable(el)) continue;
		if (r.right > vw + 1 || r.left < -1) out.push({ r: Math.round(r.right), w: Math.round(r.width), el: el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.') + (el.innerText ? ' "' + el.innerText.trim().slice(0, 28).replace(/\\s+/g, ' ') + '"' : '') });
	}
	out.sort((a, b) => b.r - a.r);
	const links = (sel) => [...document.querySelectorAll(sel + ' a')].map((a) => (a.textContent || '').trim()).filter(Boolean);
	return { innerWidth: vw, scrollWidth: document.documentElement.scrollWidth, path: location.pathname, navbar: !!document.querySelector('#navbar, header.ss-header, header'), headerLinks: [...new Set(links('header'))].slice(0, 14), drawerLinks: [...new Set(links('.ss-drawer'))].slice(0, 16), buttons: [...document.querySelectorAll('header button, .ss-drawer button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 6), offenders: out.slice(0, 6), textLen: document.body.innerText.length };
})()`;

const who = (name) => (name === "anon" ? null : ["student", "instructor", "admin"].includes(name) ? fx[name] : { id: name, role: "student", email: "x@example.test" });
const results = [];
for (const spec of specs) {
	const [w, p, widths, shot] = spec.split("::");
	for (const width of widths.split(",").map(Number)) {
		await send("Network.clearBrowserCookies");
		const u = w.length > 12 ? fx.byId?.[w] || { id: w, role: process.env.PROBE_ROLE || "student", email: process.env.PROBE_EMAIL || "x@example.test" } : who(w);
		if (u) await send("Network.setCookie", { name: "edmy_users_token", value: jwt.sign({ userId: u.id, role: u.role, email: u.email }, secret, { expiresIn: "30m" }), url: BASE });
		await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
		await send("Page.navigate", { url: BASE + p });
		for (let i = 0; i < 100; i++) {
			await sleep(250);
			if (await evaluate("document.readyState === 'complete'").catch(() => false)) break;
		}
		await sleep(Number(process.env.PROBE_SETTLE || 5000)); // data fetches + dev-mode hydration
		const m = await evaluate(MEASURE(width < 1000 ? width : 0)).catch((e) => ({ error: e.message }));
		if (process.env.PROBE_EXTRA) console.log("EXTRA", JSON.stringify(await evaluate(process.env.PROBE_EXTRA).catch((e) => e.message)));
		if (shot) {
			const png = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
			fs.writeFileSync(path.join(outDir, `${shot}-${width}.png`), Buffer.from(png.data, "base64"));
		}
		const row = { who: w.length > 12 ? w.slice(0, 8) : w, page: p, width, ...m };
		results.push(row);
		console.log(JSON.stringify(row));
	}
}
ws.close();
chrome.kill();
await sleep(500);
try {
	fs.rmSync(profile, { recursive: true, force: true });
} catch {
	/* ignore */
}
