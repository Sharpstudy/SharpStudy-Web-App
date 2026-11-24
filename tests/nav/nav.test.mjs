import test from "node:test";
import assert from "node:assert/strict";
import { navModel, accountLinks, dashboardNav, primaryNav, useDashboardHeader, dashboardHome } from "../../components/_App/accountLinks.js";

const u = (role) => ({ role });
const norm = (h) => h.replace(/\/$/, "") || "/";
const all = (m) => [...m.primary, ...m.account].map((l) => norm(l.href));

test("no destination appears twice for any role on any kind of route", () => {
	for (const role of ["student", "instructor", "admin"]) {
		for (const path of ["/", "/courses", "/learning/my-courses", "/instructor/courses", "/family", "/study", "/admin", "/checkout", "/blog/blogs"]) {
			const m = navModel(u(role), path);
			const hrefs = all(m);
			assert.equal(new Set(hrefs).size, hrefs.length, `${role} ${path}: ${hrefs.join(", ")}`);
		}
	}
});

test("student dashboard navigation: no instructor-only links", () => {
	const m = navModel(u("student"), "/family");
	assert.equal(m.dash, true);
	assert.deepEqual(m.primary.map((l) => l.label), ["My Learning", "Mastery Ladder", "Family", "Browse Courses", "Purchases"]);
	const hrefs = all(m);
	for (const bad of ["/instructor/courses", "/instructor/course/create", "/admin"]) assert.ok(!hrefs.includes(bad), `student must not get ${bad}`);
	assert.deepEqual(m.account.map((l) => l.label), ["Wishlist", "Account Settings"]);
});

test("instructor keeps course management; account section holds only what primary lacks", () => {
	const m = navModel(u("instructor"), "/family");
	assert.deepEqual(m.primary.map((l) => l.label), ["Dashboard", "My Courses", "Create Course", "Mastery Ladder", "Learners", "Browse Courses"]);
	assert.deepEqual(m.account.map((l) => l.label), ["Students", "Teaching Profile", "My Learning", "Purchases", "Wishlist", "Account Settings"]);
});

test("a student with an instructor application sees its status page but no instructor tools", () => {
	const none = navModel(u("student"), "/family");
	assert.ok(!all(none).includes("/become-an-instructor"), "no application, no entry (the public page has the call to action)");
	for (const status of ["draft", "pending", "under_review", "more_info_requested", "rejected"]) {
		const m = navModel({ role: "student", instructor_application_status: status }, "/family");
		assert.ok(all(m).includes("/become-an-instructor"), status);
		for (const bad of ["/instructor/dashboard", "/instructor/courses", "/instructor/course/create", "/instructor/students", "/admin"]) assert.ok(!all(m).includes(bad), `${status} must not get ${bad}`);
	}
	// the status never adds anything for other roles, and an instructor role is never derived from it
	assert.ok(!all(navModel({ role: "instructor", instructor_application_status: "approved" }, "/family")).includes("/become-an-instructor"));
	assert.ok(!all(navModel({ role: "student", instructor_application_status: "approved" }, "/family")).includes("/instructor/dashboard"));
});

test("admins review applications under Admin > Instructors > Requests, with no duplicate entry", () => {
	const hrefs = all(navModel(u("admin"), "/"));
	assert.ok(hrefs.includes("/admin"));
	assert.ok(!hrefs.some((h) => h.includes("instructor/applications")));
});

test("admin is never switched to the dashboard header and keeps the admin entry", () => {
	const m = navModel(u("admin"), "/study");
	assert.equal(m.dash, false);
	assert.deepEqual(m.primary, primaryNav);
	assert.equal(m.account[0].href, "/admin/");
	assert.ok(!all(m).includes("/instructor/courses"));
});

test("public header for visitors and for signed-in users on marketing pages", () => {
	assert.deepEqual(navModel(null, "/learning/my-courses"), { dash: false, primary: primaryNav, account: [] });
	assert.equal(navModel(u("student"), "/blog/blogs").dash, false);
	assert.equal(navModel(u("instructor"), "/about-us").dash, false);
	// signed-in user on a public page: public nav + full account menu, nothing duplicated
	assert.ok(navModel(u("student"), "/blog/blogs").account.some((l) => l.label === "Mastery Ladder"));
});

test("role comes only from the user object, never from the route", () => {
	assert.equal(useDashboardHeader(u("student"), "/instructor/courses"), true);
	assert.ok(!all(navModel(u("student"), "/instructor/courses")).includes("/instructor/course/create"));
	assert.ok(!all(navModel(u("student"), "/admin")).includes("/admin"));
	assert.equal(navModel(u("something-else"), "/family").dash, false, "unknown roles get no dashboard header");
	assert.deepEqual(accountLinks("bogus").map((l) => l.label), accountLinks("student").map((l) => l.label));
});

test("every link is a real internal route with a label", () => {
	for (const l of [...dashboardNav("student"), ...dashboardNav("instructor"), ...accountLinks("admin"), ...accountLinks("instructor")]) {
		assert.match(l.href, /^\/[a-z0-9\-\/]*$/);
		assert.ok(l.label && l.icon);
	}
	assert.equal(dashboardHome("student"), "/learning/my-courses/");
	assert.equal(dashboardHome("instructor"), "/instructor/dashboard/");
});
