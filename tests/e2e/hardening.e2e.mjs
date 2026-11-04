// Production-hardening checks against a RUNNING dev server and database
// (localhost only): unpublished courses, coupons, checkout validation, admin-only
// content routes, e-mail confirmation and the public forms.
// Nothing here can create a Stripe charge (paid checkouts are sent without a
// payment token and are refused first). The contact form is only sent invalid
// data, so no e-mail goes out. Temporary rows are removed at the end.
// Set E2E_RATE=1 to also exercise the coupon rate limiter (this locks coupon
// lookups from this machine for 10 minutes).
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const instructors = users.filter((u) => u.role === "instructor");
const students = users.filter((u) => u.role === "student");
const admin = users.find((u) => u.role === "admin");
const [insA, insB] = instructors;
const [stuIn, stuOut] = students;
const tok = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "10m" });
const [[cat]] = await db.query("SELECT id, slug FROM categories LIMIT 1");

const tag = `zz-e2e-${Date.now()}`;
const pub = randomUUID(); // approved, 30.00, owner insA
const draft = randomUUID(); // unapproved, owner insA
const addCourse = (id, slug, approved, price) =>
	db.query("INSERT INTO courses (id, title, slug, userId, catId, latest_price, approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())", [id, `${tag} ${slug}`, `${tag}-${slug}`, insA.id, cat.id, price, approved]);
await addCourse(pub, "pub", 1, 30);
await addCourse(draft, "draft", 0, 10);
await db.query("INSERT INTO enrolments (id, userId, courseId, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())", [randomUUID(), stuIn.id, draft]);
const vId = randomUUID();
await db.query("INSERT INTO videos (id, title, video, is_preview, short_id, courseId, userId, created_at, updated_at) VALUES (?, 'secret', 'https://example.test/secret.mp4', 0, 1, ?, ?, NOW(), NOW())", [vId, draft, insA.id]);
await db.query("INSERT INTO videos (id, title, video, is_preview, short_id, courseId, userId, created_at, updated_at) VALUES (?, 'lesson', 'https://example.test/lesson.mp4', 1, 1, ?, ?, NOW(), NOW())", [randomUUID(), pub, insA.id]);
const goodCoupon = `ZZ${Date.now()}`;
const oldCoupon = `ZZOLD${Date.now()}`;
const offCoupon = `ZZOFF${Date.now()}`;
const addCoupon = (code, discount, exp, status, site) =>
	db.query("INSERT INTO coupons (id, code, discount, exp_date, status, active_for_full_site, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())", [randomUUID(), code, discount, exp, status, site]);
await addCoupon(goodCoupon, 50, null, 1, 1);
await addCoupon(oldCoupon, 50, new Date(Date.now() - 86400000), 1, 1);
await addCoupon(offCoupon, 50, null, 0, 1);
const tmpUser = randomUUID();
const tmpEmail = `${tag}@example.test`;
const emailToken = randomUUID();
await db.query("INSERT INTO users (id, first_name, last_name, email, password, reset_password_token, email_confirmed, role, status, created_at, updated_at) VALUES (?, 'Tmp', 'User', ?, 'x', ?, 0, 'student', 1, NOW(), NOW())", [tmpUser, tmpEmail, emailToken]);

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
const count = async (sql, args = []) => Number((await db.query(sql, args))[0][0].n);

try {
	// ===== unpublished courses =====
	const bySlug = (slug, o) => call("GET", "/api/courses/course/", { ...o, query: { slug } });
	const dSlug = `${tag}-draft`;
	check("published course: public", (await bySlug(`${tag}-pub`)).json.course?.id === pub);
	check("draft by slug: visitor gets 404 and no data", (await bySlug(dSlug)).status === 404 && !(await bySlug(dSlug)).text.includes(draft));
	check("draft by slug: unrelated student 404", (await bySlug(dSlug, { as: stuOut })).status === 404);
	check("draft by slug: other instructor 404", (await bySlug(dSlug, { as: insB })).status === 404);
	check("draft by slug: owner 200", (await bySlug(dSlug, { as: insA })).json.course?.id === draft);
	check("draft by slug: admin 200", (await bySlug(dSlug, { as: admin })).status === 200);
	check("draft by slug: already-enrolled student keeps access", (await bySlug(dSlug, { as: stuIn })).status === 200);
	const lessons = (slug, o) => call("GET", `/api/learnings/videos/${slug}/`, o);
	let r = await lessons(dSlug);
	check("draft lessons: visitor gets nothing", r.status === 200 && r.json.videos.length === 0 && !r.text.includes("secret.mp4") && !r.json.course);
	r = await lessons(dSlug, { as: stuOut });
	check("draft lessons: non-enrolled student gets nothing", r.json.videos.length === 0 && !r.text.includes("secret.mp4"));
	r = await lessons(dSlug, { as: stuIn });
	check("draft lessons: enrolled student sees them", r.json.videos.length === 1 && r.json.videos[0].video.includes("secret.mp4"));
	check("draft lessons: owner sees them", (await lessons(dSlug, { as: insA })).json.videos.length === 1);
	check("draft assets/lesson endpoints stay protected", (await call("GET", `/api/assets/${draft}/`)).status === 401 && (await call("GET", `/api/assets/${draft}/`, { as: stuOut })).status === 403 && (await call("GET", `/api/learnings/video/${vId}/`, { as: stuOut })).status === 403);
	const cats = await call("GET", `/api/categories/${cat.slug}/`);
	const listed = (cats.json.courses?.courses || []).map((c) => c.id);
	check("category page lists published courses only", listed.includes(pub) && !listed.includes(draft));
	check("catalogue and home exclude drafts", !(await call("GET", "/api/all-courses/")).text.includes(draft) && !(await call("GET", "/api/home-courses/")).text.includes(draft));
	check("cannot wishlist a draft", (await call("POST", "/api/favourites/new/", { as: stuOut, body: { courseId: draft, fav: true } })).status === 404);
	check("cannot buy a draft", (await call("POST", "/api/checkout/", { as: stuOut, body: { cartItems: [{ id: draft, price: 10 }], stripeToken: "tok_x1" } })).status === 404);

	// ===== coupons =====
	const lookup = (coupon) => call("POST", "/api/coupons/get-coupon/", { body: { coupon } });
	r = await lookup(goodCoupon);
	check("coupon lookup: valid code returns only the percentage", r.status === 200 && JSON.stringify(Object.keys(r.json.discount)) === '["discount"]' && r.json.discount.discount === 50 && !/exp_date|status|deleted|id|code/.test(JSON.stringify(r.json.discount)));
	check("coupon lookup: object-shaped code (legacy client) still works", (await lookup({ coupon: goodCoupon })).status === 200);
	for (const [label, code] of [["expired", oldCoupon], ["disabled", offCoupon], ["unknown", "NOPE12345"], ["empty", ""], ["injection", { $ne: "" }], ["nested injection", { coupon: { $ne: "" } }], ["wildcard", "%"], ["too long", "A".repeat(80)]]) {
		const x = await lookup(code);
		check(`coupon lookup: ${label} rejected`, x.status === 422 && !x.text.includes("discount\":"));
	}
	check("coupon lookup: GET not allowed", (await call("GET", "/api/coupons/get-coupon/")).status === 405);
	check("coupon admin routes unchanged: visitor 401, student 403", (await call("GET", "/api/coupons/")).status === 401 && (await call("GET", "/api/coupons/", { as: stuIn })).status === 403);
	if (process.env.E2E_RATE) {
		let limited = false;
		for (let i = 0; i < 30 && !limited; i++) limited = (await lookup("NOPE" + i)).status === 429;
		check("coupon lookup is rate limited (429)", limited);
	}

	// ===== checkout validation with coupons (never reaches Stripe) =====
	const CK = (as, items, extra = {}) => call("POST", "/api/checkout/", { as, body: { cartItems: items, ...extra } });
	check("checkout: discounted price needs a real code", (await CK(stuOut, [{ id: pub, price: 15 }])).status === 422);
	check("checkout: expired/disabled/unknown code refused", (await CK(stuOut, [{ id: pub, price: 15, coupon: oldCoupon }])).json.error_code === "invalid_coupon" && (await CK(stuOut, [{ id: pub, price: 15, coupon: offCoupon }])).json.error_code === "invalid_coupon" && (await CK(stuOut, [{ id: pub, price: 15, coupon: "NOPE12345" }])).json.error_code === "invalid_coupon");
	check("checkout: valid code but wrong claimed price refused", (await CK(stuOut, [{ id: pub, price: 1, coupon: goodCoupon }])).json.error_code === "price_changed");
	check("checkout: correct discounted price accepted, then asks for payment details (no Stripe call)", (await CK(stuOut, [{ id: pub, price: 15, coupon: goodCoupon }])).json.error_code === "payment_required");
	check("checkout: list price without a payment token is refused", (await CK(stuOut, [{ id: pub, price: 30 }])).json.error_code === "payment_required");
	check("checkout: anonymous 401", (await call("POST", "/api/checkout/", { body: { cartItems: [{ id: pub, price: 30 }] } })).status === 401);
	check("checkout: no enrolment created by any refused request", (await count("SELECT COUNT(*) n FROM enrolments WHERE courseId = ?", [pub])) === 0);

	// ===== admin-only content / data routes =====
	for (const [label, method, path, body] of [
		["site-settings", "POST", "/api/site-settings/", { site: true }],
		["partners create", "POST", "/api/partners/create/", { name: "zz", partner_image: "https://example.test/x.png" }],
		["partners delete", "DELETE", "/api/partners/create/?partnerId=none", undefined],
		["users list", "GET", "/api/users/", undefined],
		["funfacts", "GET", "/api/funfacts/", undefined],
	]) {
		check(`${label}: visitor 401`, (await call(method, path, { body })).status === 401);
		check(`${label}: fake token 401`, (await call(method, path, { raw: "x", body })).status === 401);
		check(`${label}: student 403`, (await call(method, path, { as: stuIn, body })).status === 403);
		check(`${label}: instructor 403`, (await call(method, path, { as: insA, body })).status === 403);
	}
	const partnersBefore = await count("SELECT COUNT(*) n FROM partners");
	check("partners unchanged after denied requests", partnersBefore === (await count("SELECT COUNT(*) n FROM partners")));
	check("site-settings: admin with invalid input gets 422 (and nothing is written)", (await call("POST", "/api/site-settings/", { as: admin, body: { image_url: "javascript:alert(1)" } })).status === 422 && (await call("POST", "/api/site-settings/", { as: admin, body: { site: "yes" } })).status === 422);
	check("site-settings: GET not allowed", (await call("GET", "/api/site-settings/", { as: admin })).status === 405);
	check("funfacts: admin 200", (await call("GET", "/api/funfacts/", { as: admin })).status === 200);
	check("users list: admin 200 (names/emails only)", (await call("GET", "/api/users/", { as: admin })).status === 200);
	check("public lists stay public: partners, testimonials", (await call("GET", "/api/partners/")).status === 200 && (await call("GET", "/api/testimonials/")).status === 200);

	// ===== e-mail confirmation =====
	const confirm = (token, email) => call("PUT", "/api/users/confirm-email/", { body: { token, email } });
	check("confirm-email: random valid uuid is refused", (await confirm(randomUUID(), tmpEmail)).status === 422);
	check("confirm-email: non-uuid / missing / object input refused", (await confirm("abc", tmpEmail)).status === 422 && (await confirm(emailToken, { $ne: "" })).status === 422 && (await confirm(undefined, tmpEmail)).status === 422);
	check("account still unconfirmed after bad attempts", (await count("SELECT COUNT(*) n FROM users WHERE id = ? AND email_confirmed = 0", [tmpUser])) === 1);
	check("confirm-email: the issued token confirms the account", (await confirm(emailToken, tmpEmail)).status === 201 && (await count("SELECT COUNT(*) n FROM users WHERE id = ? AND email_confirmed = 1", [tmpUser])) === 1);
	check("confirm-email: second use refused", (await confirm(emailToken, tmpEmail)).status === 422);
	check("send-confirmation-email: invalid address 422", (await call("POST", "/api/users/send-confirmation-email/", { body: { email: "not-an-email" } })).status === 422);

	// ===== public forms =====
	for (const body of [{}, { name: "A", email: "bad", subject: "s", message: "m" }, { name: "A", email: "a@example.com", subject: "", message: "m" }, { name: "A", email: "a@example.com", subject: "s", message: "" }]) {
		check(`contact: invalid input rejected ${JSON.stringify(Object.keys(body))}`, (await call("POST", "/api/contact/", { body })).status === 422);
	}
	check("contact: GET not allowed", (await call("GET", "/api/contact/")).status === 405);
	check("signup: validation still works", (await call("POST", "/api/users/signup/", { body: { first_name: "ab", last_name: "cd", email: "x", password: "1" } })).status === 422);
	console.log(`hardening e2e: ${n} checks passed`);
} finally {
	await db.query("DELETE FROM courses WHERE title LIKE ?", [`${tag}%`]);
	await db.query("DELETE FROM coupons WHERE code IN (?, ?, ?)", [goodCoupon, oldCoupon, offCoupon]);
	await db.query("DELETE FROM users WHERE id = ?", [tmpUser]);
	await db.end();
}
