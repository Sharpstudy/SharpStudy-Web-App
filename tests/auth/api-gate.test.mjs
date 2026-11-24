// Backend isolation: the student-content APIs refuse telecaller applicants / telecallers, decided from the database state, not the page.
// Covers the permission matrix for every account state and classifies EVERY file under pages/api so a new API area cannot be forgotten.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isStudentApiBlocked, isStudentContentApi, API_AREAS, STUDENT_CONTENT_API } from "../../lib/auth/apiPolicy.js";

const ROOT = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

const STUDENT_URLS = [
	"/api/learnings", "/api/learnings/progress?x=1", "/api/learnings/videos/intro", "/api/mastery/me", "/api/mastery/study/start", "/api/mastery/study/submit",
	"/api/mastery/print", "/api/mastery/learners/overview", "/api/family/overview", "/api/family/children/abc", "/api/books/b1/access", "/api/books/b1/content",
	"/api/books/b1/progress", "/api/books/mine", "/api/books/checkout", "/api/checkout", "/api/wishlist", "/api/favourites/new", "/api/subscriptions/new",
	"/api/quizzes/student/quiz", "/api/live-sessions/s1/join", "/api/live-questions/q/state", "/api/assets/a1", "/api/courses/course/c1", "/api/coupons/get-coupon",
];
const OTHER_URLS = [
	"/api/telecallers/apply", "/api/telecallers/resume", "/api/notifications", "/api/users/update", "/api/users/signin", "/api/meetings/request", "/api/contact",
	"/api/telecaller/summary", "/api/telecaller/meetings", "/api/admin/telecallers/applications", "/api/instructor/dashboard", "/api/categories", "/api/courses",
	"/api/courses/new", "/api/books", "/api/books/home", "/api/coupons/new", "/api/quizzes/instructor/quiz", "/api/students", "/api/home-courses",
];

test("path classification: student-content areas are matched on a path boundary and ignore the query string", () => {
	for (const u of STUDENT_URLS) assert.ok(isStudentContentApi(u), u);
	for (const u of OTHER_URLS.filter((u) => !["/api/books/home", "/api/books"].includes(u))) assert.ok(!isStudentContentApi(u), u);
	assert.ok(!isStudentContentApi("/api/mastery-other"), "boundary");
	assert.ok(!isStudentContentApi("/api/learningsX"));
	assert.ok(isStudentContentApi("/api/learnings/?a=b"));
});

// the permission matrix: role x state x (student-content API | other API)
const STATES = ["none", "draft", "rejected", "pending", "more_info", "inactive", "active"];
const EXPECT_BLOCKED = { none: false, draft: false, rejected: false, pending: true, more_info: true, inactive: true, active: true };

test("permission matrix: student-content APIs by account state (role student)", () => {
	for (const st of STATES) {
		for (const url of STUDENT_URLS) assert.equal(isStudentApiBlocked({ role: "student", telecallerState: st, url }), EXPECT_BLOCKED[st], `${st} ${url}`);
		for (const url of OTHER_URLS.filter((u) => !isStudentContentApi(u))) assert.equal(isStudentApiBlocked({ role: "student", telecallerState: st, url }), false, `${st} (shared/other) ${url}`);
	}
});

test("permission matrix: admins and instructors are never affected, whatever telecaller state they carry", () => {
	for (const role of ["admin", "instructor"]) for (const st of STATES) for (const url of STUDENT_URLS) assert.equal(isStudentApiBlocked({ role, telecallerState: st, url }), false, `${role} ${st} ${url}`);
});

test("the applicant and telecaller routes themselves stay reachable for the people who need them", () => {
	for (const st of ["pending", "more_info", "inactive", "active"]) {
		for (const url of ["/api/telecallers/apply", "/api/telecallers/resume", "/api/notifications", "/api/users/update", "/api/telecaller/summary", "/api/telecaller/meetings/abc", "/api/meetings/request"]) {
			assert.equal(isStudentApiBlocked({ role: "student", telecallerState: st, url }), false, `${st} ${url}`);
		}
	}
});

test("enforcement is in getAccountActor: database state, after the token/role/confirmation/revocation checks, never the JWT role", () => {
	const src = read("lib/mastery-server/http.js");
	const fn = src.slice(src.indexOf("export async function getAccountActor"), src.indexOf("export async function getLearnerActor"));
	assert.match(fn, /repo\.getUser\(claims\.userId\)/, "role comes from the database row");
	assert.match(fn, /isStudentApiBlocked\(\{ role: user\.role, telecallerState: await telecallerStateFor\(user\), url: req\.url \}\)\) return null/);
	assert.ok(fn.indexOf("isTokenRevoked") < fn.indexOf("isStudentApiBlocked"));
	assert.ok(fn.indexOf("!user.email_confirmed") < fn.indexOf("isStudentApiBlocked"));
	assert.doesNotMatch(fn, /claims\.role/, "the JWT role claim is never used");
	// the state itself: from the profile + application rows, learner logins excluded
	const t = read("lib/auth/telecallerAccess.js");
	assert.match(t, /TelecallerProfile\.findByPk\(user\.id/);
	assert.match(t, /TelecallerApplication\.findOne\(\{ where: \{ user_id: user\.id \}/);
});

test("the SSR book purchase page is closed to them too", async () => {
	const { pageAccess } = await import("../../lib/auth/pageAccess.js");
	for (const st of ["pending", "more_info", "inactive"]) assert.equal(pageAccess("/books/my-book/checkout/", { role: "student", telecaller_state: st }), "/become-a-telecaller/", st);
	assert.equal(pageAccess("/books/my-book/checkout/", { role: "student", telecaller_state: "none" }), null);
	assert.equal(pageAccess("/books/my-book/", { role: "student", telecaller_state: "pending" }), null, "the public book page stays public");
});

test("every folder under pages/api has an explicit decision (student / mixed / other), and student ones are covered by a prefix", () => {
	const dir = fileURLToPath(new URL("pages/api/", ROOT));
	const tops = [...new Set(readdirSync(dir).map((n) => n.replace(/\.(js|json)$/, "")))];
	for (const t of tops) assert.ok(Object.prototype.hasOwnProperty.call(API_AREAS, t), `pages/api/${t} has no entry in lib/auth/apiPolicy.js API_AREAS: decide whether it is student content`);
	for (const t of Object.keys(API_AREAS)) assert.ok(tops.includes(t), `API_AREAS lists a folder that does not exist: ${t}`);
	for (const [t, kind] of Object.entries(API_AREAS)) {
		if (kind === "student") assert.ok(STUDENT_CONTENT_API.some((p) => p === `/api/${t}`), `${t} is student content but has no prefix`);
	}
	// walk every file so a student-content route outside the listed prefixes is noticed: files in "mixed" areas must be named below
	const MIXED_STUDENT = { quizzes: ["student"], coupons: ["get-coupon.js"], courses: ["course"] };
	for (const [t, kind] of Object.entries(API_AREAS).filter(([, k]) => k === "mixed")) {
		const sub = readdirSync(path.join(dir, t));
		for (const n of sub) {
			const isStudent = (MIXED_STUDENT[t] || []).includes(n);
			const url = `/api/${t}/${n.replace(/\.js$/, "")}`;
			assert.equal(isStudentContentApi(url) || (statSync(path.join(dir, t, n)).isDirectory() && isStudentContentApi(`${url}/x`)), isStudent, `${url} classification`);
		}
	}
});
