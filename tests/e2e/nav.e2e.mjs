// Server-rendered navigation checks against a RUNNING dev server (localhost only).
// Uses tokens minted for existing dev users; reads the rendered header/drawer HTML.
import fs from "node:fs";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");
const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT });
const [users] = await db.query("SELECT id, role, email FROM users WHERE status = 1 OR status IS NULL");
await db.end();
const by = (r) => users.find((u) => u.role === r);
const [student, instructor, admin] = [by("student"), by("instructor"), by("admin")];
const token = (u, secret = process.env.JWT_SECRET) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, secret, { expiresIn: "5m" });

// Returns the anchors of the desktop nav, the drawer, and the account/footer-free header text.
async function nav(path, user) {
	const res = await fetch(`${BASE}${path}`, { headers: user ? { Cookie: `edmy_users_token=${token(user)}` } : {}, redirect: "manual" });
	const html = await res.text();
	const a = html.indexOf('<header id="navbar"');
	const b = html.indexOf('<span id="main"');
	const chrome = a >= 0 && b > a ? html.slice(a, b) : "";
	const drawerStart = chrome.indexOf('id="ss-drawer"');
	const drawer = drawerStart >= 0 ? chrome.slice(drawerStart) : "";
	const links = (s) => [...s.matchAll(/<a[^>]*href="([^"]+)"[^>]*>(?:<i[^>]*><\/i>)?([^<]*)</g)].map((m) => [m[1].replace(/\/$/, "") || "/", m[2].trim()]);
	return { status: res.status, chrome, drawer, drawerLinks: links(drawer), footer: /<footer class="ss-footer"/.test(html) };
}
let n = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	n++;
};
const dups = (links) => links.map((l) => l[0]).filter((h, i, arr) => arr.indexOf(h) !== i);

for (const [label, user, path, must, mustNot] of [
	["student", student, "/learning/my-courses/", ["My Learning", "Mastery Ladder", "Family", "Browse Courses", "Purchases"], ["/instructor/courses", "/instructor/course/create", "/admin"]],
	["student", student, "/family/", ["My Learning", "Mastery Ladder", "Browse Courses"], ["/instructor/courses", "/instructor/course/create", "Create Course", "Learners"]],
	["student", student, "/study/", ["Mastery Ladder"], ["/instructor/courses"]],
	["instructor", instructor, "/instructor/courses/", ["My Courses", "Create Course", "Mastery Ladder", "Learners", "Browse Courses"], ["/admin"]],
	["instructor", instructor, "/family/", ["My Courses", "Create Course", "Learners"], ["/admin"]],
]) {
	const r = await nav(path, user);
	check(`${label} ${path}: rendered`, r.status === 200 && r.drawerLinks.length > 3);
	check(`${label} ${path}: no duplicate destinations in the drawer (${dups(r.drawerLinks).join(",") || "none"})`, dups(r.drawerLinks).length === 0);
	for (const m of must) check(`${label} ${path}: has "${m}"`, r.drawer.includes(m));
	for (const m of mustNot) check(`${label} ${path}: lacks "${m}"`, !r.drawer.includes(m) && !r.chrome.includes(`href="${m}`));
	check(`${label} ${path}: no public nav/footer`, !/href="\/blog\/blogs\/"/.test(r.chrome) && !r.footer);
	check(`${label} ${path}: has Log out`, /Log out/.test(r.drawer));
}
const adm = await nav("/admin/", admin);
check("admin keeps header + Admin Dashboard entry", adm.status === 200 && adm.drawer.includes("Admin Dashboard") && dups(adm.drawerLinks).length === 0);
const pub = await nav("/courses/");
check("visitor sees public nav + footer", /href="\/blog\/blogs\/"/.test(pub.chrome) && pub.footer && dups(pub.drawerLinks.filter((l) => l[1] !== "")).length <= 1);
// A forged token is not a user: no role-based navigation is rendered for it.
const fres = await fetch(`${BASE}/family/`, { headers: { Cookie: `edmy_users_token=${token(student, "wrong-secret")}` }, redirect: "manual" });
const fhtml = await fres.text();
check("forged token gets no dashboard/role navigation", !/Create Course|My Learning|Log out/.test(fhtml.slice(0, fhtml.indexOf('<span id="main"') + 1)));
console.log(`nav e2e: ${n} checks passed`);
