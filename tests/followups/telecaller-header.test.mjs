// The telecaller header: logo + account menu only. Everyone else's header is unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { navModel, isTelecallerOnly } from "../../components/_App/accountLinks.js";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const nav = read("components/_App/Navbar.js");

// The two render branches of the Navbar component.
const start = nav.indexOf("if (isTelecallerOnly(user)) {");
const mainReturn = nav.indexOf("\treturn (\n\t\t<>\n\t\t\t<a href=\"#main\"", start) >= 0 ? nav.indexOf("\treturn (\n\t\t<>\n\t\t\t<a href=\"#main\"", start) : nav.indexOf("\treturn (\r\n\t\t<>\r\n\t\t\t<a href=\"#main\"", start);
const minimal = nav.slice(start, mainReturn);
const normal = nav.slice(mainReturn);

test("both branches exist, and hooks run before the early return (no conditional hooks)", () => {
	assert.ok(start > 0 && mainReturn > start);
	const before = nav.slice(0, start);
	assert.ok((before.match(/useEffect\(/g) || []).length >= 3 && /useState\(false\)/.test(before));
	assert.doesNotMatch(minimal, /use(State|Effect|Selector|Router)\(/, "no hook inside the minimal branch");
});

test("telecaller header: ONLY the logo and the profile dropdown", () => {
	assert.match(minimal, /<img src="\/images\/sharpstudy\.png" alt="SharpStudy"/);
	assert.match(minimal, /<ProfileDropdown \{\.\.\.user\} links=\{account\} \/>/);
	assert.match(minimal, /<Link href=\{TELECALLER_HOME\}>/, "the logo goes to the telecaller dashboard");
	for (const gone of ["ss-header__nav", "nav.map", "SearchForm", "ss-header__search", "CartLink", "ss-header__toggle", "ss-drawer", "Open menu", "Log in", "Get started", "Courses", "Books", "Blog", "About", "Contact", "isShoppingArea"]) assert.ok(!minimal.includes(gone), `minimal header must not contain: ${gone}`);
	assert.ok(minimal.includes("ss-header__actions"), "the menu sits in the right-aligned actions slot, so there is no empty gap");
	assert.ok(minimal.includes('id="main"'), "the skip-link target is kept");
	assert.equal((minimal.match(/<header /g) || []).length, 1);
});

test("the menu holds only Telecaller Dashboard and Account Settings; the dropdown adds Log out", () => {
	const m = navModel({ role: "student", telecaller_access: "active" }, "/telecaller/");
	assert.deepEqual(m.account.map((l) => [l.label, l.href]), [["Telecaller Dashboard", "/telecaller/"], ["Account Settings", "/profile/basic-information/"]]);
	assert.deepEqual(m.primary, [], "no public or student navigation");
	assert.equal(m.dash, false);
	const dd = read("components/_App/ProfileDropdown.js");
	assert.match(dd, /links\.map\(/);
	assert.match(dd, /Log out/);
	for (const p of ["/", "/telecaller/", "/profile/basic-information/", "/courses/", "/learning/my-courses/"]) assert.deepEqual(navModel({ role: "student", telecaller_access: "active" }, p).account.map((l) => l.label), ["Telecaller Dashboard", "Account Settings"], p);
});

test("every other visitor keeps the full header: public nav, search, cart, menu button and drawer", () => {
	for (const piece of ['className="ss-header__nav"', "nav.map((item)", "<SearchForm", "ss-header__search", "<CartLink />", "ss-header__toggle", 'id="ss-drawer"', "Log in", "Get started", "Mobile / tablet drawer", "dashboardHome(user.role)"]) assert.ok(normal.includes(piece), `normal header must still contain: ${piece}`);
	assert.match(normal, /\(!dash \|\| isShoppingArea\(router\.pathname\)\) && !isTelecallerOnly\(user\) && <CartLink \/>/);
	const labels = (u, p) => navModel(u, p).primary.map((l) => l.label);
	assert.deepEqual(labels(null, "/"), ["Home", "Courses", "Books", "Blog", "About", "Contact"]);
	assert.deepEqual(labels({ role: "student" }, "/"), ["Home", "Courses", "Books", "Blog", "About", "Contact"]);
	assert.deepEqual(labels({ role: "student" }, "/learning/my-courses/"), ["My Learning", "Mastery Ladder", "Family", "Browse Courses", "Purchases"]);
	assert.deepEqual(labels({ role: "instructor" }, "/instructor/dashboard/"), ["Dashboard", "My Courses", "Create Course", "Mastery Ladder", "Learners", "Browse Courses"]);
	assert.deepEqual(labels({ role: "admin" }, "/"), ["Home", "Courses", "Books", "Blog", "About", "Contact"]);
	assert.ok(navModel({ role: "admin" }, "/admin/").account.some((l) => l.label === "Admin Dashboard"));
});

test("inactive, unapproved, instructor-telecaller and parent-only accounts do not get the minimal header", () => {
	for (const u of [{ role: "student", telecaller_access: null }, { role: "student", telecaller_access: "inactive" }, { role: "student" }, { role: "instructor", telecaller_access: "active" }, { role: "admin", telecaller_access: "active" }, { role: "student", telecaller_access: "active", is_parent: true }, { role: "student", email: "telecaller@x.com" }, null]) {
		assert.equal(isTelecallerOnly(u), false, JSON.stringify(u));
		assert.ok(navModel(u, "/").primary.length > 0, JSON.stringify(u));
	}
});

test("responsive: no extra CSS that could add empty space, overflow or break the dropdown; the dropdown fits 390px", () => {
	const css = read("styles/sharpstudy/_shell.scss");
	assert.match(css, /&__actions \{[^}]*margin-left: auto;/s, "actions are pushed to the right edge");
	assert.match(css, /width: min\(280px, calc\(100vw - 24px\)\)/, "the dropdown panel is never wider than the viewport");
	assert.ok(280 + 24 <= 390, "280px panel + gutter fits a 390px screen");
	assert.doesNotMatch(read("styles/sharpstudy/_telecaller.scss"), /ss-header/, "no header overrides");
	assert.ok(!nav.includes("ss-header--minimal {") && !css.includes("ss-header--minimal"), "the minimal header reuses the existing header styles");
});

test("security and scope: display only, no role, no e-mail matching, telecaller dashboard untouched", () => {
	const flag = read("lib/auth/telecallerNav.js");
	assert.match(flag, /user\.role === "student" && user\.telecaller_access === "active" && !user\.is_parent/);
	assert.doesNotMatch(minimal + flag.replace(/\/\/.*$/gm, ""), /\.email|first_name|username/);
	assert.ok(read("database/models/user.js").includes('values: ["student", "admin", "instructor"]'));
	// the server side is untouched by this change: the page and every API still re-check access from the database
	assert.match(read("lib/followups/service.js"), /repo\.getProfile\(user\.id\)/);
	assert.match(read("pages/api/telecaller/summary.js"), /requireAccount\(req, res\)/);
	// the dashboard still has all of its sections
	const dash = read("components/Telecaller/Dashboard.js");
	for (const piece of ["<NotificationList limit={5} />", "Meeting requests", "Unclaimed", "My follow-ups", "Due today", "Overdue", "Completed", "Search name, phone, email or reference", "<MeetingDetail", "Recent call activity", "My overdue"]) assert.ok(dash.includes(piece), piece);
});
