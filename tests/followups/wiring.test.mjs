// Phase 3 wiring, checked against the source: every route's guard, the screen gate, what must NOT change (users.role, the Meeting
// Requests workflow, the schema), and the pure date rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { pageAccess, isGatedPath } from "../../lib/auth/pageAccess.js";
import { accountLinks, navModel } from "../../components/_App/accountLinks.js";
import { localDayBounds, makeContext, matchesFilter, validateCall, validateStatusChange, nextFollowUp, parseVersion, LIMITS } from "../../lib/followups/rules.js";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../../${p}`, import.meta.url));

const TELE_ROUTES = ["pages/api/telecaller/summary.js", "pages/api/telecaller/meetings/index.js", "pages/api/telecaller/meetings/[id].js", "pages/api/telecaller/team.js"];

test("every telecaller API identifies the caller by the verified token and hands the decision to the service (database-backed access)", () => {
	for (const f of TELE_ROUTES) {
		const src = read(f);
		assert.match(src, /requireAccount\(req, res\)/, f);
		assert.match(src, /if \(!actor\) return;/, f);
		assert.match(src, /followupDeps\(\)/, f);
		assert.doesNotMatch(src, /req\.(body|query)\.(user_?id|userId|role|telecaller)\b/, `${f} must not take identity or role from the request`);
		assert.doesNotMatch(src, /telecaller_access/, `${f}: the page flag is never used to authorise an API`);
	}
	const http = read("lib/followups/http.js");
	assert.match(http, /requireRole\(req, res, \["student", "instructor", "admin"\]\)/);
	// the service decides from the database on every call
	const svc = read("lib/followups/service.js");
	assert.match(svc, /repo\.getUser\(actor\.userId\)/);
	assert.match(svc, /repo\.getProfile\(user\.id\)/);
	assert.match(svc, /profile\.status !== "active"/);
	for (const fn of ["getDashboard", "listMeetings", "getMeeting", "listTelecallerOptions", "claimMeeting", "transferMeeting", "recordCall", "changeStatus"]) {
		const body = svc.slice(svc.indexOf(`export async function ${fn}(`));
		assert.match(body.slice(0, 260), /await (access|requireTelecaller)\(deps, actor\)/, fn);
	}
	for (const fn of ["adminAssign", "adminClear", "listActivity"]) {
		const body = svc.slice(svc.indexOf(`export async function ${fn}(`));
		assert.match(body.slice(0, 260), /await requireAdmin\(deps, actor\)/, fn);
	}
});

test("the admin activity API is admin-only, and mutating routes only accept POST (no PUT / DELETE)", () => {
	const admin = read("pages/api/admin/telecallers/activity.js");
	assert.match(admin, /requireAdminActor\(req, res\)/);
	assert.match(admin, /methodNotAllowed\(req, res, \["GET", "POST"\]\)/);
	assert.deepEqual([...admin.matchAll(/b\.action === "([a-z]+)"/g)].map((m) => m[1]), ["assign", "clear"]);
	for (const f of TELE_ROUTES) assert.doesNotMatch(read(f), /"PUT"|"DELETE"|"PATCH"/, f);
});

test("telecaller routes cannot reach admin-only application review or resume download", () => {
	for (const f of [...TELE_ROUTES, "lib/followups/service.js", "lib/followups/repo.js", "components/Telecaller/Dashboard.js", "components/Telecaller/MeetingDetail.js"]) {
		assert.doesNotMatch(read(f), /admin\/telecallers\/(applications|resumes|members)|lib\/telecallers\/service|getResumeForAdmin|reviewAction/, f);
	}
	// and those admin APIs still demand the admin role (Phase 2 guards unchanged)
	for (const f of ["applications.js", "members.js", "summary.js", "resumes/[id].js"]) assert.match(read(`pages/api/admin/telecallers/${f}`), /requireAdminActor\(req, res\)/, f);
});

test("the /telecaller screen gate: an admin or an account with an ACTIVE profile only; everything else is sent home", () => {
	assert.equal(pageAccess("/telecaller", { role: "admin" }), null);
	assert.equal(pageAccess("/telecaller/", { role: "student", telecaller_access: "active" }), null);
	assert.equal(pageAccess("/telecaller/", { role: "instructor", telecaller_access: "active" }), null);
	for (const u of [{ role: "student" }, { role: "student", telecaller_access: null }, { role: "student", telecaller_access: "inactive" }, { role: "instructor" }, null, undefined]) assert.equal(pageAccess("/telecaller", u), "/", JSON.stringify(u));
	assert.equal(isGatedPath("/telecaller"), true);
	assert.equal(isGatedPath("/telecaller/"), true);
	assert.equal(isGatedPath("/become-a-telecaller"), false, "the application page stays open to any signed-in account");
	assert.equal(pageAccess("/become-a-telecaller", { role: "student" }), null);
	// admin and instructor gates unchanged
	assert.equal(pageAccess("/admin", { role: "student" }), "/");
	assert.equal(pageAccess("/admin", { role: "admin" }), null);
	assert.equal(pageAccess("/instructor/courses", { role: "student" }), "/become-an-instructor");
	// a child / parent-only account never reaches it
	assert.notEqual(pageAccess("/telecaller", { role: "student", is_parent: true, telecaller_access: "active" }), null);
});

test("the nav shows the telecaller dashboard only to active telecallers (never admins, never to others) and the user flag is computed from the database", () => {
	const labels = (u) => navModel(u, "/learning/my-courses/").account.map((l) => l.label);
	assert.ok(!labels({ role: "student" }).includes("Telecaller Dashboard"));
	assert.ok(labels({ role: "student", telecaller_access: "active" }).includes("Telecaller Dashboard"));
	assert.ok(labels({ role: "instructor", telecaller_access: "active" }).includes("Telecaller Dashboard"));
	assert.ok(!accountLinks("admin", null, "active").map((l) => l.label).includes("Telecaller Dashboard"));
	assert.deepEqual(accountLinks("student").map((l) => l.label), accountLinks("student", null, null).map((l) => l.label), "no change for everyone else");
	const upd = read("pages/api/users/update.js");
	assert.match(upd, /TelecallerProfile\.findByPk\(userId/);
	assert.match(upd, /tp\.status === "active" && tp\.approved_at/);
	assert.match(upd, /telecaller_access = null/);
	assert.doesNotMatch(upd, /role:\s*["']telecaller["']/);
	assert.doesNotMatch(upd, /\.role\s*=(?!=)/, "no role is ever assigned there");
});

test("users.role is untouched: no telecaller role anywhere in the schema, models or role checks", () => {
	assert.doesNotMatch(read("database/models/user.js"), /telecaller/i);
	// the users.role enum is exactly the three existing roles, in the model ...
	assert.ok(read("database/models/user.js").includes('values: ["student", "admin", "instructor"]'));
	// ... and no migration ever alters the users table's columns (the follow-up migration's own actor_role enum is a different table)
	for (const f of readdirSync(new URL("../../database/migrations/", import.meta.url))) {
		const src = read(`database/migrations/${f}`);
		assert.doesNotMatch(src, /(changeColumn|addColumn|removeColumn)\(\s*["']users["']/i, f);
	}
	// (code only: the comments say what is NOT done) the follow-up code never writes users, and never compares a role to "telecaller"
	for (const f of ["lib/followups/service.js", "lib/followups/repo.js", "lib/followups/http.js"]) assert.doesNotMatch(read(f), /User\.(update|create|destroy)|role\s*===?\s*["']telecaller["']/, f);
});

test("no schema change in this phase: the newest migration is still the Phase 2 snapshot column, and the follow-up tables come from the existing one", () => {
	const files = readdirSync(new URL("../../database/migrations/", import.meta.url)).filter((f) => f.endsWith(".js")).sort();
	assert.equal(files.at(-1), "20261029000000-add-form-snapshot-to-telecaller-events.js");
	assert.match(read("database/migrations/20261028000000-create-meeting-followups.js"), /meeting_followups[\s\S]*meeting_call_logs[\s\S]*meeting_followup_events/);
	assert.doesNotMatch(read("database/models/followup.js"), /\.sync\(|createTable|addColumn/);
});

test("the Meeting Requests workflow is not imported, wrapped or modified by the telecaller code; the admin nav group is intact", () => {
	for (const f of ["lib/followups/service.js", "lib/followups/repo.js", "lib/followups/rules.js", "lib/followups/deps.js", "lib/followups/http.js"]) {
		assert.doesNotMatch(read(f), /lib\/meetings\/(service|repo|deps|http|mailer|emails)|\.\.\/meetings\/(service|repo|deps|http|mailer|emails)/, f);
	}
	assert.doesNotMatch(read("database/models/followup.js"), /MeetingRequest\.(init|belongsTo|addHook)/);
	for (const f of ["pages/api/admin/meetings/index.js", "pages/api/admin/meetings/[id].js", "pages/admin/meetings/index.js"]) assert.doesNotMatch(read(f), /followup/i, f);
	const nav = read("components/_App/AdminSideNav.js");
	for (const l of ["Applications", "Approved Telecallers", "Rejected Applications", "Activity & Call History"]) assert.ok(nav.includes(l), l);
	assert.ok(nav.includes("/admin/telecallers/activity/"));
});

test("the admin Activity page is real (no placeholder) and the telecaller page exists", () => {
	const page = read("pages/admin/telecallers/activity.js");
	assert.match(page, /ActivityBoard/);
	assert.doesNotMatch(page, /not open yet|No telecaller activity yet/);
	assert.ok(exists("pages/telecaller/index.js"));
	assert.match(read("pages/telecaller/index.js"), /Dashboard/);
});

test("no external scheduler, queue or e-mail is introduced: reminders are computed on read and nothing is sent", () => {
	for (const f of ["lib/followups/service.js", "lib/followups/repo.js", "lib/followups/deps.js"]) {
		assert.doesNotMatch(read(f), /setInterval|node-cron|cron|bull|agenda|sendMail|mailer|nodemailer|twilio|sms/i, f);
	}
});

// ------------------------------------------------------------------ pure date rules

test("localDayBounds: the viewer's calendar day, including half-hour zones and DST days", () => {
	const iso = (d) => d.toISOString();
	let b = localDayBounds(new Date("2026-11-04T10:00:00Z"), "Asia/Kolkata");
	assert.deepEqual([iso(b.start), iso(b.end)], ["2026-11-03T18:30:00.000Z", "2026-11-04T18:30:00.000Z"]);
	b = localDayBounds(new Date("2026-11-04T10:00:00Z"), "UTC");
	assert.deepEqual([iso(b.start), iso(b.end)], ["2026-11-04T00:00:00.000Z", "2026-11-05T00:00:00.000Z"]);
	// 23:30 UTC on the 3rd is already the 4th in Kolkata
	b = localDayBounds(new Date("2026-11-03T23:30:00Z"), "Asia/Kolkata");
	assert.equal(iso(b.start), "2026-11-03T18:30:00.000Z");
	// US fall-back day (2026-11-01) is 25 hours long
	b = localDayBounds(new Date("2026-11-01T12:00:00Z"), "America/New_York");
	assert.equal((b.end - b.start) / 3600000, 25);
	// US spring-forward day (2026-03-08) is 23 hours long
	b = localDayBounds(new Date("2026-03-08T12:00:00Z"), "America/New_York");
	assert.equal((b.end - b.start) / 3600000, 23);
	assert.equal(localDayBounds(new Date("2026-11-04T10:00:00Z"), "Not/AZone").zone, "UTC");
});

test("matchesFilter boundaries: now, the end of the day, the 7-day window, closed statuses and missing rows", () => {
	const ctx = makeContext(new Date("2026-11-04T10:00:00Z"), "UTC", "u1");
	const row = (next, extra = {}) => ({ followup: { follow_up_status: "contacted", owner_user_id: "u1", next_follow_up_at: next, ...extra } });
	const at = (iso) => row(new Date(iso));
	assert.equal(matchesFilter(at("2026-11-04T09:59:59Z"), "overdue", ctx), true);
	assert.equal(matchesFilter(at("2026-11-04T10:00:00Z"), "overdue", ctx), false, "exactly now is not yet overdue");
	assert.equal(matchesFilter(at("2026-11-04T10:00:00Z"), "due_today", ctx), true);
	assert.equal(matchesFilter(at("2026-11-04T23:59:59Z"), "due_today", ctx), true);
	assert.equal(matchesFilter(at("2026-11-05T00:00:00Z"), "due_today", ctx), false);
	assert.equal(matchesFilter(at("2026-11-05T00:00:00Z"), "upcoming", ctx), true);
	assert.equal(matchesFilter(at("2026-11-11T23:59:59Z"), "upcoming", ctx), true);
	assert.equal(matchesFilter(at("2026-11-12T00:00:00Z"), "upcoming", ctx), false);
	assert.equal(matchesFilter(row(null), "overdue", ctx), false, "no date is never overdue");
	assert.equal(matchesFilter(row(new Date("2026-11-01"), { follow_up_status: "completed" }), "overdue", ctx), false);
	assert.equal(matchesFilter(row(new Date("2026-11-01"), { follow_up_status: "not_interested" }), "overdue", ctx), false);
	assert.equal(matchesFilter({ followup: null }, "unclaimed", ctx), true, "no follow-up row = unclaimed");
	assert.equal(matchesFilter({ followup: null }, "mine", ctx), false);
	assert.equal(matchesFilter({ followup: null }, "completed", ctx), false);
	assert.equal(matchesFilter(row(null, { follow_up_status: "completed" }), "unclaimed", { ...ctx }), false);
});

test("input rules: versions, next follow-up window, status change notes", () => {
	assert.equal(parseVersion(0), 0);
	assert.equal(parseVersion("3"), 3);
	for (const v of [-1, 1.5, "x", null, undefined, NaN, "1.2"]) assert.equal(parseVersion(v), null, String(v));
	const now = new Date("2026-11-04T10:00:00Z");
	assert.equal(nextFollowUp("", now).value, null);
	assert.ok(nextFollowUp("2026-11-04T10:00:00Z", now).error, "not in the future");
	assert.ok(nextFollowUp("2026-11-04T10:00:01Z", now).value);
	assert.ok(nextFollowUp("2028-01-01T00:00:00Z", now).error, "more than a year ahead");
	assert.ok(nextFollowUp("tomorrow", now).error);
	assert.ok(nextFollowUp("2026-11-05", now).error, "a bare date has no time zone, so it is refused rather than guessed");
	assert.equal(validateCall({ answered: true, outcome: "other", notes: "abc" }, now).errors.notes, undefined);
	assert.ok(validateCall({ answered: true, outcome: "other", notes: "ab" }, now).errors.notes);
	assert.ok(validateStatusChange({ status: "completed", note: "" }, now).errors.note);
	assert.equal(validateStatusChange({ status: "contacted" }, now).errors.note, undefined);
	assert.equal(LIMITS.reasonMin, 5);
});
