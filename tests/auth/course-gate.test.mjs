// Course access requires a login: route protection, API authentication and the public pages (no course entry points).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeNextPath } from "../../lib/books/redirect.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Course-related API files that used to answer anonymous callers and now authenticate FIRST (401 without a login, 403 for another role).
const GATED_APIS = [
	"pages/api/all-courses.js",
	"pages/api/home-courses.js",
	"pages/api/categories/[slug].js",
	"pages/api/courses/course/index.js",
	"pages/api/courses/course/exist.js",
	"pages/api/learnings/videos/[slug].js",
	"pages/api/coupons/get-coupon.js",
	"pages/api/favourites/new.js",
];

test("every course API that was open to visitors now authenticates before it reads anything", () => {
	for (const f of GATED_APIS) {
		const src = read(f);
		assert.match(src, /requireUser/, `${f} uses the existing requireUser (401 / 403)`);
		const handler = src.slice(src.indexOf("export default async function handler"));
		const guard = handler.indexOf("requireUser(req, res)");
		assert.ok(guard > 0, `${f}: the guard is inside the handler`);
		// the guard comes before any database call in the handler
		const firstQuery = handler.search(/\.(findAll|findOne|findByPk|count|create|update|destroy)\(|connection\.query|await fetch/);
		assert.ok(firstQuery === -1 || guard < firstQuery, `${f}: the login check runs before the first database call`);
	}
	assert.doesNotMatch(read("pages/api/courses/course/exist.js"), /optionalActor/, "no anonymous 'false' answer any more");
	assert.doesNotMatch(read("pages/api/learnings/videos/[slug].js"), /optionalActor/);
});

test("the APIs that were already protected still are (instructor, admin, checkout, learning, quizzes, assets, wishlist)", () => {
	for (const f of ["pages/api/checkout/index.js", "pages/api/learnings/index.js", "pages/api/learnings/my-purchases.js", "pages/api/learnings/progress.js", "pages/api/learnings/video/[id].js", "pages/api/courses/index.js", "pages/api/courses/new.js", "pages/api/courses/course/[id].js", "pages/api/courses/course/assets/[id].js", "pages/api/courses/course/upload/new.js", "pages/api/quizzes/student/quiz.js", "pages/api/quizzes/instructor/quiz.js", "pages/api/assets/[id].js", "pages/api/wishlist/index.js", "pages/api/admin/courses/index.js", "pages/api/funfacts.js"]) {
		assert.match(read(f), /requireUser|requireRole|requireCourseManager|getAccountActor|requireQuizOwner|requireAssetManager|requireVideoManager/, f);
	}
});

test("the page gate sends a visitor away from every course area, with ?next= so they come back after signing in", () => {
	const app = read("pages/_app.js");
	assert.match(app, /const COURSE_AREAS = \["\/courses", "\/course", "\/category", "\/checkout", "\/learning"\];/);
	assert.match(app, /inCourseArea\(ctx\.pathname\) \|\|/, "course areas are protected routes");
	assert.match(app, /\/auth\?next=\$\{encodeURIComponent\(ctx\.asPath \|\| ctx\.pathname\)\}/);
	// the existing gates are untouched
	for (const keep of ["isGatedPath(ctx.pathname)", 'ctx.pathname.startsWith("/study")', 'ctx.pathname.startsWith("/family")', "const ifLoggedIn", "pageAccess(ctx.pathname, user)"]) assert.ok(app.includes(keep), keep);
});

test("?next= only ever leads to a same-site path (no open redirect), and the course routes are accepted", () => {
	for (const ok of ["/courses/", "/course/my-course/", "/learning/course/x/", "/checkout/", "/courses/?search=abc"]) assert.equal(safeNextPath(ok), ok, ok);
	for (const bad of ["//evil.example", "https://evil.example/x", "javascript:alert(1)", "/\\evil.example", "/ok\nSet-Cookie: x=1", "", null, undefined, "evil.example"]) assert.equal(safeNextPath(bad), null, String(bad));
});

test("no public page offers a course: footer, header, About, 404, About sections and program pages", () => {
	const footer = read("components/_App/Footer.js");
	const columns = footer.slice(footer.indexOf("const columns = ["), footer.indexOf("const withCourses"));
	assert.doesNotMatch(columns, /\/courses\//, "the static footer columns (what a visitor sees) have no course link");
	assert.match(footer, /\(user \? withCourses\(columns\) : columns\)/, "'All courses' is added for a signed-in account only");
	assert.match(read("components/_App/Navbar.js"), /const shopping = !!user && isShoppingArea\(router\.pathname\);/, "no cart or course search without a login");
	for (const f of ["pages/about-us.js", "pages/404.js", "pages/gallery/index.js", "pages/success-stories/index.js", "pages/blog/blogs.js", "pages/blog/[id].js", "pages/careers/index.js", "pages/contact-us.js", "pages/programs/index.js", "pages/index.js", "components/Home/HeroStats.js", "components/Home/ProgramsHome.js", "components/Sections/HomePreviews.js"]) {
		assert.doesNotMatch(read(f), /href=["'{`]+\/?(courses|course\/|category\/|checkout)|Browse courses|Explore courses|Add to cart|Buy now/i, `${f} has no course entry point`);
	}
	const sections = read("components/Home/Sections.js");
	const finalCta = sections.slice(sections.indexOf("export const FinalCta"));
	assert.doesNotMatch(finalCta, /\/courses\//);
	assert.doesNotMatch(sections.slice(sections.indexOf("const steps"), sections.indexOf("export const HowItWorks")), /catalogue|Choose a course/);
	// public program pages: no server-side course fetch, courses only for a signed-in account
	assert.doesNotMatch(read("pages/programs/[slug].js"), /api\/categories|fetch\(/);
	assert.match(read("components/Programs/ProgramPage.js"), /\{user && \(\s*<section[^>]*id="available"/);
});

test("the public marketing site and Free Demo are untouched: demo buttons, popup, enquiry, program pages, contact, gallery, blog, success stories, login", () => {
	for (const f of ["components/FreeDemo/FreeDemoProvider.js", "components/FreeDemo/FreeDemoModal.js", "components/FreeDemo/DemoBand.js", "pages/programs/[slug].js", "pages/programs/index.js", "pages/contact-us.js", "pages/gallery/index.js", "pages/blog/blogs.js", "pages/success-stories/index.js", "pages/auth.js", "pages/careers/index.js", "pages/schedule-a-call/index.js"]) assert.ok(fs.existsSync(path.join(root, f)), f);
	const app = read("pages/_app.js");
	for (const publicPath of ["/programs", "/gallery", "/blog", "/success-stories", "/contact-us", "/about-us", "/careers"]) assert.ok(!app.slice(app.indexOf("const COURSE_AREAS"), app.indexOf("function MyApp")).includes(`"${publicPath}"`), `${publicPath} is not gated`);
	assert.match(read("components/FreeDemo/FreeDemoModal.js"), /\/api\/meetings\/request/);
	assert.ok(!GATED_APIS.some((f) => /meetings|testimonials|partners/.test(f)), "enquiry and marketing APIs are not gated");
});

test("course code and data are kept: models, pages and APIs still exist for signed-in accounts", () => {
	for (const f of ["pages/courses/index.js", "pages/course/[slug].js", "pages/category/[slug].js", "pages/checkout.js", "pages/learning/my-courses/index.js", "pages/learning/course/[slug].js", "database/models/course.js", "database/models/enrolment.js", "pages/api/checkout/index.js", "pages/api/courses/index.js"]) assert.ok(fs.existsSync(path.join(root, f)), f);
});
