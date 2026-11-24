// Authorization regression checks for legacy admin routes and user rows.
// Needs a running dev server (localhost only). Read-only except for denied
// requests, which must change nothing.
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
const [users] = await db.query("SELECT id, role, email FROM users WHERE status = 1 OR status IS NULL ORDER BY created_at");
const admin = users.find((u) => u.role === "admin");
const student = users.find((u) => u.role === "student");
assert.ok(admin && student);
const token = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "5m" });
const call = async (method, path, { auth, raw, body } = {}) => {
	const headers = { "Content-Type": "application/json" };
	if (raw) headers.Authorization = raw;
	if (auth) headers.Authorization = token(auth);
	const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	const text = await res.text();
	return { status: res.status, text };
};
let n = 0;
const check = (name, cond) => { assert.ok(cond, name); n++; };
const instructor = users.find((u) => u.role === "instructor");
const roleOf = async (id) => (await db.query("SELECT role FROM users WHERE id = ?", [id]))[0][0].role;

try {
	check("GET /api/students: anonymous -> 401", (await call("GET", "/api/students/")).status === 401);
	check("GET /api/students: student -> 403", (await call("GET", "/api/students/", { auth: student })).status === 403);
	const ok = await call("GET", "/api/students/", { auth: admin });
	check("GET /api/students: admin -> 200", ok.status === 200);
	check("no password hashes in the students list", !/\$2[aby]\$/.test(ok.text) && !/"password"/.test(ok.text));

	const before = await roleOf(student.id);
	for (const [label, opts] of [["fake header", { raw: "anything" }], ["student token", { auth: student }]]) {
		const r = await call("PUT", "/api/admin/make-admin/", { ...opts, body: { userId: student.id, admin: true } });
		check(`make-admin PUT with ${label} is refused`, r.status === 401 || r.status === 403);
	}
	check("role unchanged after attempts", (await roleOf(student.id)) === before);
	for (const path of ["/api/admin/courses/", "/api/instructor/requests/", "/api/instructor/instructors/", "/api/coupons/"]) {
		check(`${path} rejects a fake header`, (await call("GET", path, { raw: "x" })).status === 401);
		check(`${path} rejects a student`, (await call("GET", path, { auth: student })).status === 403);
	}
	// Categories: anyone signed in may list (instructors need it to create courses); changes are admin-only.
	check("categories list: fake header -> 401", (await call("GET", "/api/categories/", { raw: "x" })).status === 401);
	check("categories list: anonymous -> 401", (await call("GET", "/api/categories/")).status === 401);
	for (const [label, u] of [["instructor", instructor], ["student", student], ["admin", admin]]) {
		const r = await call("GET", "/api/categories/", { auth: u });
		check(`categories list: ${label} -> 200 with a categories array`, r.status === 200 && Array.isArray(JSON.parse(r.text).categories));
	}
	const [[{ n: catCount }]] = await db.query("SELECT COUNT(*) n FROM categories");
	for (const [label, u] of [["instructor", instructor], ["student", student]]) {
		check(`categories delete: ${label} -> 403`, (await call("DELETE", "/api/categories/?catId=none", { auth: u })).status === 403);
		check(`categories create: ${label} -> 403`, (await call("POST", "/api/categories/create/", { auth: u, body: { name: "zz-e2e" } })).status === 403);
		check(`categories edit: ${label} -> 403`, (await call("PUT", "/api/categories/create/", { auth: u, body: { name: "zz-e2e" } })).status === 403);
	}
	check("no category changed by denied requests", Number((await db.query("SELECT COUNT(*) n FROM categories"))[0][0].n) === Number(catCount));
	// ---- POST /api/courses/new: instructors/admins only; owner always the caller ----
	const cats = JSON.parse((await call("GET", "/api/categories/", { auth: instructor })).text).categories;
	check("categories have names for the dropdown", cats.length === 0 || cats.every((c) => c.id && c.name));
	if (cats.length) {
		const prefix = `zz e2e course ${Date.now()}`;
		const course = (title, extra = {}) => ({ title, short_desc: "t", overview: "t", latest_price: 12.5, before_price: 20, lessons: "1", duration: "1", image: "x", access_time: "Lifetime", requirements: "t", what_you_will_learn: "t", who_is_this_course_for: "t", catId: cats[0].id, is_class: false, ...extra });
		const count = async () => Number((await db.query("SELECT COUNT(*) n FROM courses"))[0][0].n);
		try {
			const before = await count();
			check("no token -> 401", (await call("POST", "/api/courses/new/", { body: course(`${prefix} a`) })).status === 401);
			check("fake header -> 401", (await call("POST", "/api/courses/new/", { raw: "x", body: course(`${prefix} b`) })).status === 401);
			check("token signed with the wrong secret -> 401", (await call("POST", "/api/courses/new/", { raw: jwt.sign({ userId: student.id, role: "instructor" }, "wrong-secret"), body: course(`${prefix} c`) })).status === 401);
			check("student -> 403", (await call("POST", "/api/courses/new/", { auth: student, body: course(`${prefix} d`) })).status === 403);
			check("student claiming role=instructor in the body -> 403", (await call("POST", "/api/courses/new/", { auth: student, body: course(`${prefix} e`, { role: "instructor", userId: instructor.id }) })).status === 403);
			check("denied requests created no records", (await count()) === before);

			const own = await call("POST", "/api/courses/new/", { auth: instructor, body: course(`${prefix} instructor`, { userId: student.id }) });
			check("instructor creates a course", own.status === 200);
			const [[r1]] = await db.query("SELECT userId, catId, latest_price, approved FROM courses WHERE title = ?", [`${prefix} instructor`]);
			check("owner is the authenticated instructor, not the body userId", r1 && r1.userId === instructor.id);
			check("category and price preserved; not auto-approved", r1.catId === cats[0].id && Number(r1.latest_price) === 12.5 && !r1.approved);

			const adm = await call("POST", "/api/courses/new/", { auth: admin, body: course(`${prefix} admin`, { userId: student.id }) });
			check("admin may create a course", adm.status === 200);
			const [[r2]] = await db.query("SELECT userId FROM courses WHERE title = ?", [`${prefix} admin`]);
			check("admin-created course is owned by the admin", r2 && r2.userId === admin.id);
			check("DELETE is not an allowed method", (await call("DELETE", "/api/courses/new/", { auth: admin })).status === 405);
		} finally {
			await db.query("DELETE FROM courses WHERE title LIKE ?", [`${prefix}%`]); // remove only this run's temporary courses
		}
	} else console.log("note: no categories in the dev database; course-creation checks skipped");
	check("admin still reaches instructor list", (await call("GET", "/api/instructor/instructors/", { auth: admin })).status === 200);

	const me = await call("GET", "/api/users/update/", { auth: student });
	check("users/update works and hides the hash", me.status === 200 && !/\$2[aby]\$/.test(me.text) && !/reset_password_token/.test(me.text) && !/"password"/.test(me.text));
	console.log(`security e2e: ${n} checks passed`);
} finally {
	await db.end();
}
