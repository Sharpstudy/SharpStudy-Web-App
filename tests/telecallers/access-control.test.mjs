// Phase 2 wiring and authorization, checked against the source: every route's guard, the private resume handling,
// what must NOT change (users.role, the Meeting Requests code, the instructor / student navigation), and the pages.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { pageAccess } from "../../lib/auth/pageAccess.js";
import { parentMayOpen, PARENT_HOME } from "../../lib/family/parentMode.js";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../../${p}`, import.meta.url));
const walk = (dir) => readdirSync(new URL(`../../${dir}/`, import.meta.url), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]));

const ADMIN_ROUTES = ["pages/api/admin/telecallers/applications.js", "pages/api/admin/telecallers/members.js", "pages/api/admin/telecallers/summary.js", "pages/api/admin/telecallers/resumes/[id].js"];
const APPLICANT_ROUTES = ["pages/api/telecallers/apply.js", "pages/api/telecallers/resume.js"];

test("every admin telecaller API requires the admin role and nothing else", () => {
	for (const f of ADMIN_ROUTES) {
		const src = read(f);
		assert.match(src, /requireAdminActor\(req, res\)/, f);
		assert.match(src, /if \(!actor\) return;/, f);
		assert.doesNotMatch(src, /requireAccount|req\.body\.role|req\.query\.role/, f);
	}
	// the guard is the verified token + a database role read, with admin as the only allowed role
	assert.match(read("lib/telecallers/http.js"), /requireAdminActor = \(req, res\) => requireRole\(req, res, \["admin"\]\)/);
	assert.match(read("lib/auth/requireRole.js"), /getAccountActor\(req\)/);
	// and the service re-checks it, so a route that forgot would still be refused
	const svc = read("lib/telecallers/service.js");
	for (const fn of ["listApplications", "getApplication", "reviewAction", "getResumeForAdmin", "listMembers", "getMember", "setMemberStatus", "getSummary"]) {
		const body = svc.slice(svc.indexOf(`export async function ${fn}(`));
		assert.match(body.slice(0, 220), /requireAdmin\(actor\)/, fn);
	}
});

test("the applicant APIs are scoped to the signed-in user: no user id, role or status is read from the request", () => {
	for (const f of APPLICANT_ROUTES) {
		const src = read(f);
		assert.match(src, /requireAccount\(req, res\)/, f);
		assert.doesNotMatch(src, /req\.(body|query)\.(user_?id|userId|role|status)|b\.(user_?id|role|status)/, f);
	}
	const svc = read("lib/telecallers/service.js");
	assert.match(svc, /deps\.repo\.getUser\(actor\.userId\)/);
	assert.match(svc, /deps\.repo\.findByUser\(user\.id\)/);
	assert.doesNotMatch(svc, /findById\(input|findByUser\(input|findByUser\(body/);
});

test("approval grants only a telecaller profile: users.role is never written, and no telecaller code can create or update a user", () => {
	for (const f of ["lib/telecallers/service.js", "lib/telecallers/repo.js", "database/models/telecaller.js"]) {
		const src = read(f);
		assert.doesNotMatch(src, /User\.(update|create|destroy|upsert|bulk)/, f);
		assert.doesNotMatch(src, /setRole|role:\s*"(instructor|telecaller)"|role = "(instructor|telecaller)"/, f);
	}
	assert.doesNotMatch(read("database/models/user.js"), /telecaller/i, "the users model / role ENUM is unchanged");
	assert.match(read("lib/telecallers/repo.js"), /TelecallerProfile\.findOrCreate/);
	// the profile is created in the SAME transaction as the status change and its history row
	const tx = read("lib/telecallers/repo.js");
	const t = tx.slice(tx.indexOf("async transition("), tx.indexOf("async setEventEmail"));
	assert.match(t, /TelecallerApplication\.update/);
	assert.match(t, /TelecallerApplicationEvent\.create/);
	assert.match(t, /TelecallerProfile\.findOrCreate/);
	assert.match(t, /connection\.transaction/);
	assert.match(t, /where: \{ id, version: guard\.version, status: guard\.statuses \}/, "compare-and-set on version and allowed statuses");
});

test("resumes: private, immutable, bytes read in one place only, admin-only download with safe headers", () => {
	const model = read("database/models/telecaller.js");
	assert.match(model, /defaultScope: \{ attributes: \{ exclude: \["data"\] \} \}/, "file bytes are excluded from every default query");
	const repo = read("lib/telecallers/repo.js");
	assert.equal((repo.match(/unscoped\(\)/g) || []).length, 1, "exactly one place reads the bytes");
	assert.match(repo, /getResumeWithData\(id\) \{\s*return isUuid\(id\) \? plain\(await TelecallerResume\.unscoped\(\)\.findByPk\(id\)\)/);
	assert.doesNotMatch(repo, /TelecallerResume\.(update|destroy)|TelecallerApplicationEvent\.destroy|TelecallerApplicationEvent\.update\(\{ (?!email_status)/);
	assert.doesNotMatch(read("lib/telecallers/service.js"), /\.data\b[^;]*(res|json)|buffer:\s*r\.data[^,]*applicantView/, "no view includes file bytes");

	const dl = read("pages/api/admin/telecallers/resumes/[id].js");
	assert.match(dl, /requireAdminActor/);
	assert.match(dl, /Content-Disposition.*attachment/);
	assert.match(dl, /X-Content-Type-Options.*nosniff/);
	assert.match(dl, /Content-Security-Policy.*sandbox/);
	assert.match(dl, /getResumeForAdmin/);
	// the filename sanitiser must strip quotes AND backslashes (a header-injection guard); the regex literal is easy to mangle
	assert.ok(dl.includes('.replace(/["\\\\]/g, "_")'), "quotes and backslashes are replaced in the download file name");
	// the applicant upload route has no GET: nothing lets an applicant (or anyone but an admin) read a file back
	assert.match(read("pages/api/telecallers/resume.js"), /methodNotAllowed\(req, res, \["POST"\]\)/);
	assert.match(read("pages/api/telecallers/resume.js"), /sizeLimit: "3\.5mb"/);
	assert.ok(!exists("pages/api/telecallers/resumes"), "no applicant-facing resume download route");
	// no public URL for a resume anywhere
	for (const f of walk("pages").concat(walk("components"))) {
		if (/\.(js|jsx)$/.test(f)) assert.doesNotMatch(read(f), /\/public\/.*resume|resume.*cloudinary/i, f);
	}
	// the download is audited, never with content
	assert.match(read("lib/telecallers/service.js"), /telecaller_resume\.download/);
});

test("event and resume history has no update or delete path: only inserts, plus e-mail bookkeeping on an event", () => {
	const repo = read("lib/telecallers/repo.js");
	assert.doesNotMatch(repo, /destroy\(/);
	assert.doesNotMatch(repo, /TelecallerResume\.update|TelecallerResume\.destroy/);
	assert.equal((repo.match(/TelecallerApplicationEvent\.update/g) || []).length, 1);
	assert.match(repo, /TelecallerApplicationEvent\.update\(\{ email_status: status \}/);
	for (const f of [...ADMIN_ROUTES, ...APPLICANT_ROUTES]) assert.doesNotMatch(read(f), /\bDELETE\b|req\.method === "(DELETE|PATCH)"/, f);
});

test("the Meeting Requests page, API and library are completely unchanged by telecaller work", () => {
	for (const f of [...walk("lib/meetings"), ...walk("pages/api/meetings"), ...walk("pages/api/admin/meetings"), ...walk("pages/admin/meetings"), ...walk("pages/schedule-a-call")]) {
		assert.doesNotMatch(read(f), /telecaller/i, f);
	}
	assert.ok(!exists("pages/admin/telecallers/meetings.js"), "no duplicate meeting-request page");
});

test("the instructor and student navigation are unchanged; the admin sidebar gains one expandable Telecallers group", () => {
	// Phase 3 adds ONE gated entry: the telecaller dashboard link, shown only when the server found an ACTIVE telecaller profile.
	const links = read("components/_App/accountLinks.js");
	assert.match(links, /telecallerAccess === "active" && role !== "admin"/);
	assert.deepEqual([...links.matchAll(/^.*telecaller.*$/gim)].map((m) => m[0].trim()).filter((l) => !l.startsWith("//") && !/^telecaller: \{ href/.test(l) && !/telecallerAccess/.test(l) && !/user\.telecaller_access\)\.filter/.test(l) && !/isTelecallerOnly/.test(l)), [], "no other telecaller reference in the navigation");
	assert.doesNotMatch(read("components/Learning/StudentLayout.js"), /telecaller/i);
	// the page gate: /admin stays admin-only; the only telecaller rule is the /telecaller screen (admin or ACTIVE telecaller)
	const gate = read("lib/auth/pageAccess.js");
	assert.match(gate, /under\(p, "\/admin"\)\) return user && user\.role === "admin" \? null : "\/"/);
	assert.match(gate, /under\(p, "\/telecaller"\)\) return user && \(user\.role === "admin" \|\| user\.telecaller_access === "active"\)/);
	const nav = read("components/_App/AdminSideNav.js");
	for (const label of ["Dashboard", "Courses", "Books", "Instructors", "Students", "Partners", "Testimonials", "Categories", "Coupons", "Meeting requests", "Mastery Ladder"]) assert.match(nav, new RegExp(`label: "${label}"`), label);
	assert.match(nav, /label: "Telecallers"/);
	for (const [href, label] of [["/admin/telecallers/applications/", "Applications"], ["/admin/telecallers/approved/", "Approved Telecallers"], ["/admin/telecallers/rejected/", "Rejected Applications"], ["/admin/telecallers/activity/", "Activity & Call History"]]) {
		assert.match(nav, new RegExp(`href: "${href}", label: "${label}"`), label);
	}
	assert.match(nav, /aria-expanded=\{inside\}/);
	assert.match(nav, /if \(!isAdmin\) \{\s*router\.replace\("\/"\);/, "the original non-admin redirect is kept");
	assert.match(nav, /href: "\/admin\/meetings\/", match: "\/admin\/meetings", label: "Meeting requests"/);
});

test("every admin telecaller page uses the admin layout, and every sub-section of the sidebar exists", () => {
	for (const f of ["pages/admin/telecallers/applications.js", "pages/admin/telecallers/approved.js", "pages/admin/telecallers/rejected.js", "pages/admin/telecallers/activity.js"]) {
		assert.match(read(f), /AdminLayout/, f);
	}
	assert.ok(exists("pages/admin/telecallers/index.js"));
	// the pages are under /admin, which the server-side page gate keeps admin-only
	assert.equal(pageAccess("/admin/telecallers/applications", { role: "student" }), "/");
	assert.equal(pageAccess("/admin/telecallers/approved", { role: "instructor" }), "/");
	assert.equal(pageAccess("/admin/telecallers/rejected", { role: "student", is_parent: true }), PARENT_HOME);
	assert.equal(pageAccess("/admin/telecallers/applications", { role: "admin" }), null);
	assert.equal(pageAccess("/admin/telecallers/activity", null), "/");
	assert.match(read("components/Admin/Telecallers/ApplicationsBoard.js"), /\/api\/admin\/telecallers\/applications/);
	assert.match(read("components/Admin/Telecallers/MembersBoard.js"), /\/api\/admin\/telecallers\/members/);
	assert.match(read("components/Admin/Telecallers/shared.js"), /responseType: "blob"/, "downloads carry the login token");
});

test("the public side: the home card, the route, the sign-in intent, parent access, and the footer", () => {
	const home = read("components/Home/Sections.js");
	assert.match(home, /<h2>Become a Telecaller<\/h2>/);
	assert.match(home, /Join SharpStudy as a telecaller\./);
	assert.match(home, /href="\/become-a-telecaller\/"/);
	assert.match(home, /Apply as Telecaller/);
	assert.match(home, /Teach on SharpStudy/);
	assert.match(home, /SharpStudy for business/);
	assert.match(home, /Talk to our team/);
	assert.ok(exists("pages/become-a-telecaller.js"));
	const app = read("pages/_app.js");
	assert.match(app, /ctx\.pathname === "\/become-a-telecaller"/);
	assert.match(app, /"\/become-a-telecaller": "\/auth\?intent=telecaller&next=%2Fbecome-a-telecaller%2F"/);
	assert.match(app, /"\/become-an-instructor": "\/auth\?intent=instructor&next=%2Fbecome-an-instructor%2F"/, "the instructor intent is intact");
	const auth = read("pages/auth.js");
	assert.match(auth, /Object\.prototype\.hasOwnProperty\.call\(APPLY, query\.intent\)/, "an unknown intent value is ignored");
	assert.match(read("components/_App/Footer.js"), /href: "\/become-a-telecaller\/"/);
	assert.match(read("components/_App/Footer.js"), /href: "\/become-an-instructor\/"/);
});

test("a parent-only account may open the telecaller application page, and still nothing else new", () => {
	const parent = { role: "student", is_parent: true };
	assert.equal(parentMayOpen("/become-a-telecaller"), true);
	assert.equal(pageAccess("/become-a-telecaller", parent), null);
	assert.equal(pageAccess("/become-a-telecaller/", parent), null);
	assert.equal(pageAccess("/become-a-telecallerx", parent), PARENT_HOME, "prefix tricks do not pass");
	assert.equal(pageAccess("/become-an-instructor", parent), PARENT_HOME, "the instructor page stays closed to parent-only accounts");
	assert.equal(pageAccess("/schedule-a-call", parent), PARENT_HOME);
	// everyone else is not affected
	assert.equal(pageAccess("/become-a-telecaller", { role: "student" }), null);
	assert.equal(pageAccess("/become-a-telecaller", { role: "instructor" }), null);
});

test("the form posts only the known fields and the server owns every status; the browser never sends a role", () => {
	const form = read("components/BecomeATelecaller/TelecallerApplicationForm.js");
	const fields = (form.match(/const FIELDS = \[([^\]]*)\]/) || [])[1] || "";
	assert.ok(fields.includes('"full_name"') && fields.includes('"confirmed_adult"'), "the form sends its own field list");
	assert.doesNotMatch(fields, /status|role|user_id|version|attempt|admin_notes|feedback/, "no server-owned field is ever sent by the form");
	assert.match(form, /confirmed_adult/);
	assert.match(form, /18 years old/);
	assert.match(form, /accept="\.pdf,\.doc,\.docx/);
	assert.match(form, /RESUME\.maxBytes/);
	assert.match(form, /Applying does not give any access/);
});

test("every timestamp the telecaller models write keeps milliseconds, so history and resume versions keep their order", async () => {
	const src = read("database/models/telecaller.js");
	assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /DataTypes\.DATE(?!\()/, "no plain DataTypes.DATE (that stores whole seconds)");
	for (const col of ["created_at: D3", "uploaded_at: D3", "approved_at: D3", "submitted_at: D3", "decided_at: D3"]) assert.ok(src.includes(col), col);
	const { createRequire } = await import("node:module");
	const { Sequelize, DataTypes } = createRequire(import.meta.url)("sequelize");
	// the MySQL dialect's own DATE type is what formats values for the database
	const mysql = new Sequelize("x", "x", "x", { dialect: "mysql", host: "127.0.0.1", logging: false });
	const at = new Date("2026-11-03T10:20:30.456Z");
	const opts = { timezone: "+00:00" };
	assert.match(String(mysql.normalizeDataType(DataTypes.DATE(3)).stringify(at, opts)), /\.456/, "a DATE(3) value is written with its milliseconds");
	assert.doesNotMatch(String(mysql.normalizeDataType(DataTypes.DATE).stringify(at, opts)), /\.456/, "...and a plain DATE is not (the bug this guards against)");
});
