// Account dropdown / mobile drawer navigation for approved, ACTIVE telecallers, and unchanged navigation for everyone else.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { navModel, isTelecallerOnly, accountLinks } from "../../components/_App/accountLinks.js";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const labels = (user, path = "/") => navModel(user, path).account.map((l) => l.label);
const STUDENT_ONLY = ["Mastery Ladder", "Family", "My Learning", "My Books", "Purchases", "Wishlist", "Browse Courses", "Browse Books", "Learners"];
const INSTRUCTOR_ONLY = ["Dashboard", "My Courses", "Create Course", "Students", "Teaching Profile", "Instructor Application"];
const PATHS = ["/", "/telecaller/", "/learning/my-courses/", "/study/", "/courses/", "/profile/basic-information/", "/family/", "/books/"];

const TELECALLER = { role: "student", telecaller_access: "active" };

test("approved + active telecaller: ONLY Telecaller Dashboard and Account Settings (Log out is added by the menu), on every route", () => {
	for (const p of PATHS) {
		assert.deepEqual(labels(TELECALLER, p), ["Telecaller Dashboard", "Account Settings"], p);
		const m = navModel(TELECALLER, p);
		assert.equal(m.dash, false, `${p}: no student dashboard header`);
		assert.ok(!m.primary.some((l) => STUDENT_ONLY.includes(l.label)), `${p}: no student links in the header / mobile drawer`);
	}
	const hrefs = navModel(TELECALLER, "/").account.map((l) => l.href);
	assert.deepEqual(hrefs, ["/telecaller/", "/profile/basic-information/"]);
});

test("none of the student, instructor or dashboard links can appear for a telecaller", () => {
	const all = labels({ ...TELECALLER, instructor_application_status: "pending" }, "/learning/my-courses/");
	for (const bad of [...STUDENT_ONLY, ...INSTRUCTOR_ONLY, "Admin Dashboard"]) assert.ok(!all.includes(bad), bad);
});

test("ordinary student: unchanged (no telecaller link, full student menu)", () => {
	const u = { role: "student" };
	assert.deepEqual(labels(u), ["Mastery Ladder", "Family", "My Learning", "My Books", "Purchases", "Wishlist", "Account Settings"]);
	assert.ok(!labels(u, "/learning/my-courses/").includes("Telecaller Dashboard"));
	assert.equal(isTelecallerOnly(u), false);
	assert.equal(navModel(u, "/learning/my-courses/").dash, true, "the student dashboard header is unchanged");
	assert.deepEqual(labels({ role: "student", instructor_application_status: "pending" }), [...labels(u).slice(0, -1), "Instructor Application", "Account Settings"]);
});

test("instructor: unchanged", () => {
	const u = { role: "instructor" };
	assert.deepEqual(labels(u), labels({ role: "instructor", telecaller_access: null }));
	assert.ok(labels(u).includes("My Courses") && labels(u).includes("Account Settings"));
	assert.ok(!labels(u).includes("Telecaller Dashboard"));
	assert.equal(navModel(u, "/instructor/dashboard/").dash, true);
	assert.equal(isTelecallerOnly(u), false);
});

test("admin: unchanged, even if an admin somehow holds a telecaller flag", () => {
	for (const u of [{ role: "admin" }, { role: "admin", telecaller_access: "active" }]) {
		assert.deepEqual(labels(u), ["Admin Dashboard", "Mastery Ladder", "Family", "My Learning", "My Books", "Purchases", "Wishlist", "Account Settings"]);
		assert.equal(navModel(u, "/admin/").dash, false);
		assert.equal(isTelecallerOnly(u), false);
	}
});

test("inactive telecaller profile: no telecaller navigation, the normal student menu", () => {
	// the server sets telecaller_access only for status === "active" with an approved_at; an inactive profile arrives as null
	for (const flag of [null, undefined, "inactive", "", false]) {
		const u = { role: "student", telecaller_access: flag };
		assert.equal(isTelecallerOnly(u), false, String(flag));
		assert.ok(!labels(u).includes("Telecaller Dashboard"), String(flag));
		assert.ok(labels(u).includes("My Learning"), String(flag));
	}
});

test("unapproved telecaller (applicant with no approved profile): no telecaller navigation", () => {
	const u = { role: "student", telecaller_access: null };
	assert.deepEqual(labels(u), labels({ role: "student" }));
	assert.ok(!labels(u).includes("Telecaller Dashboard"));
});

test("only the server flag decides: email, name and role never do", () => {
	for (const u of [{ role: "student", email: "telecaller@example.com", first_name: "Telecaller" }, { role: "telecaller" }, { role: "student", telecaller: true }, { role: "student", telecaller_access: "ACTIVE" }]) assert.equal(isTelecallerOnly(u), false, JSON.stringify(u));
	assert.equal(isTelecallerOnly(null), false);
	assert.equal(isTelecallerOnly(undefined), false);
});

test("edge cases keep their existing experience: instructor who is also a telecaller, parent-only accounts", () => {
	const inst = labels({ role: "instructor", telecaller_access: "active" });
	assert.ok(inst.includes("My Courses") && inst.includes("Telecaller Dashboard"), "instructor tools kept, telecaller link added");
	assert.equal(isTelecallerOnly({ role: "instructor", telecaller_access: "active" }), false);
	const parent = { role: "student", telecaller_access: "active", is_parent: true };
	assert.equal(isTelecallerOnly(parent), false, "a parent-only account is restricted to Progress / Family by the page gate");
	assert.deepEqual(accountLinks("student").map((l) => l.label), accountLinks("student", null, null).map((l) => l.label));
});

test("desktop dropdown and mobile drawer both render the same account list, plus Log out, with no extra links", () => {
	const nav = read("components/_App/Navbar.js");
	assert.match(nav, /navModel\(user, router\.pathname\)/);
	assert.match(nav, /<ProfileDropdown \{\.\.\.user\} links=\{account\} \/>/, "desktop dropdown");
	assert.match(nav, /\{account\.map\(\(l\) => \(/, "mobile drawer account list");
	const dd = read("components/_App/ProfileDropdown.js");
	assert.match(dd, /links\.map\(/);
	assert.match(dd, /Log out/);
	assert.match(nav, /Log out/);
	// neither component hard-codes student links of its own
	for (const src of [nav, dd]) for (const bad of ["Mastery Ladder", "My Learning", "My Books", "Wishlist", "Purchases"]) assert.ok(!src.includes(bad), bad);
});

test("the navigation fix adds no new API and does not authorise anything", () => {
	const src = read("components/_App/accountLinks.js");
	assert.doesNotMatch(src, /axios|fetch\(|require\(|from "@\/(lib|database)/);
	const upd = read("pages/api/users/update.js");
	assert.match(upd, /tp\.status === "active" && tp\.approved_at/, "the flag still comes from the active, approved telecaller_profiles row");
});
