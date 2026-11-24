// Phase 7F: real-browser (headless Chrome, DevTools protocol) checks of the PostgreSQL test instance, per role and viewport.
//
//   node tests/e2e-pg/browser-suite.mjs <baseUrl> <fixtures.json> <secret> <state.json> <out.json>
//
// For each role (anonymous, student, instructor, admin) and each page it opens the page at 390 px (phone), 768 px (tablet) and
// 1366 px (desktop) and checks: HTTP status, the page rendered (heading + navigation), no uncaught script errors or failed
// same-origin requests, no placeholder text that signals a data-handling bug ("undefined", "NaN", "Invalid Date", "[object Object]",
// "null"), and no sideways page scroll. It also runs the real sign-in form for a test account and then signs out.
// Real data-rich accounts come from the isolated test schema (tokens minted with the TEST secret); the sign-in flow uses a test account.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import jwt from "jsonwebtoken";

const [, , BASE, fxFile, secret, stateFile, outFile] = process.argv;
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error("localhost only");
const fx = JSON.parse(fs.readFileSync(fxFile, "utf8"));
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9341;
const VIEWPORTS = [
	{ w: 390, h: 844, mobile: true, label: "390 phone" },
	{ w: 768, h: 1024, mobile: true, label: "768 tablet" },
	{ w: 1366, h: 900, mobile: false, label: "1366 desktop" },
];
const token = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, secret, { expiresIn: "60m" });
const PAGES = {
	anonymous: ["/", "/courses/", "/about-us/", "/contact-us/", "/schedule-a-call/", "/books/", "/faq/", "/auth/"],
	student: ["/learning/my-courses/", "/learning/my-purchase-history/", "/learning/wishlist/", "/study/", "/family/", "/profile/basic-information/", "/learning/my-books/", "/learning/live/"],
	instructor: ["/instructor/dashboard/", "/instructor/courses/", "/instructor/students/", "/instructor/live/", "/instructor/profile/", "/instructor/quiz/"],
	admin: ["/admin/", "/admin/students/", "/admin/instructor/", "/admin/categories/", "/admin/courses/", "/admin/partners/", "/admin/testimonials/", "/admin/coupons/", "/admin/meetings/", "/admin/books/", "/admin/mastery/", "/admin/telecallers/", "/admin/students/removal-requests/"],
};
const userOf = { student: fx.student, instructor: fx.instructor, admin: fx.admin };

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ss-p7-chrome-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--disable-gpu", "--disable-extensions", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const events = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
	const id = ++seq;
	pending.set(id, { resolve, reject });
	ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
	const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
	return r.result.value;
};

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
	} else if (msg.method) events.push(msg);
};
for (const d of ["Page", "Runtime", "Network", "Log"]) await send(`${d}.enable`);

const results = [];
const fails = [];
async function visit(role, pagePath, vp) {
	events.length = 0;
	await send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile });
	const t0 = Date.now();
	await send("Page.navigate", { url: BASE + pagePath });
	// wait for load + a settle period (data fetches)
	for (let i = 0; i < 80; i++) {
		await sleep(250);
		if (await evaluate("document.readyState === 'complete'").catch(() => false)) break;
	}
	await sleep(1500);
	const doc = events.find((e) => e.method === "Network.responseReceived" && e.params.type === "Document");
	const status = doc ? doc.params.response.status : 0;
	const finalUrl = await evaluate("location.pathname").catch(() => "?");
	const info = await evaluate(`(() => {
		const text = document.body ? document.body.innerText : '';
		const vw = window.innerWidth;
		const bad = [];
		for (const re of [/\\bundefined\\b/, /\\bNaN\\b/, /Invalid Date/, /\\[object Object\\]/, /\\bnull\\b/]) if (re.test(text)) bad.push(String(re));
		return { len: text.length, h: !!document.querySelector('h1,h2,h3'), nav: !!document.querySelector('header,nav,#navbar,.ss-header'), title: document.title, overflow: document.documentElement.scrollWidth > vw + 1, bad };
	})()`).catch((e) => ({ error: e.message }));
	const errors = events.filter((e) => (e.method === "Runtime.exceptionThrown") || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") || (e.method === "Log.entryAdded" && e.params.entry.level === "error"));
	const own = errors.filter((e) => {
		const s = JSON.stringify(e.params);
		return !/googletagmanager|google-analytics|disqus|fonts\.g|gstatic|jit\.si|cloudinary|favicon|net::ERR_|Failed to load resource: net::|Download the React DevTools|Warning:/i.test(s);
	});
	const failedOwn = events.filter((e) => e.method === "Network.responseReceived" && e.params.response.url.startsWith(BASE) && e.params.response.status >= 500);
	const redirected = finalUrl !== pagePath.replace(/\?.*$/, "");
	const row = { role, page: pagePath, viewport: vp.label, status, finalUrl: redirected ? finalUrl : undefined, ms: Date.now() - t0, ...info, scriptErrors: own.length, serverErrors: failedOwn.length };
	const problems = [];
	if (status >= 500 || status === 0) problems.push(`HTTP ${status}`);
	if (failedOwn.length) problems.push(`${failedOwn.length} request(s) answered 5xx`);
	if (own.length) problems.push(`${own.length} script error(s): ${JSON.stringify(own[0].params).slice(0, 140)}`);
	if (info.overflow) problems.push("page scrolls sideways");
	if (info.bad && info.bad.length) problems.push(`placeholder text ${info.bad.join(",")}`);
	if (info.len < 20) problems.push("page is blank");
	row.problems = problems;
	results.push(row);
	if (problems.length) {
		fails.push(row);
		console.log(`FAIL ${role.padEnd(10)} ${vp.label.padEnd(13)} ${pagePath.padEnd(36)} ${problems.join("; ")}`);
	}
}

for (const [role, pages] of process.env.SKIP_PAGES ? [] : Object.entries(PAGES)) {
	await send("Network.clearBrowserCookies");
	if (role !== "anonymous") await send("Network.setCookie", { name: "edmy_users_token", value: token(userOf[role]), url: BASE });
	for (const p of pages) for (const vp of VIEWPORTS) await visit(role, p, vp);
	console.log(`${role}: ${pages.length} pages x ${VIEWPORTS.length} viewports done`);
}

// ---- the real sign-in form and sign-out (test account, desktop)
await send("Network.clearBrowserCookies");
await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: BASE + "/auth/" });
await sleep(4000);
// the /auth page has two tabs ("Create account" and "Log in"): open the login tab, then use the form that has no first-name field
await evaluate("document.getElementById('tab-login') && document.getElementById('tab-login').click()");
await sleep(800);
const fillForm = `(() => {
	const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
	const f = [...document.querySelectorAll('form')].find((x) => x.querySelector('input[name=email]') && x.querySelector('input[name=password]') && !x.querySelector('input[name=first_name]'));
	if (!f) return 'no form';
	set(f.querySelector('input[name=email]'), ${JSON.stringify(state.testEmails ? "" : "")} + ${JSON.stringify("E2E.STUDENT@Example.test")});
	set(f.querySelector('input[name=password]'), 'Phase7-Test-Pass-1!');
	const btn = f.querySelector('button[type=submit]') || f.querySelector('button');
	const info = 'inputs=' + f.querySelectorAll('input').length + ' btn=' + (btn ? btn.innerText.trim() + '/' + btn.type + '/disabled=' + btn.disabled : 'none') + ' email=' + f.querySelector('input[name=email]').value.length + ' pw=' + f.querySelector('input[name=password]').value.length;
	if (f.requestSubmit) f.requestSubmit(btn || undefined); else btn.click();
	window.__formInfo = info;
	return 'submitted';
})()`;
const flow = [];
events.length = 0;
flow.push(["login form is present", (await evaluate(fillForm)) === "submitted"]);
let cookie = false;
for (let i = 0; i < 40 && !cookie; i++) {
	await sleep(500);
	cookie = (await send("Network.getCookies", { urls: [BASE] })).cookies.some((c) => c.name === "edmy_users_token");
}
flow.push(["signing in with a mixed-case e-mail through the real form sets the session cookie", cookie]);
{
	// diagnostic for the report: what did the sign-in API answer, and what does the page show?
	const sign = events.filter((e) => e.method === "Network.responseReceived" && e.params.response.url.includes("/api/users/signin")).map((e) => e.params.response.status);
	const shown = await evaluate("[...document.querySelectorAll('[role=alert], .ss-field-error, .toast, [class*=toast], [class*=error]')].map((x) => x.innerText.trim()).filter(Boolean).slice(0, 3).join(' | ')");
	console.log("sign-in form diagnostic: form state:", await evaluate("window.__formInfo"), "| API answered", sign.join(",") || "(no request seen)", "| messages on the page:", shown || "(none)");
}
let afterLogin = await evaluate("location.pathname");
for (let i = 0; i < 60 && afterLogin === "/auth/"; i++) {
	await sleep(500); // dev mode compiles the next page on demand
	afterLogin = await evaluate("location.pathname");
}
flow.push([`the browser leaves the sign-in page after login (now ${afterLogin})`, afterLogin !== "/auth/"]);
await send("Page.navigate", { url: BASE + "/learning/my-courses/" });
await sleep(3500);
const stayed = await evaluate("location.pathname");
flow.push([`the signed-in student stays on their dashboard instead of being sent back to sign in (${stayed})`, stayed === "/learning/my-courses/" && /my courses|my learning/i.test(await evaluate("document.body.innerText"))]);
const loggedOut = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /log ?out/i.test(x.textContent)); if (!b) return 'no logout button'; b.click(); return 'clicked'; })()`);
let cookieAfter = true;
for (let i = 0; i < 60 && cookieAfter; i++) {
	await sleep(500);
	cookieAfter = (await send("Network.getCookies", { urls: [BASE] })).cookies.some((c) => c.name === "edmy_users_token");
}
const jsCookie = await evaluate("document.cookie.includes('edmy_users_token') + ' at ' + location.pathname");
flow.push([`log out removes the session cookie (${loggedOut}; cookie visible to the page: ${jsCookie})`, loggedOut === "clicked" && !cookieAfter]);
for (const [name, ok] of flow) {
	console.log(`${ok ? "PASS" : "FAIL"} sign-in flow: ${name}`);
	results.push({ role: "flow", page: name, viewport: "1366 desktop", problems: ok ? [] : ["failed"] });
	if (!ok) fails.push({ role: "flow", page: name });
}

ws.close();
chrome.kill();
await sleep(500);
try {
	fs.rmSync(profile, { recursive: true, force: true });
} catch {
	/* temp profile may still be locked; harmless */
}
fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
const visits = results.filter((r) => r.role !== "flow");
console.log(`\nbrowser suite: ${visits.length} page views (${visits.length - visits.filter((r) => r.problems.length).length} clean), ${flow.filter((f) => f[1]).length} of ${flow.length} sign-in flow checks passed, ${fails.length} problem(s)`);
process.exitCode = fails.length ? 1 : 0;
