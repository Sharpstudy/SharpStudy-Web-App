// Visual check of the student-management screens in REAL headless Chrome/Edge (DevTools protocol, no extra
// dependency) against a RUNNING dev server and the dev database.
//   node tests/e2e/ui-visual.mjs seed            create temporary courses, students' profiles and assignments
//   node tests/e2e/ui-visual.mjs shoot <outDir>  screenshot every screen at 390/440/768/1024/1366 px and
//                                                measure horizontal overflow (exit code 1 on overflow)
//   node tests/e2e/ui-visual.mjs clean           remove ONLY what `seed` created
// State lives in <os tmp>/ss-ui-visual.json. Never prints secrets. localhost only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { generateSheet } from "../../lib/mastery/sheet.js";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("only against localhost");
const STATE = path.join(os.tmpdir(), "ss-ui-visual.json");
const mode = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT, timezone: "Z" });
const tok = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "2h" });
const call = async (method, p, { as, learner, body } = {}) => {
	const headers = { "Content-Type": "application/json" };
	if (as) headers.Authorization = tok(as);
	if (learner) headers["x-learner-token"] = learner;
	const res = await fetch(`${BASE}/api/${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	let json = null;
	try {
		json = await res.json();
	} catch (e) {
		/* empty */
	}
	return { status: res.status, json };
};
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);
const answers = (t, wrong = 0) => {
	const d = jwt.decode(t);
	return generateSheet(d.lv, d.set, d.ws, d.v).problems.map((p, i) => (i < wrong ? [p.answer.kind === "multi" ? p.answer.parts.map(() => "x") : "x", right(p)] : [right(p)]));
};
const WS = (n, set = "7A-1", level = "7A") => ({ subject: "math", levelId: level, setId: set, worksheetNo: n });

// ------------------------------------------------------------------ seed / clean
async function seed() {
	const [users] = await db.query("SELECT id, role, email, first_name, last_name FROM users WHERE status = 1 OR status IS NULL ORDER BY created_at");
	const instructors = users.filter((u) => u.role === "instructor");
	// Only students that have NO learner profile yet (never touch someone elses real data), newest accounts last.
	const [taken] = await db.query("SELECT student_user_id FROM ml_learners WHERE student_user_id IS NOT NULL");
	const students = users.filter((u) => u.role === "student" && !taken.some((t) => t.student_user_id === u.id)).reverse();
	if (instructors.length < 2 || students.length < 6) throw new Error("need 2 instructors and 6 students");
	const [teacher, parent] = instructors;
	const [s1, s2, s3, s4, s5, s6] = students;
	let [[cat]] = await db.query("SELECT id FROM categories LIMIT 1");
	const save = () => fs.writeFileSync(STATE, JSON.stringify(created));
	const created = { courses: [], learners: [], tempCat: null, teacher: teacher.id, parent: parent.id, students: [s1, s2, s3, s4, s5, s6].map((s) => s.id) };
	if (!cat) {
		created.tempCat = randomUUID();
		await db.query("INSERT INTO categories (id, category, slug, created_at, updated_at) VALUES (?, 'tmp-ui', 'tmp-ui', NOW(), NOW())", [created.tempCat]);
		cat = { id: created.tempCat };
	}
	const course = async (title) => {
		const id = randomUUID();
		await db.query("INSERT INTO courses (id, title, slug, userId, catId, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())", [id, title, `ui-${id.slice(0, 8)}`, teacher.id, cat.id]);
		created.courses.push(id);
		save();
		return id;
	};
	const A = await course("Foundations of Mathematics");
	const B = await course("Reading & Phonics for Early Learners");
	const C = await course("Science Explorers: Grade 6 Lab Skills and Investigations");
	const enrol = (u, c) => db.query("INSERT INTO enrolments (id, userId, courseId, status, created_at, updated_at) VALUES (?, ?, ?, 'paid', NOW(), NOW())", [randomUUID(), u.id, c]);
	for (const [u, cs] of [[s1, [A, B]], [s2, [A]], [s3, [A, B, C]], [s4, [B]], [s5, [C]], [s6, [A]]]) for (const c of cs) await enrol(u, c);
	// lessons so the course progress bars have something real to show

	const link = (body) => call("POST", "instructor/students/link/", { as: teacher, body });
	const mk = async (u, extra) => {
		const r = await link({ action: "create", studentUserId: u.id, pin: "4321", dailyGoal: 3, timeZone: "UTC", ...extra });
		if (r.status !== 201) throw new Error(`profile ${u.email}: ${JSON.stringify(r.json)}`);
		created.learners.push(r.json.learnerId);
		save();
		return r.json.learnerId;
	};
	const L1 = await mk(s1, { subjects: ["math", "english"], grade: "C3", age: 8 });
	const L2 = await mk(s2, { subjects: ["math"], grade: "UKG", age: 5 });
	const L3 = await mk(s3, { subjects: ["math", "english"], grade: "C6", age: 11 });
	const L5 = await mk(s5, { subjects: ["math"], grade: "C1", age: 6 });
	const walk = await call("POST", "mastery/learners/", { as: teacher, body: { displayName: "Leo (walk-in)", pin: "4321", subjects: ["math"], timeZone: "UTC", grade: "LKG", age: 4, avatar: "🦊" } });
	created.learners.push(walk.json.learner.id);
	save();

	const pub = async (learnerIds, extra) => {
		const r = (await call("POST", "mastery/assignments/", { as: teacher, body: { ...WS(1), learnerIds, ...extra } })).json;
		if (!r.assignmentId) throw new Error("assignment: " + JSON.stringify(r));
		return r;
	};
	const day = 86400000;
	const done = await pub([L1, L3], { title: "Counting to 10: practice sheet", courseId: A, dueAt: new Date(Date.now() + 2 * day).toISOString(), instructions: "Take your time and use your fingers if it helps." });
	const prog = await pub([L1], { ...WS(2), title: "Counting to 10: practice sheet 2", courseId: A, dueAt: new Date(Date.now() + 3 * day).toISOString() });
	const od = await pub([L1], { ...WS(3), title: "Count dots to 5: warm-up", courseId: A, dueAt: new Date(Date.now() + 1500).toISOString() });
	const pend = await pub([L2], { ...WS(1), title: "Count dots to 5", courseId: A, dueAt: new Date(Date.now() + 5 * day).toISOString() });
	await pub([L3], { ...WS(2), title: "Count dots to 10: ten-frames", dueAt: new Date(Date.now() + 4 * day).toISOString() });
	created.assignments = [done.assignmentId, prog.assignmentId, od.assignmentId, pend.assignmentId];

	// students do real work through the real API
	const unlock = async (u, lid) => (await call("POST", `mastery/learners/${lid}/unlock/`, { as: u, body: { pin: "4321" } })).json.learnerToken;
	const t1 = await unlock(s1, L1);
	const t3 = await unlock(s3, L3);
	created.tokens = { s1: t1, s3: t3 };
	const finish = async (u, t, aid, wrong) => {
		const st = await call("POST", "mastery/study/start/", { as: u, learner: t, body: { assignmentId: aid } });
		return call("POST", "mastery/study/submit/", { as: u, learner: t, body: { startToken: st.json.startToken, clientAttemptId: `ui-${randomUUID().slice(0, 12)}`, responses: answers(st.json.startToken, wrong), durationMs: 95000 } });
	};
	await finish(s1, t1, done.assignmentId, 2);
	await finish(s3, t3, done.assignmentId, 0);
	await call("POST", "mastery/study/start/", { as: s1, learner: t1, body: { assignmentId: prog.assignmentId } });
	await new Promise((r) => setTimeout(r, 2000)); // let the 'overdue' one pass its due time

	// a family: the other instructor's child, taught by the teacher
	const kid = await call("POST", "mastery/learners/", { as: parent, body: { displayName: "Meera", pin: "4321", subjects: ["math"], timeZone: "UTC", grade: "C2", age: 7, avatar: "🐼", dailyGoal: 2 } });
	created.learners.push(kid.json.learner.id);
	save();
	await call("POST", `mastery/learners/${kid.json.learner.id}/guardians/`, { as: parent, body: { email: teacher.email, relation: "instructor" } });
	const fam = await pub([kid.json.learner.id], { title: "Count dots to 5 (family)", dueAt: new Date(Date.now() + 2 * day).toISOString() });
	created.family = { learnerId: kid.json.learner.id, assignmentId: fam.assignmentId };
	const kt = await call("POST", `mastery/learners/${kid.json.learner.id}/unlock/`, { as: parent, body: { pin: "4321" } });
	await finish(parent, kt.json.learnerToken, fam.assignmentId, 1);
	created.s1 = { id: s1.id, learnerId: L1 };
	created.s4 = s4.id;
	fs.writeFileSync(STATE, JSON.stringify(created));
	console.log("seeded", created.learners.length, "learners,", created.assignments.length + 3, "assignments");
}

async function clean() {
	if (!fs.existsSync(STATE)) return console.log("nothing to clean");
	const c = JSON.parse(fs.readFileSync(STATE, "utf8"));
	if (c.learners.length) {
		const [as] = await db.query("SELECT DISTINCT assignment_id FROM ml_assignment_targets WHERE learner_id IN (?)", [c.learners]);
		const ids = as.map((r) => r.assignment_id);
		if (ids.length) {
			await db.query("DELETE FROM notifications WHERE ref_id IN (?)", [ids]);
			await db.query("DELETE FROM ml_assignments WHERE id IN (?)", [ids]);
		}
		await db.query("DELETE FROM ml_learners WHERE id IN (?)", [c.learners]);
	}
	if (c.courses.length) await db.query("DELETE FROM courses WHERE id IN (?)", [c.courses]);
	if (c.tempCat) await db.query("DELETE FROM categories WHERE id = ?", [c.tempCat]);
	fs.rmSync(STATE);
	console.log("cleaned");
}

// ------------------------------------------------------------------ headless browser (CDP)
function findBrowser() {
	for (const p of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]) if (fs.existsSync(p)) return p;
	throw new Error("no Chrome/Edge found");
}
async function launch() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-chrome-"));
	const port = 9333;
	const proc = spawn(findBrowser(), [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
	for (let i = 0; i < 50; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
			const t = await r.json();
			const ws = new WebSocket(t.webSocketDebuggerUrl);
			await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
			let id = 0;
			const waits = new Map();
			ws.onmessage = (m) => {
				const d = JSON.parse(m.data);
				if (d.id && waits.has(d.id)) (waits.get(d.id)(d), waits.delete(d.id));
			};
			const send = (method, params = {}) =>
				new Promise((res, rej) => {
					const n = ++id;
					waits.set(n, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)));
					ws.send(JSON.stringify({ id: n, method, params }));
				});
			return { send, close: () => (ws.close(), proc.kill()) };
		} catch (e) {
			await sleep(300);
		}
	}
	proc.kill();
	throw new Error("could not start the browser");
}

async function shoot(outDir) {
	const c = JSON.parse(fs.readFileSync(STATE, "utf8"));
	fs.mkdirSync(outDir, { recursive: true });
	const [[teacher]] = await db.query("SELECT id, role, email FROM users WHERE id = ?", [c.teacher]);
	const [[parent]] = await db.query("SELECT id, role, email FROM users WHERE id = ?", [c.parent]);
	const [[s1]] = await db.query("SELECT id, role, email FROM users WHERE id = ?", [c.s1.id]);
	const br = await launch();
	const { send } = br;
	await send("Page.enable");
	await send("Network.enable");
	await send("Runtime.enable");
	const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
	const widths = [390, 440, 768, 1024, 1366];
	const problems = [];
	const setAuth = async (u) => {
		await send("Network.clearBrowserCookies");
		await send("Network.setCookie", { name: "edmy_users_token", value: tok(u), url: BASE });
	};
	const waitFor = async (sel, ms = 20000) => {
		const t0 = Date.now();
		while (Date.now() - t0 < ms) {
			if (await ev(`!!document.querySelector(${JSON.stringify(sel)})`)) return true;
			await sleep(250);
		}
		return false;
	};
	const clickText = (text, scope = "document") =>
		ev(`(() => { const els = [...${scope}.querySelectorAll('button, a')].filter((b) => b.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}) && b.offsetParent !== null && !b.disabled); if (!els.length) return false; els[0].click(); return true; })()`);
	const measure = (label) =>
		ev(`(() => { const cw = document.documentElement.clientWidth; const bad = []; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width && r.right > cw + 1 && getComputedStyle(e).position !== 'fixed') { let p = e.parentElement, clipped = false; while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { clipped = true; break; } p = p.parentElement; } if (!clipped) bad.push((e.tagName + '.' + String(e.className).split(' ')[0]).slice(0, 60)); } } return { scrollWidth: document.documentElement.scrollWidth, clientWidth: cw, bad: [...new Set(bad)].slice(0, 6) }; })()`).then((m) => {
			if (m.scrollWidth > m.clientWidth + 1 || m.bad.length) problems.push({ label, ...m });
			return m;
		});
	const snap = async (name, w) => {
		const m = await send("Page.getLayoutMetrics");
		const h = Math.min(Math.ceil(m.cssContentSize.height), 5200);
		const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
		fs.writeFileSync(path.join(outDir, `${name}-${w}.png`), Buffer.from(r.data, "base64"));
	};
	const open = async (url, w, auth, ready, extra = "") => {
		await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
		await setAuth(auth);
		if (extra) {
			await send("Page.addScriptToEvaluateOnNewDocument", { source: extra });
		}
		await send("Page.navigate", { url: BASE + url });
		const ok = await waitFor(ready);
		await sleep(1200);
		return ok;
	};

	for (const w of widths) {
		// 1. directory
		let ok = await open("/instructor/students/", w, teacher, ".sd table tbody tr, .sd-cards li");
		if (!ok) problems.push({ label: `directory ${w}: did not render` });
		await measure(`directory ${w}`);
		await snap("1-directory", w);
		// 2. details
		await clickText("view details");
		await waitFor(".sd-detail");
		await sleep(1500);
		await measure(`details ${w}`);
		await snap("2-details", w);
		// 3. onboarding for a student without a profile
		await open("/instructor/students/?q=" + encodeURIComponent(""), w, teacher, ".sd table tbody tr, .sd-cards li");
		await ev(`(() => { const f = document.querySelector('#sd-status'); if (!f) return; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(f, 'no_profile'); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
		await sleep(1200);
		await clickText("set up profile");
		await waitFor(".sd-onboard");
		await sleep(600);
		await clickText("create a profile for");
		await sleep(800);
		await measure(`onboarding ${w}`);
		await snap("3-onboarding", w);
		// 4. assign flow
		await open("/instructor/students/", w, teacher, ".sd table tbody tr, .sd-cards li");
		await clickText("assign worksheet", "document.querySelector('.sd')");
		await waitFor(".ml-assign.ml-form, form[aria-labelledby='assign-form-title']");
		await sleep(1500);
		await measure(`assign ${w}`);
		await snap("4-assign", w);
		// 5. review step
		await ev(`(() => { const b = document.querySelector("form[aria-labelledby='assign-form-title'] input[type=checkbox]"); if (b && !b.checked) b.click(); })()`);
		await clickText("review");
		await waitFor("#review-title");
		await sleep(600);
		await measure(`review ${w}`);
		await snap("5-review", w);
		// 6. family dashboard (parent view of Meera)
		ok = await open(`/family/?learner=${c.family.learnerId}`, w, parent, ".ml-assign");
		if (!ok) problems.push({ label: `family ${w}: did not render` });
		await sleep(1200);
		await measure(`family ${w}`);
		await snap("6-family", w);
		// 7. instructor on the family dashboard (learner list + assignments)
		await open(`/family/`, w, teacher, ".ml-overview__card");
		await sleep(2000);
		await measure(`family-teacher ${w}`);
		await snap("7-family-teacher", w);
		// 8. student study page
		const learner = JSON.stringify({ id: c.s1.learnerId, displayName: "x", avatar: "🦊", accountUserId: s1.id });
		ok = await open("/study/", w, s1, ".ml-assign", `try{localStorage.setItem('ss.learnerToken',${JSON.stringify(c.tokens.s1)});localStorage.setItem('ss.activeLearner',${JSON.stringify(learner)})}catch(e){}`);
		if (!ok) problems.push({ label: `study ${w}: did not render` });
		await sleep(1200);
		await measure(`study ${w}`);
		await snap("8-study", w);
	}
	br.close();
	fs.writeFileSync(path.join(outDir, "overflow-report.json"), JSON.stringify(problems, null, 2));
	console.log(problems.length ? `PROBLEMS: ${JSON.stringify(problems, null, 1)}` : "no overflow, all screens rendered at 390/440/768/1024/1366");
	process.exitCode = problems.length ? 1 : 0;
}

try {
	if (mode === "seed") await seed();
	else if (mode === "clean") await clean();
	else if (mode === "shoot") await shoot(process.argv[3] || path.join(os.tmpdir(), "ss-shots"));
	else console.log("usage: seed | shoot <dir> | clean");
} finally {
	await db.end();
}
