// Does a layout finding depend on the database? Opens the same pages, for every real active account, at 390 px in headless Chrome on the
// PostgreSQL test instance AND on the read-only MySQL instance and compares the page width (scrollWidth) of each.
//   node tests/e2e-pg/overflow-compare.mjs <state.json> <secretPg> <secretMy> [path ...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import jwt from "jsonwebtoken";
import pg from "pg";

const [, , stateFile, secretPg, secretMy, ...pagesArg] = process.argv;
const PAGES = pagesArg.length ? pagesArg : ["/family/", "/study/", "/learning/my-courses/"];
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const db = new pg.Client({ host: "localhost", database: "sharpstudy_dev", user: "sharpstudy_dev", options: `-c search_path=${state.schema} -c default_transaction_read_only=on` });
await db.connect();
const familyOnly = process.env.ONLY_FAMILY ? "and (id in (select owner_user_id from ml_learners) or id in (select user_id from ml_learner_guardians) or id in (select student_user_id from ml_learners where student_user_id is not null))" : "";
const users = (await db.query(`select id, role, email from users where (status = true or status is null) and email not like '%@example.test' and role <> 'admin' ${familyOnly} order by role, id`)).rows;
await db.end();

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9343;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ovf-"));
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
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

const sides = { PostgreSQL: { base: "http://localhost:3001", secret: secretPg }, MySQL: { base: "http://localhost:3002", secret: secretMy } };
let same = 0, differ = 0, wide = 0;
const lines = [];
for (const pagePath of PAGES) {
	for (const u of users) {
		const out = {};
		for (const [name, s] of Object.entries(sides)) {
			await send("Network.clearBrowserCookies");
			await send("Network.setCookie", { name: "edmy_users_token", value: jwt.sign({ userId: u.id, role: u.role, email: u.email }, s.secret, { expiresIn: "30m" }), url: s.base });
			await send("Page.navigate", { url: s.base + pagePath });
			for (let i = 0; i < 80; i++) {
				await sleep(250);
				if (await evaluate("document.readyState === 'complete'").catch(() => false)) break;
			}
			await sleep(1200);
			out[name] = await evaluate("document.documentElement.scrollWidth + '/' + window.innerWidth + ' ' + location.pathname").catch(() => "error");
			if (process.env.DETAIL && u.id.startsWith(process.env.DETAIL)) console.log('   widest on', name, await evaluate("[...document.querySelectorAll('body *')].map((e) => [e.getBoundingClientRect().right, e.tagName + '.' + String(e.className).slice(0, 45) + ' \"' + (e.innerText || '').slice(0, 30).replace(/\s+/g, ' ') + '\"']).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => Math.round(x[0]) + ' ' + x[1]).join(' || ')"));
		}
		const equal = out.PostgreSQL === out.MySQL;
		equal ? same++ : differ++;
		const w = Number(out.PostgreSQL.split("/")[0]) > 391;
		if (w) wide++;
		if (!equal || w) lines.push(`${pagePath.padEnd(24)} ${u.role.padEnd(10)} ${u.id.slice(0, 8)}  PostgreSQL ${out.PostgreSQL} | MySQL ${out.MySQL}${equal ? "" : "   <-- DIFFERENT"}`);
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
console.log(lines.join("\n") || "no page is wider than the phone viewport on either server");
console.log(`\n${PAGES.length * users.length} page loads per server (${users.length} real non-admin accounts x ${PAGES.length} pages): identical width on both servers ${same}, different ${differ}; pages wider than the 390 px viewport on PostgreSQL: ${wide}`);
