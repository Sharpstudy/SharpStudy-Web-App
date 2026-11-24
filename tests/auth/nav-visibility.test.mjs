// Navigation visibility per account state: header links, profile dropdown and mobile drawer all come from navModel(), which reads the
// server-computed telecaller_state. Student-only links must not be offered to a pending / more-information applicant, a deactivated
// telecaller or an active telecaller; ordinary students, draft / rejected applicants, instructors and admins keep their existing menus.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { navModel } from "../../components/_App/accountLinks.js";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const STUDENT_ONLY = ["Mastery Ladder", "Family", "My Learning", "My Books", "Browse Books", "Purchases", "Wishlist", "Browse Courses", "Learners"];
const labels = (user, path = "/become-a-telecaller/") => {
	const m = navModel(user, path);
	return { primary: m.primary.map((l) => l.label), account: m.account.map((l) => l.label) };
};
const student = (state, extra = {}) => ({ role: "student", telecaller_state: state, telecaller_access: state === "active" ? "active" : null, ...extra });

test("pending, more-information and deactivated: no student link anywhere (dropdown, header, drawer); only application status + settings", () => {
	for (const st of ["pending", "more_info", "inactive"]) {
		for (const path of ["/become-a-telecaller/", "/", "/courses/", "/profile/basic-information/"]) {
			const { primary, account } = labels(student(st), path);
			assert.deepEqual(account, ["Telecaller Application", "Account Settings"], `${st} ${path}`);
			assert.deepEqual(primary, [], `${st} ${path}`);
			for (const bad of STUDENT_ONLY) assert.ok(![...primary, ...account].includes(bad), `${st} ${path} leaks ${bad}`);
		}
	}
});

test("approved active telecaller: only Telecaller Dashboard and Account Settings", () => {
	const { primary, account } = labels(student("active"), "/telecaller/");
	assert.deepEqual(account, ["Telecaller Dashboard", "Account Settings"]);
	assert.deepEqual(primary, []);
});

test("ordinary student, draft and rejected applicants keep the existing student menu (policy: only pending / more-info / deactivated / active are restricted)", () => {
	const base = labels({ role: "student" }, "/learning/my-courses/");
	for (const st of ["none", "draft", "rejected"]) {
		const l = labels(student(st), "/learning/my-courses/");
		assert.deepEqual(l, base, st);
		for (const want of ["My Learning", "Mastery Ladder", "Family"]) assert.ok([...l.primary, ...l.account].includes(want), `${st} keeps ${want}`);
	}
});

test("instructors and admins are unchanged, even with a telecaller application in any state", () => {
	for (const role of ["instructor", "admin"]) {
		const plain = labels({ role }, "/become-a-telecaller/");
		for (const st of ["none", "draft", "pending", "more_info", "rejected", "inactive"]) assert.deepEqual(labels({ role, telecaller_state: st }, "/become-a-telecaller/"), plain, `${role} ${st}`);
	}
	assert.ok(labels({ role: "admin" }).account.includes("Admin Dashboard"));
	assert.ok(labels({ role: "instructor" }, "/instructor/dashboard/").primary.includes("Dashboard"));
});

test("parent-only accounts keep the parent experience (the restriction does not apply to them)", () => {
	assert.deepEqual(labels({ role: "student", is_parent: true, telecaller_state: "pending" }), labels({ role: "student", is_parent: true }));
});

test("no state, no flag and no e-mail is guessed: a missing telecaller_state is an ordinary student", () => {
	assert.deepEqual(labels({ role: "student" }), labels(student("none")));
	assert.deepEqual(labels({ role: "student", telecaller_state: "pending-ish" }), labels(student("none")));
	assert.doesNotMatch(read("components/_App/accountLinks.js"), /@\w+\.\w+|user\.id\s*===/);
});

test("Navbar: restricted applicants get the minimal header (no search, cart, public links or drawer); the dropdown and drawer use the same model", () => {
	const nav = read("components/_App/Navbar.js").replace(/\r\n/g, "\n");
	assert.match(nav, /if \(isTelecallerOnly\(user\) \|\| isTelecallerRestricted\(user\)\) \{/);
	const from = nav.indexOf("if (isTelecallerOnly(user) || isTelecallerRestricted(user))");
	const minimal = nav.slice(from, nav.indexOf("\n\treturn (\n\t\t<>", from + 10));
	assert.ok(minimal.length > 100, "found the minimal header block");
	assert.match(minimal, /<ProfileDropdown \{\.\.\.user\} links=\{account\} \/>/);
	assert.doesNotMatch(minimal, /SearchForm|CartLink|ss-drawer|nav\.map/);
	// both menus are drawn from the one navModel result
	assert.match(nav, /const \{ dash, primary: nav, account \} = navModel\(user, router\.pathname\);/);
	assert.match(nav, /\{account\.map\(\(l\) => \(/, "mobile drawer account list");
	assert.doesNotMatch(read("components/_App/ProfileDropdown.js"), /Mastery|My Learning|Wishlist|Purchases/, "the dropdown has no links of its own");
});

test("the application page re-reads the account state after save / upload / submit / re-apply, so the menu updates without a reload", () => {
	const f = read("components/BecomeATelecaller/TelecallerApplicationForm.js");
	assert.match(f, /import \{ useRouter \} from "next\/router";/);
	assert.match(f, /const router = useRouter\(\);/);
	assert.match(f, /await fn\(\);\s*[\s\S]{0,420}router\.replace\(router\.asPath\)\.catch\(\(\) => \{\}\);/);
	// _app re-runs getInitialProps on a client-side replace and recomputes the user from the database
	const app = read("pages/_app.js");
	assert.match(app, /\/api\/users\/update/);
	assert.match(app, /pageProps\.user = user;/);
});

test("hiding links is not the authorization: the backend gates are still wired", () => {
	assert.match(read("lib/mastery-server/http.js"), /isStudentApiBlocked\(\{ role: user\.role, telecallerState: await telecallerStateFor\(user\), url: req\.url \}\)\) return null/);
	assert.match(read("lib/auth/pageAccess.js"), /isTelecallerRestricted\(user\) && isStudentArea\(p\)\) return APPLICATION_PAGE/);
});
