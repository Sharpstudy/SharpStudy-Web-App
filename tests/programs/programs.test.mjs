import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PROGRAMS, programBySlug, programNavItems } from "../../lib/programs/catalog.js";
import { primaryNav, shoppingNav, navModel } from "../../components/_App/accountLinks.js";

const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("exactly the four programs, with the required slugs and titles in order", () => {
	assert.deepEqual(PROGRAMS.map((p) => p.slug), ["personality-enrichment", "mathx", "leadership", "public-speaking"]);
	assert.deepEqual(PROGRAMS.map((p) => p.title), ["Personality Enrichment", "MathX", "Leadership", "Public Speaking"]);
});

test("each program has the sections a public page needs and the six suggested modules", () => {
	for (const p of PROGRAMS) {
		assert.ok(p.overview && p.short, p.slug);
		for (const k of ["objectives", "outcomes", "activities", "assessments"]) assert.ok(p[k].length >= 3, `${p.slug} ${k}`);
		assert.equal(p.modules.length, 6, p.slug);
	}
	assert.deepEqual(programBySlug("mathx").modules.map((m) => m.title), ["Number sense", "Mental mathematics", "Logical reasoning", "Mathematical puzzles", "Problem-solving techniques", "Practical mathematics"]);
});

test("no invented prices, durations or guarantees in the curriculum content", () => {
	const text = JSON.stringify(PROGRAMS);
	assert.ok(!/[$€£₹]\s?\d|\bper (month|week)\b|\bguarantee|\bcertified by\b|\b\d+\s?(weeks?|months?|hours?)\b/i.test(text));
});

test("programBySlug is case-insensitive and rejects unknown slugs", () => {
	assert.equal(programBySlug("MathX").slug, "mathx");
	assert.equal(programBySlug("courses"), null);
	assert.equal(programBySlug(undefined), null);
});

test("public header: Home, About and a Programs dropdown with the four programs; no Courses, Cart or Contact", () => {
	assert.deepEqual(primaryNav.map((l) => l.label), ["Home", "About", "Programs", "Gallery", "Blog", "Careers"]);
	const programs = primaryNav.find((l) => l.label === "Programs");
	assert.deepEqual(programs.children.map((c) => c.label), ["Personality Enrichment", "MathX", "Leadership", "Public Speaking"]);
	assert.deepEqual(programs.children.map((c) => c.href), programNavItems().map((c) => c.href));
	assert.deepEqual(navModel(null, "/").primary, primaryNav);
	assert.deepEqual(navModel(null, "/programs/mathx").primary, primaryNav);
});

test("existing course commerce stays reachable: the shopping areas keep Courses in the header", () => {
	for (const path of ["/courses", "/course/some-course", "/category/x", "/checkout"]) assert.deepEqual(navModel(null, path).primary, shoppingNav, path);
	assert.ok(shoppingNav.some((l) => l.href === "/courses/"));
});

test("route files for the course catalogue, details, cart/checkout and learning still exist", () => {
	for (const f of ["pages/courses/index.js", "pages/course/[slug].js", "pages/checkout.js", "pages/learning/my-courses/index.js", "pages/learning/course/[slug].js", "pages/api/checkout/index.js", "pages/api/all-courses.js"]) {
		assert.ok(fs.existsSync(new URL(`../../${f}`, import.meta.url)), f);
	}
});

test("header shows the cart and course search only in the shopping areas, and a single Login", () => {
	const nav = read("components/_App/Navbar.js");
	assert.match(nav, /shopping && !isTelecallerOnly\(user\) && <CartLink \/>/);
	assert.match(nav, /!dash && shopping && \(/);
	assert.match(nav, />Login</);
});

test("the program pages and overview exist, and the homepage no longer lists courses", () => {
	assert.ok(fs.existsSync(new URL("../../pages/programs/[slug].js", import.meta.url)));
	assert.ok(fs.existsSync(new URL("../../pages/programs/index.js", import.meta.url)));
	const home = read("pages/index.js");
	assert.doesNotMatch(home, /CoursesList|home-courses|Browse courses|\/courses\//);
});

test("the program page is public marketing content: it loads courses only for a signed-in account, through the existing category API", () => {
	const server = read("pages/programs/[slug].js");
	assert.doesNotMatch(server, /api\/categories|fetch\(/, "the page no longer fetches courses on the server for everyone");
	const comp = read("components/Programs/ProgramPage.js");
	assert.match(comp, /if \(!user\) \{\s*setCourses\(\[\]\);\s*return undefined;/, "no signed-in user: no course request is made");
	assert.match(comp, /\/api\/categories\//);
	assert.match(comp, /\{user && \(\s*<section[^>]*id="available"/, "the courses section is rendered only for a signed-in account");
	assert.doesNotMatch(comp + server, /method:\s*["'](POST|PUT|PATCH|DELETE)/i);
	assert.ok(!fs.existsSync(new URL("../../pages/api/programs", import.meta.url)), "no new API surface");
});
