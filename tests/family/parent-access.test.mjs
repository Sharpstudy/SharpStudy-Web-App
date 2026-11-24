// Parent-only accounts see Progress and Family only. A parent is an ordinary `student`-role user; what makes them a parent
// is an active "parent" guardian link (lib/family/parentMode.js). The page gate (lib/auth/pageAccess.js) and the
// is_parent flag (pages/api/users/update.js) run on the server; the navigation, redirects and logout are checked here by
// reading the source because the components cannot be rendered by node:test. Nothing in this file uses a real browser,
// HTTP server or MySQL.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createFamilyRepo } from "./memoryRepo.mjs";
import { parentCode } from "./helpers.mjs";
import { redeemParentLink } from "../../lib/family/links.js";
import { parentOverview } from "../../lib/family/overview.js";
import { isParentOnly, parentMayOpen, PARENT_HOME } from "../../lib/family/parentMode.js";
import { pageAccess, isGatedPath } from "../../lib/auth/pageAccess.js";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";

const root = new URL("../../", import.meta.url);
const src = (p) => readFileSync(new URL(p, root), "utf8");

// ------------------------------------------------------------------ who counts as a parent

const facts = (over = {}) => ({ role: "student", active: true, parentLinks: 1, studentLinks: 0, paidCourses: 0, paidBooks: 0, ...over });

test("parent-only means: student role, linked as a parent, and nothing else that makes them an ordinary student", () => {
	assert.equal(isParentOnly(facts()), true);
	assert.equal(isParentOnly(facts({ parentLinks: 0 })), false, "registered as a parent but nothing linked yet: indistinguishable from a new student");
	assert.equal(isParentOnly(facts({ role: "instructor" })), false);
	assert.equal(isParentOnly(facts({ role: "admin" })), false);
	assert.equal(isParentOnly(facts({ studentLinks: 1 })), false, "a child using their own Study page");
	assert.equal(isParentOnly(facts({ paidCourses: 1 })), false, "an ordinary customer who is also a parent keeps the student experience");
	assert.equal(isParentOnly(facts({ paidBooks: 2 })), false);
	assert.equal(isParentOnly(facts({ active: false })), false);
	for (const bad of [null, undefined, {}]) assert.equal(isParentOnly(bad), false);
});

// ------------------------------------------------------------------ the server-side page gate

test("a parent-only account is sent to Progress from every page except Progress and Family", () => {
	const parent = { role: "student", is_parent: true };
	for (const path of ["/", "/home", "/explore", "/courses", "/courses/some-course", "/books", "/study", "/study/worksheet", "/learning/my-courses", "/learning/my-books", "/learning/wishlist", "/profile/basic-information", "/checkout", "/print", "/instructor/courses", "/admin", "/admin/mastery", "/become-an-instructor", "/blog/blogs", "/auth", "/learn/join", "/some/unknown/page"]) {
		assert.equal(pageAccess(path, parent), PARENT_HOME, path);
	}
	assert.equal(PARENT_HOME, "/family/");
	for (const path of ["/family", "/family/", "/family/manage", "/family/setup", "/terms-conditions", "/privacy-policy", "/_error", "/404"]) {
		assert.equal(pageAccess(path, parent), null, path);
	}
	assert.equal(parentMayOpen("/family-fake"), false, "prefix tricks do not pass");
	assert.equal(pageAccess("/familyx", parent), PARENT_HOME);
});

test("everyone else keeps exactly the access they had", () => {
	const student = { role: "student" };
	const flagFalse = { role: "student", is_parent: false };
	for (const u of [student, flagFalse]) {
		for (const path of ["/", "/explore", "/courses", "/study", "/family", "/learning/my-courses", "/profile/basic-information", "/print"]) assert.equal(pageAccess(path, u), null, `student ${path}`);
		assert.equal(pageAccess("/admin", u), "/");
		assert.equal(pageAccess("/instructor/courses", u), "/become-an-instructor");
	}
	const instructor = { role: "instructor" };
	assert.equal(pageAccess("/instructor/courses", instructor), null);
	assert.equal(pageAccess("/admin", instructor), "/");
	assert.equal(pageAccess("/study", instructor), null);
	assert.equal(pageAccess("/", instructor), null);
	const admin = { role: "admin" };
	for (const path of ["/admin", "/admin/mastery", "/instructor/courses", "/", "/family"]) assert.equal(pageAccess(path, admin), null, path);
	assert.equal(pageAccess("/", null), null, "anonymous visitors are not affected here (the protected-route list handles sign-in)");
	assert.equal(isGatedPath("/admin") && isGatedPath("/instructor/x") && !isGatedPath("/family"), true);
	// a role claim cannot be smuggled in: only the server-computed is_parent flag is read, and only for the student role path
	assert.equal(pageAccess("/", { role: "instructor", is_parent: false }), null);
});

test("is_parent is computed on the server from the database, per request", () => {
	const api = src("pages/api/users/update.js");
	assert.match(api, /ML_Guardian\.count\(\{ where: \{ user_id: userId, relation: "parent" \} \}\)/);
	assert.match(api, /ML_Learner\.count\(\{ where: \{ student_user_id: userId \} \}\)/);
	assert.match(api, /Enrolment\.count\(\{ where: \{ userId, status: "paid" \} \}\)/);
	assert.match(api, /BookOrder\.count/);
	assert.match(api, /is_parent = false;\s*\}/, "any failure means: not a parent");
	assert.doesNotMatch(api, /req\.(body|query)\.is_parent|jwt\.verify[^;]*is_parent/);
	// _app passes the database user (not token claims) to the gate on every page load and client navigation
	const app = src("pages/_app.js");
	assert.match(app, /pageAccess\(ctx\.pathname, user\)/);
	assert.match(app, /\/api\/users\/update/);
	assert.match(src("lib/auth/pageAccess.js"), /user && user\.is_parent/);
});

// ------------------------------------------------------------------ navigation, logo, logout

test("the parent layout shows only Progress and Family, a Logout button, and a logo that stays in the family area", () => {
	const shell = src("components/Family/FamilyShell.js");
	assert.match(shell, /PARENT_NAV = NAV\.filter\(\(n\) => n\.label === "Progress" \|\| n\.label === "Family"\)/);
	assert.match(shell, /const parentMode = !!\(user && user\.is_parent\)/);
	assert.match(shell, /const items = parentMode \? PARENT_NAV : NAV/);
	assert.match(shell, /<Link href=\{parentMode \? PARENT_HOME : "\/"\}>/);
	assert.match(shell, /parentMode && \(\s*<li>\s*<button[^>]*onClick=\{handleParentLogout\}/);
	// the full list is untouched for non-parents, and nothing for Home / Explore is reachable from the parent list
	const nav = shell.slice(shell.indexOf("const NAV = ["), shell.indexOf("];", shell.indexOf("const NAV = [")));
	for (const label of ["Home", "Explore", "Progress", "Family"]) assert.match(nav, new RegExp(`label: "${label}"`));
	const parentLabels = ["Progress", "Family"];
	assert.deepEqual(parentLabels.filter((l) => !nav.includes(`label: "${l}"`)), []);
	assert.doesNotMatch(src("components/Family/ParentDashboard.js"), /href="\/(explore|courses|books|study|learning)/);
});

test("logout clears the session through the existing mechanism and returns to the parent sign-in", () => {
	const auth = src("utils/auth.js");
	const fn = auth.slice(auth.indexOf("export const handleParentLogout"), auth.indexOf("export const handleLogout"));
	assert.match(fn, /cookie\.remove\("edmy_users_token"\)/);
	assert.match(fn, /clearLearnerSession\(\)/);
	assert.match(fn, /Router\.push\("\/auth\?for=family"\)/);
	assert.doesNotMatch(fn, /localStorage|password/);
	// the ordinary logout is unchanged
	assert.match(auth, /export const handleLogout = \(\) => \{\s*cookie\.remove\("edmy_users_token"\);\s*clearLearnerSession\(\);\s*Router\.push\("\/"\);/);
	// without the cookie the family area requires sign-in again (and so do the other protected parents' screens)
	const app = src("pages/_app.js");
	assert.match(app, /if \(!edmy_users_token\) \{[\s\S]*ctx\.pathname\.startsWith\("\/family"\)[\s\S]*redirectUser\(ctx, "\/auth"\)/);
});

// ------------------------------------------------------------------ registration, login, linking land on Progress with no pairing step

test("registration, login and a successful link all end on Progress; no QR or pairing step is forced", () => {
	assert.match(src("components/Authentication/RegisterForm.js"), /asParent \? "\/family\/" : "\/"/);
	assert.match(src("components/Authentication/LoginForm.js"), /asParent \? "\/family\/" : "\/"/);
	const setup = src("components/Family/Setup.js");
	assert.match(setup, /onLinked=\{async \(\) => \{ setLinking\(false\); router\.push\(PARENT_HOME\); \}\}/);
	assert.doesNotMatch(setup, /setStep\(data\.pinSet \? 3 : 2\)/, "the Continue button no longer walks into PIN / pairing");
	assert.doesNotMatch(setup, /else if \(!d\.pinSet\) setStep\(2\)/, "no automatic PIN step");
	assert.match(setup, /router\.query\.step === "2"/);
	assert.match(setup, /router\.query\.step === "3" && d\.pinSet/);
	assert.match(setup, /router\.replace\(PARENT_HOME\)/);
	assert.match(src("components/Family/ManageFamily.js"), /onLinked=\{\(\) => \{ setLinkOpen\(false\); router\.push\(PARENT_HOME\); \}\}/);
	// pairing and the family PIN still exist where they are wanted on purpose
	assert.ok(existsSync(new URL("components/Family/PairDevice.js", root)));
	assert.match(src("components/Family/ManageFamily.js"), /PairPanel/);
	assert.match(src("components/Family/PairDevice.js"), /\/family\/setup\/\?step=2/);
	assert.ok(existsSync(new URL("pages/api/family/pairing/index.js", root)));
	// linking still uses the child-generated link code, not a pairing code
	assert.match(src("components/Family/LinkChild.js"), /parent\.link\(code\.trim\(\)\)/);
	assert.doesNotMatch(src("components/Family/LinkChild.js"), /createPairing|pairing/i);
});

// ------------------------------------------------------------------ a parent sees only their own linked child

const account = (userId, role = "student") => ({ kind: "account", userId, role, permissions: resolvePermissions(role, []) });
const ctx = (t = Date.parse("2026-10-28T10:00:00Z")) => ({ now: t });

test("Progress shows only the signed-in parent's linked children, never other families, codes or private details", async () => {
	const repo = createFamilyRepo();
	repo._db.users.push(
		{ id: "teacher", email: "teacher@example.com", role: "instructor", status: true },
		{ id: "pA", email: "pa@example.com", role: "student", status: true },
		{ id: "pB", email: "pb@example.com", role: "student", status: true },
		{ id: "pNone", email: "none@example.com", role: "student", status: true }
	);
	const teacher = account("teacher", "instructor");
	const maya = await svc.createLearner(repo, teacher, { displayName: "Maya", pin: "1234" }, ctx());
	const zed = await svc.createLearner(repo, teacher, { displayName: "Zed", pin: "1234" }, ctx());
	await repo.updateLearner(maya.id, { contact_email: "private-contact@example.com", contact_phone: "+15550100" });
	const link = async (parent, kid) => redeemParentLink(repo, parent, { code: (await parentCode(repo, kid.id, ctx())).code }, ctx());
	await link(account("pA"), maya);
	await link(account("pB"), zed);

	const a = await parentOverview(repo, account("pA"), ctx());
	assert.deepEqual(a.children.map((c) => c.nickname), ["Maya"]);
	const text = JSON.stringify(a);
	for (const secret of ["Zed", "pb@example.com", "pa@example.com", "teacher@example.com", "private-contact", "+15550100", "code_hash", "link"]) assert.ok(!text.includes(secret), `Progress must not contain ${secret}`);
	for (const key of ["summary", "subjects", "worksheets", "recent"]) assert.ok(key in a.children[0], `keeps ${key}`);
	assert.deepEqual((await parentOverview(repo, account("pNone"), ctx())).children, [], "an unlinked account sees nothing");
	assert.deepEqual((await parentOverview(repo, account("teacher", "instructor"), ctx())).children, [], "an instructor is not a parent by owning the profile");
	await assert.rejects(parentOverview(repo, null, ctx()), { status: 401 });
});

// ------------------------------------------------------------------ guardrails

test("no new schema or role was introduced, and the instructor/admin family page is untouched", () => {
	assert.doesNotMatch(src("database/models/user.js"), /parent/i);
	assert.match(src("pages/family/index.js"), /user\.role === "instructor" \|\| user\.role === "admin"\) \? \(\s*<StaffLearnerPage/);
	assert.match(src("pages/api/family/overview.js"), /parentOverview\(familyRepo, actor, \{\}\)/);
});
