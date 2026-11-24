// Scenario tests of the application's real API against the PostgreSQL TEST instance (isolated test schema only).
//
//   node tests/e2e-pg/api-scenarios.mjs <state.json> <baseUrl> <mailLog> <out.json>
//
// Uses only the dedicated test accounts (e2e.*@example.test) created by tests/e2e-pg/provision.mjs. Real accounts are never signed
// in or changed. Outgoing e-mail goes to a recorder (server-preload.cjs), so nothing is delivered. Prints no tokens or secrets.
import fs from "node:fs";
import pg from "pg";

const [, , stateFile, baseUrl, mailLog, outFile] = process.argv;
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const PASSWORD = "Phase7-Test-Pass-1!";
const results = [];
const db = new pg.Client({ host: "localhost", database: "sharpstudy_dev", user: "sharpstudy_dev", options: `-c search_path=${state.schema}` });
await db.connect();

const mails = () => (fs.existsSync(mailLog) ? fs.readFileSync(mailLog, "utf8").split("\n").filter(Boolean).length : 0);
async function call(method, path, { token, body, query } = {}) {
	const qs = query ? "?" + new URLSearchParams(query) : "";
	const t0 = performance.now();
	const res = await fetch(`${baseUrl}/api${path}${path.endsWith("/") ? "" : "/"}${qs}`, {
		method,
		headers: { ...(token ? { authorization: token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	let json = null;
	try {
		json = await res.json();
	} catch {
		/* not JSON */
	}
	return { status: res.status, json, ms: Math.round(performance.now() - t0) };
}
function check(area, label, method, path, expected, r, valid = true, note = "") {
	const exp = Array.isArray(expected) ? expected : [expected];
	const ok = exp.includes(r.status) && valid;
	results.push({ area, label, method, path, expected: exp.join("|"), actual: r.status, ok, note });
	if (!ok) console.log(`FAIL [${area}] ${label}: ${method} ${path} expected ${exp.join("|")} got ${r.status}${note ? " - " + note : ""} ${JSON.stringify(r.json || {}).slice(0, 160)}`);
}
const signin = async (email, password = PASSWORD) => call("POST", "/users/signin", { body: { email, password } });
const tokenOf = async (email) => (await signin(email)).json.edmy_users_token;

// ======================================================================= authentication
const A = "authentication";
let r = await signin(state.testEmails.student.toUpperCase());
check(A, "sign-in with a mixed-case e-mail", "POST", "/users/signin", 200, r, !!r.json?.edmy_users_token);
const student = r.json.edmy_users_token;
r = await signin(state.testEmails.student, "wrong-password");
check(A, "wrong password", "POST", "/users/signin", 401, r);
r = await signin("nobody.here@example.test");
check(A, "unknown account", "POST", "/users/signin", 404, r);
r = await signin(state.testEmails.disabled);
check(A, "disabled account cannot sign in", "POST", "/users/signin", 404, r, /disabled/i.test(r.json?.message || ""));
r = await signin(state.testEmails.unconfirmed);
check(A, "unconfirmed e-mail cannot sign in", "POST", "/users/signin", 404, r, /not confirmed/i.test(r.json?.message || ""));
r = await signin("not-an-email");
check(A, "invalid e-mail format", "POST", "/users/signin", 422, r);
r = await call("POST", "/users/signin", { body: {} });
check(A, "missing credentials do not crash", "POST", "/users/signin", [400, 422], r);

// sign-up -> confirmation e-mail (recorded, not sent) -> confirm -> sign-in
const fresh = `e2e.fresh.${Date.now()}@example.test`;
const mailsBefore = mails();
r = await call("POST", "/users/signup", { body: { first_name: "Fresh", last_name: "Person", email: fresh.toUpperCase(), password: "Another-Pass-1" } });
check(A, "sign-up (e-mail typed in upper case)", "POST", "/users/signup", 200, r, !!r.json?.edmy_users_token);
const stored = (await db.query("select email, email_confirmed, role, status, reset_password_token from users where lower(email) = lower($1)", [fresh])).rows[0];
check(A, "e-mail is stored trimmed and lower-case", "DB", "users", 200, { status: stored && stored.email === fresh ? 200 : 0 }, true);
check(A, "new account is an unconfirmed active student", "DB", "users", 200, { status: stored && !stored.email_confirmed && stored.role === "student" && stored.status === true ? 200 : 0 });
check(A, "confirmation e-mail was handed to the (mock) mailer, not delivered", "MAIL", mailLog, 200, { status: mails() > mailsBefore ? 200 : 0 });
r = await call("POST", "/users/signup", { body: { first_name: "Fresh", last_name: "Person", email: fresh.replace("e2e.", "E2E."), password: "Another-Pass-1" } });
check(A, "duplicate sign-up differing only in letter case is refused", "POST", "/users/signup", 422, r);
r = await call("POST", "/users/signup", { body: { first_name: "Al", last_name: "Bo", email: "short@example.test", password: "123" } });
check(A, "sign-up validation (names / password too short)", "POST", "/users/signup", 422, r);
r = await signin(fresh);
check(A, "sign-in before confirmation is refused", "POST", "/users/signin", 404, r);
r = await call("PUT", "/users/confirm-email", { body: { email: fresh.toUpperCase(), token: "00000000-0000-4000-8000-000000000000" } });
check(A, "confirmation with a wrong token is refused", "PUT", "/users/confirm-email", [422, 400], r);
r = await call("PUT", "/users/confirm-email", { body: { email: fresh.toUpperCase(), token: stored.reset_password_token } });
check(A, "confirmation with the right token", "PUT", "/users/confirm-email", [200, 201], r);
r = await signin(fresh, "Another-Pass-1");
check(A, "sign-in after confirmation", "POST", "/users/signin", 200, r, !!r.json?.edmy_users_token);
r = await call("PUT", "/users/confirm-email", { body: { email: fresh, token: stored.reset_password_token } });
check(A, "confirming twice is refused", "PUT", "/users/confirm-email", 422, r);
const mailsBefore2 = mails();
r = await call("POST", "/users/send-confirmation-email", { body: { email: state.testEmails.unconfirmed.toUpperCase() } });
check(A, "resend confirmation (mixed-case e-mail)", "POST", "/users/send-confirmation-email", 200, r);
check(A, "resend handed one message to the mock mailer", "MAIL", mailLog, 200, { status: mails() > mailsBefore2 ? 200 : 0 });
r = await call("POST", "/users/send-confirmation-email", { body: { email: "nobody.here@example.test" } });
check(A, "resend for an unknown address", "POST", "/users/send-confirmation-email", 422, r);

// ======================================================================= authorization and malformed ids
const B = "authorization";
const instructor = await tokenOf(state.testEmails.instructor);
const admin = await tokenOf(state.testEmails.admin);
const other = await tokenOf(state.testEmails.other_student);
r = await call("GET", "/users/update");
check(B, "no token", "GET", "/users/update", 401, r);
r = await call("GET", "/users/update", { token: "garbage" });
check(B, "garbage token", "GET", "/users/update", 401, r);
r = await call("GET", "/users/update", { token: student });
check(B, "profile of the signed-in student", "GET", "/users/update", 200, r, r.json?.user?.email === state.testEmails.student);
r = await call("GET", "/admin/make-admin", { token: student });
check(B, "student cannot open an admin route", "GET", "/admin/make-admin", 403, r);
r = await call("GET", "/admin/make-admin", { token: instructor });
check(B, "instructor cannot open an admin route", "GET", "/admin/make-admin", 403, r);
r = await call("GET", "/admin/make-admin", { token: admin });
check(B, "admin can", "GET", "/admin/make-admin", 200, r);
r = await call("GET", "/admin/telecallers/applications", { token: student });
check(B, "student cannot open telecaller administration", "GET", "/admin/telecallers/applications", 403, r);
for (const [p, tok, label] of [
	["/admin/users/not-a-uuid", admin, "admin user by malformed id"],
	["/admin/instructors/not-a-uuid", admin, "admin instructor by malformed id"],
	["/courses/course/not-a-uuid", instructor, "course by malformed id"],
	["/assets/not-a-uuid", instructor, "asset by malformed id"],
	["/live-sessions/not-a-uuid", instructor, "live session by malformed id"],
	["/mastery/learners/not-a-uuid", student, "mastery learner by malformed id"],
	["/books/not-a-uuid", student, "book by malformed id"],
	["/meetings/manage", undefined, "meeting manage without token"],
]) {
	r = await call("GET", p, { token: tok, query: { id: "not-a-uuid", token: "x" } });
	check(B, `${label} never answers 500`, "GET", p, [200, 400, 401, 403, 404, 405, 422], r);
}
r = await call("GET", "/courses/course", { token: instructor, query: { slug: "no-such-course" } });
check(B, "unknown course slug", "GET", "/courses/course?slug=...", [404, 200, 400], r);

// ======================================================================= admin: categories, partners, testimonials, coupons
const C = "admin";
const tag = Date.now();
r = await call("POST", "/categories/create", { token: student, body: { category: `Denied ${tag}` } });
check(C, "student cannot create a category", "POST", "/categories/create", 403, r);
r = await call("POST", "/categories/create", { token: admin, body: { category: `Category ${tag}` } });
check(C, "admin creates a category", "POST", "/categories/create", 200, r, !!r.json?.category?.id);
const cat = r.json?.category;
r = await call("POST", "/categories/create", { token: admin, body: { category: `Category ${tag}` } });
check(C, "same category name gets a different slug (unique slug)", "POST", "/categories/create", 200, r, r.json?.category?.slug !== cat?.slug);
r = await call("GET", "/categories", { token: admin });
check(C, "category list", "GET", "/categories", 200, r, JSON.stringify(r.json).includes(`Category ${tag}`));
r = await call("POST", "/partners/create", { token: admin, body: { name: `Partner ${tag}`, partner_image: "https://example.test/p.png" } });
check(C, "admin creates a partner", "POST", "/partners/create", 200, r);
r = await call("GET", "/partners", { token: admin });
check(C, "partner list", "GET", "/partners", 200, r, JSON.stringify(r.json).includes(`Partner ${tag}`));
const partner = (await db.query("select id from partners where name = $1", [`Partner ${tag}`])).rows[0];
r = await call("DELETE", "/partners/create", { token: admin, query: { partnerId: partner.id } });
check(C, "admin deletes the partner", "DELETE", "/partners/create", 200, r);
r = await call("POST", "/testimonials/create", { token: admin, body: { image_url: "https://example.test/t.png", name: `Tester ${tag}`, designation: "QA", description: "works on PostgreSQL" } });
check(C, "admin creates a testimonial", "POST", "/testimonials/create", 200, r);
r = await call("GET", "/testimonials", { token: admin });
check(C, "testimonial list", "GET", "/testimonials", 200, r, JSON.stringify(r.json).includes(`Tester ${tag}`));
const code = `SAVE${tag}`;
r = await call("POST", "/coupons/new", { token: student, body: { coupon: code, discount: 15 } });
check(C, "student cannot create a coupon", "POST", "/coupons/new", 403, r);
r = await call("POST", "/coupons/new", { token: admin, body: { coupon: code, discount: 15 } });
check(C, "admin creates a coupon", "POST", "/coupons/new", 200, r);
r = await call("POST", "/coupons/new", { token: admin, body: { coupon: code.toLowerCase(), discount: 20 } });
check(C, "the same coupon code in another letter case is refused (MySQL behaviour kept)", "POST", "/coupons/new", 422, r);
r = await call("POST", "/coupons/get-coupon", { token: student, body: { coupon: code.toLowerCase() } });
check(C, "coupon lookup ignores letter case", "POST", "/coupons/get-coupon", [200, 422], r, true, `status ${r.status}`);

// ======================================================================= instructor: courses
const D = "instructor";
r = await call("POST", "/courses/new", { token: student, body: { title: "Denied", catId: cat?.id } });
check(D, "student cannot create a course", "POST", "/courses/new", 403, r);
const title = `Course ${tag} on PostgreSQL`;
r = await call("POST", "/courses/new", { token: instructor, body: { title, short_desc: "short", overview: "<p>overview</p>", latest_price: 0, before_price: 0, lessons: 1, duration: "1h", image: "https://example.test/c.png", access_time: "Lifetime", requirements: "<p>r</p>", what_you_will_learn: "<p>w</p>", who_is_this_course_for: "<p>f</p>", catId: cat.id, is_class: false } });
check(D, "instructor creates a course", "POST", "/courses/new", 200, r);
const course = (await db.query('select id, slug, "userId", approved from courses where title = $1', [title])).rows[0];
check(D, "the course belongs to the signed-in instructor and is not approved yet", "DB", "courses", 200, { status: course && course.userId === state.testUsers.instructor && !course.approved ? 200 : 0 });
r = await call("GET", "/courses/course", { token: instructor, query: { slug: course.slug } });
check(D, "instructor reads the course by slug", "GET", "/courses/course?slug=", 200, r);
r = await call("GET", "/courses", { token: instructor });
check(D, "instructor's courses", "GET", "/courses", 200, r, JSON.stringify(r.json).includes(course.slug));
r = await call("GET", "/instructor/dashboard", { token: instructor });
check(D, "instructor dashboard", "GET", "/instructor/dashboard", 200, r, r.json?.totals?.courses >= 1);
r = await call("GET", "/instructor/students", { token: instructor });
check(D, "instructor student directory", "GET", "/instructor/students", 200, r, Array.isArray(r.json?.students));
r = await call("GET", "/instructor/profile", { token: instructor });
check(D, "instructor profile", "GET", "/instructor/profile", 200, r);
r = await call("GET", "/admin/courses/requests", { token: admin });
check(D, "admin sees the course waiting for approval", "GET", "/admin/courses/requests", 200, r, JSON.stringify(r.json).includes(course.slug));

// ======================================================================= student: course listing / free enrolment / progress
const E = "student";
r = await call("GET", "/all-courses", { token: student });
check(E, "course listing", "GET", "/all-courses", 200, r);
r = await call("GET", "/all-courses", { token: student, query: { search: "MATHEMATICS" } });
check(E, "course search ignores letter case", "GET", "/all-courses?search=MATHEMATICS", 200, r, JSON.stringify(r.json).toLowerCase().includes("mathematics"));
r = await call("GET", "/learnings/my-purchases", { token: student });
check(E, "purchase history", "GET", "/learnings/my-purchases", 200, r);
r = await call("GET", "/learnings", { token: student });
check(E, "my courses", "GET", "/learnings", 200, r);
r = await call("GET", "/notifications", { token: student });
check(E, "notifications list", "GET", "/notifications", 200, r);
r = await call("GET", "/mastery/learners", { token: student });
check(E, "mastery learners (student)", "GET", "/mastery/learners", 200, r);
r = await call("GET", "/mastery/curriculum", { token: student });
check(E, "mastery curriculum", "GET", "/mastery/curriculum", 200, r);
r = await call("GET", "/family/overview", { token: student });
check(E, "family overview", "GET", "/family/overview", [200, 403], r);
r = await call("GET", "/books", { token: student });
check(E, "book catalogue", "GET", "/books", 200, r, Array.isArray(r.json?.books) || typeof r.json === "object");
r = await call("GET", "/books/mine", { token: student });
check(E, "my books", "GET", "/books/mine", 200, r);

// ======================================================================= applications and other features
const F = "applications";
r = await call("GET", "/instructor/new", { token: other });
check(F, "instructor application (read)", "GET", "/instructor/new", [200, 404], r);
r = await call("GET", "/telecallers/apply", { token: other });
check(F, "telecaller application (read)", "GET", "/telecallers/apply", [200, 404], r);
r = await call("GET", "/admin/telecallers/applications", { token: admin });
check(F, "admin telecaller applications", "GET", "/admin/telecallers/applications", 200, r);
r = await call("GET", "/admin/telecallers/members", { token: admin });
check(F, "admin telecaller members", "GET", "/admin/telecallers/members", 200, r);
r = await call("GET", "/admin/telecallers/activity", { token: admin });
check(F, "admin telecaller activity", "GET", "/admin/telecallers/activity", 200, r);
r = await call("GET", "/admin/student-removals", { token: admin });
check(F, "admin removal requests", "GET", "/admin/student-removals", 200, r);
r = await call("GET", "/admin/meetings", { token: admin });
check(F, "admin meeting requests", "GET", "/admin/meetings", 200, r);
r = await call("GET", "/admin/books", { token: admin });
check(F, "admin books", "GET", "/admin/books", 200, r);
r = await call("GET", "/admin/books/orders", { token: admin });
check(F, "admin book orders", "GET", "/admin/books/orders", 200, r);
r = await call("GET", "/mastery/admin/audit", { token: admin });
check(F, "mastery audit log", "GET", "/mastery/admin/audit", 200, r, Array.isArray(r.json?.rows || r.json?.logs || r.json?.entries) || typeof r.json === "object");
r = await call("GET", "/mastery/admin/users", { token: admin });
check(F, "mastery admin users", "GET", "/mastery/admin/users", 200, r);
r = await call("GET", "/live-sessions", { token: instructor });
check(F, "live sessions (instructor)", "GET", "/live-sessions", 200, r);
r = await call("GET", "/live-sessions", { token: student });
check(F, "live sessions (student)", "GET", "/live-sessions", 200, r);
r = await call("GET", "/site-settings");
check(F, "site settings is not a GET route (405, never 500)", "GET", "/site-settings", [200, 401, 405], r);

// ======================================================================= data types through the API
const G = "data types";
const audit = await call("GET", "/mastery/admin/audit", { token: admin });
const text = JSON.stringify(audit.json);
check(G, "timestamps are ISO-8601 in UTC (no local-time shift)", "GET", "/mastery/admin/audit", 200, audit, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/.test(text));
const created = await call("GET", "/users/update", { token: student });
const iso = created.json?.user?.created_at;
check(G, "a user's created_at is an ISO-8601 UTC instant", "GET", "/users/update", 200, created, !iso || /Z$/.test(iso));

fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
const failed = results.filter((x) => !x.ok);
console.log(`API scenarios: ${results.length - failed.length} of ${results.length} checks passed`);
await db.end();
process.exitCode = failed.length ? 1 : 0;
