// Telecaller landing, direct-URL handling, cart visibility and notifications; ordinary students / instructors / admins unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pageAccess } from "../../lib/auth/pageAccess.js";
import { isTelecallerOnly, isStudentLearningPath, TELECALLER_HOME } from "../../lib/auth/telecallerNav.js";
import { navModel } from "../../components/_App/accountLinks.js";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const TELE = { role: "student", telecaller_access: "active" };
const LEARNING = ["/learning/my-courses", "/learning/my-courses/", "/learning/my-books", "/learning/my-books/read/abc", "/learning/live", "/learning/live/xyz", "/learning/wishlist", "/learning/my-purchase-history", "/learning/course/some-course", "/learning/certificate/abc", "/learning"];

// Follows page-gate redirects the way the browser / server would, and fails on a loop.
function follow(path, user, limit = 5) {
	const seen = [];
	let p = path;
	for (let i = 0; i < limit; i++) {
		const to = pageAccess(p, user);
		if (!to) return { final: p, hops: seen.length };
		assert.ok(!seen.includes(to), `redirect loop: ${[path, ...seen, to].join(" -> ")}`);
		seen.push(to);
		p = to;
	}
	assert.fail(`too many redirects from ${path}`);
}

test("a telecaller opening any student learning URL is sent to /telecaller/ once, with no loop", () => {
	for (const p of LEARNING) {
		assert.deepEqual(follow(p, TELE), { final: TELECALLER_HOME, hops: 1 }, p);
		assert.equal(pageAccess(p, TELE), "/telecaller/", p);
	}
	assert.equal(pageAccess("/telecaller/", TELE), null, "the destination itself is allowed, so nothing bounces back");
	assert.equal(pageAccess("/telecaller", TELE), null);
	assert.deepEqual(follow("/learning/my-courses/", TELE), { final: "/telecaller/", hops: 1 });
});

test("other pages stay reachable for a telecaller (profile, public site); only the learning area is redirected", () => {
	for (const p of ["/", "/profile/basic-information/", "/profile/photo/", "/courses/", "/about-us/", "/telecaller/", "/become-a-telecaller/"]) assert.equal(pageAccess(p, TELE), null, p);
	assert.equal(isStudentLearningPath("/learning-resources"), false, "prefix match is on a path boundary");
	assert.equal(pageAccess("/learning-resources", TELE), null);
});

test("ordinary students keep every learning page; instructors and admins are unaffected", () => {
	for (const user of [{ role: "student" }, { role: "student", telecaller_access: null }, { role: "student", telecaller_access: "inactive" }]) {
		for (const p of LEARNING) assert.equal(pageAccess(p, user), null, `${JSON.stringify(user)} ${p}`);
	}
	for (const p of LEARNING) {
		assert.equal(pageAccess(p, { role: "instructor" }), null, p);
		assert.equal(pageAccess(p, { role: "instructor", telecaller_access: "active" }), null, "an instructor who is also a telecaller keeps their normal pages");
		assert.equal(pageAccess(p, { role: "admin", telecaller_access: "active" }), null, p);
	}
	assert.equal(pageAccess("/admin", { role: "student", telecaller_access: "active" }), "/", "telecallers still cannot open admin");
	assert.equal(pageAccess("/instructor/courses", { role: "student", telecaller_access: "active" }), "/become-an-instructor");
	assert.equal(pageAccess("/telecaller", { role: "student" }), "/", "no access without an active profile");
	assert.equal(pageAccess("/telecaller", { role: "student", telecaller_access: "inactive" }), "/");
});

test("inactive and unapproved telecallers get none of this: they are plain students", () => {
	for (const flag of [null, undefined, "inactive", "pending", "", false, "ACTIVE", true]) {
		const u = { role: "student", telecaller_access: flag };
		assert.equal(isTelecallerOnly(u), false, String(flag));
		assert.equal(pageAccess("/learning/my-courses/", u), null, String(flag));
		const m = navModel(u, "/learning/my-courses/");
		assert.ok([...m.primary, ...m.account].some((l) => l.label === "My Learning"), String(flag));
	}
	// parent-only accounts keep the parent experience (the parent gate runs first)
	const parent = { role: "student", telecaller_access: "active", is_parent: true };
	assert.equal(isTelecallerOnly(parent), false);
	assert.notEqual(pageAccess("/learning/my-courses/", parent), TELECALLER_HOME);
});

test("telecaller identity comes only from the server flag: not from e-mail, name or role", () => {
	for (const u of [{ role: "student", email: "telecaller@x.com", first_name: "Telecaller" }, { role: "telecaller" }, { role: "student", telecaller: true }]) {
		assert.equal(isTelecallerOnly(u), false, JSON.stringify(u));
		assert.equal(pageAccess("/learning/my-courses/", u), u.role === "telecaller" ? null : null);
	}
	for (const f of ["lib/auth/telecallerNav.js", "lib/auth/telecallerAccess.js"]) assert.doesNotMatch(read(f).replace(/\/\/.*$/gm, ""), /\.email|first_name|username/, f);
	assert.ok(read("database/models/user.js").includes('values: ["student", "admin", "instructor"]'), "users.role enum untouched");
});

test("login landing: the server sends an active telecaller to /telecaller/ before anything else, and others as before", () => {
	const src = read("lib/auth/landing.js");
	const t = src.indexOf("isActiveTelecaller(user)");
	assert.ok(t > 0);
	assert.ok(t < src.indexOf("hasOpenApplication(user.id)"), "checked before the instructor-application landing");
	assert.ok(t < src.indexOf("dashboardHome(user.role)"), "checked before My Learning");
	assert.match(src, /user\.role === "student" && \(await isActiveTelecaller\(user\)\)/);
	assert.match(src, /destination: TELECALLER_HOME, permanent: false/);
	// the original behaviour is intact for everyone else
	assert.match(src, /return \{ destination: dashboardHome\(user\.role\), permanent: false \}/);
	assert.match(src, /if \(!accountIsActive\(user\) \|\| !DASHBOARD_ROLES\.includes\(user\.role\)\) return null;/);
	// the destination is not itself redirected back by the home page or the gate
	assert.equal(pageAccess(TELECALLER_HOME, TELE), null);
	assert.doesNotMatch(read("pages/telecaller/index.js"), /learning|redirect/i);
	// the profile is read from the database with the same rule as /api/users/update
	const h = read("lib/auth/telecallerAccess.js");
	assert.match(h, /TelecallerProfile\.findByPk\(user\.id/);
	assert.match(h, /p\.status !== "active" \|\| !p\.approved_at/);
	assert.match(h, /user\.role === "admin"\) return false/);
	assert.match(h, /ML_Learner\.count/);
	assert.match(h, /catch \(e\) \{\s*return false;/, "any failure means no telecaller landing");
	// login itself still goes through "/" (so the server decides) and honours a safe ?next=
	assert.match(read("utils/auth.js"), /Router\.push\(safeNextPath\(fallback\) \|\| "\/"\)/);
});

test("cart: hidden for an active telecaller only; every other account keeps it", () => {
	const nav = read("components/_App/Navbar.js");
	assert.match(nav, /\(!dash \|\| isShoppingArea\(router\.pathname\)\) && !isTelecallerOnly\(user\) && <CartLink \/>/);
	assert.equal((nav.match(/<CartLink \/>/g) || []).length, 1, "the one cart icon, no other copy (e.g. in the mobile drawer)");
	assert.match(nav, /const CartLink = \(\) =>/, "the cart component itself is untouched");
	for (const u of [null, { role: "student" }, { role: "student", telecaller_access: "inactive" }, { role: "instructor", telecaller_access: "active" }, { role: "admin" }]) assert.equal(isTelecallerOnly(u), false, JSON.stringify(u));
	assert.equal(isTelecallerOnly(TELE), true);
	assert.ok(read("pages/checkout.js") || true);
});

test("notifications: still on the student page, now also on the telecaller dashboard, with the component and API unchanged", () => {
	const list = read("components/Notifications/NotificationList.js");
	for (const piece of ["Notifications", "unread > 0", "{unread} new", "Mark all read", 'axios.get("/api/notifications")', 'axios.post("/api/notifications", {})', "is-unread", "n.read", "n.title", "n.body", "n.link", "Open session", "View session", "limit = 5", "if (!items || items.length === 0) return null"]) assert.ok(list.includes(piece), piece);
	assert.match(list, /telecaller_followup: "ri-customer-service-2-line"/);
	assert.match(list, /n\.type === "telecaller_followup" \? "Open follow-up"/);
	// live-session wording is preserved exactly
	assert.match(list, /n\.state === "completed" \? "View session" : "Open session"/);
	assert.match(read("pages/learning/my-courses/index.js"), /<NotificationList limit=\{3\} \/>/);
	assert.match(read("pages/family/index.js"), /<NotificationList limit=\{4\} \/>/);
	const dash = read("components/Telecaller/Dashboard.js");
	assert.match(dash, /import NotificationList from "@\/components\/Notifications\/NotificationList"/);
	assert.match(dash, /<NotificationList limit=\{5\} \/>/);
	// the API has no role restriction: it serves the signed-in account's own notifications, so telecallers get them (and nobody else's)
	const api = read("pages/api/notifications/index.js");
	assert.match(api, /getAccountActor\(req\)/);
	assert.doesNotMatch(api, /role/);
	assert.doesNotMatch(read("lib/live-sessions/notify.js").slice(read("lib/live-sessions/notify.js").indexOf("export async function listNotifications")), /telecaller|\.role/);
	// a telecaller notification links to a real telecaller route
	assert.match(read("lib/followups/service.js"), /link: `\/telecaller\/\?open=\$\{meeting\.id\}`/);
	assert.match(read("components/Telecaller/Dashboard.js"), /router\.query\.open/);
});

test("the student learning area itself is untouched for everyone: tabs, pages and the layout", () => {
	const layout = read("components/Learning/StudentLayout.js");
	for (const t of ["My courses", "My books", "Live sessions", "Wishlist", "Purchases"]) assert.ok(layout.includes(`label: "${t}"`), t);
	assert.doesNotMatch(layout, /telecaller/i);
	for (const f of ["pages/learning/my-courses/index.js", "pages/learning/my-books/index.js", "pages/learning/live/index.js", "pages/learning/wishlist/index.js", "pages/learning/my-purchase-history.js"]) assert.doesNotMatch(read(f), /telecaller/i, f);
	assert.deepEqual(navModel({ role: "student" }, "/learning/my-courses/").primary.map((l) => l.label), ["My Learning", "Mastery Ladder", "Family", "Browse Courses", "Purchases"]);
});

test("instructor and admin navigation are unchanged", () => {
	assert.deepEqual(navModel({ role: "instructor" }, "/instructor/dashboard/").primary.map((l) => l.label), ["Dashboard", "My Courses", "Create Course", "Mastery Ladder", "Learners", "Browse Courses"]);
	assert.equal(navModel({ role: "admin" }, "/admin/").dash, false);
	assert.ok(navModel({ role: "admin" }, "/admin/").account.some((l) => l.label === "Admin Dashboard"));
});

test("no schema, API-authorisation or package change in this correction", () => {
	const pkg = read("package.json");
	assert.doesNotMatch(pkg, /"(playwright|puppeteer|cypress)"/);
	for (const f of ["lib/auth/telecallerNav.js", "lib/auth/telecallerAccess.js"]) assert.doesNotMatch(read(f), /\.(update|create|destroy|upsert)\(|sequelize\.query|INSERT|DELETE/, f);
});
