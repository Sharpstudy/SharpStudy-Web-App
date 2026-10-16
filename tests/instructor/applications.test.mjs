import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
	ApplicationError, cleanForm, cleanUrl, validateForSubmit, getMine, saveDraft, submitApplication, reapply,
	listApplications, getApplication, reviewAction, applicantView, TRANSITIONS,
} from "../../lib/instructor-applications/service.js";
import { applicationEmail } from "../../lib/instructor-applications/emails.js";
import { createApplicationRepo } from "./memoryRepo.mjs";

const NOW = new Date("2026-10-15T12:00:00Z");
const CATS = [{ id: "11111111-1111-4111-8111-111111111111", name: "Mathematics" }, { id: "22222222-2222-4222-8222-222222222222", name: "Physics" }];
const U = (id, role = "student", extra = {}) => ({ id, email: `${id}@example.com`, first_name: id, last_name: "Tester", role, ...extra });
const admin = { userId: "admin-1", role: "admin" };
const actorOf = (id, role = "student") => ({ userId: id, role });

function setup(over = {}) {
	const repo = createApplicationRepo({ users: [U("ann"), U("bob"), U("cat"), U("unverified", "student", { email_confirmed: false }), U("admin-1", "admin"), U("admin-2", "admin"), U("ivy", "instructor")], categories: CATS });
	const sent = [];
	const audits = [];
	const state = { clock: NOW, mail: async (m) => (sent.push(m), { ok: true }) };
	const deps = { repo, baseUrl: "https://app.test", adminEmail: "admin@sharpstudy.test", now: () => state.clock, mailer: (m) => state.mail(m), audit: async (a, u, d) => audits.push({ a, u, d }), reapplyDays: 30, ...over };
	return { repo, sent, audits, state, deps };
}

const good = (extra = {}) => ({
	full_name: "Ann Tester", phone: "+1 416 555 0100", country: "Canada", education_level: "bachelor", degree: "BSc Mathematics", institution: "Uni of Example", graduation_year: 2020,
	has_teaching_experience: true, teaching_years: 3, teaching_modes: ["online"], prior_experience: "Taught algebra to high-school students online for three years.",
	student_levels: ["high_school"], subjects: [CATS[0].id], topics: "Algebra, geometry, calculus basics", languages: "English",
	sample_kind: "video", sample_url: "https://videos.example.com/watch/abc", sample_title: "Solving linear equations",
	sample_outline: "Intro, worked example, practice problems and a recap with a short quiz at the end.",
	methodology: "I teach with worked examples first, then guided practice, then independent practice with feedback.",
	motivation: "I want to make mathematics approachable for more students.", agreed_policies: true, consented_privacy: true, ...extra,
});
const rejects = (p, status, code) => assert.rejects(p, (e) => e instanceof ApplicationError && e.status === status && (!code || e.code === code), `expected ${status} ${code || ""}`);
const submitted = async (ctx, id = "ann", extra) => {
	await saveDraft(ctx.deps, actorOf(id), good(extra));
	return (await submitApplication(ctx.deps, actorOf(id), {})).application;
};

// ------------------------------------------------------- registration / role source

test("signup never reads a role from the request and the model defaults to student", () => {
	const src = readFileSync(new URL("../../pages/api/users/signup.js", import.meta.url), "utf8");
	assert.match(src, /let \{ first_name, last_name, email, password \} = req\.body;/);
	const create = src.slice(src.indexOf("User.create("), src.indexOf("});", src.indexOf("User.create(")));
	assert.doesNotMatch(create, /role|instructor/);
	assert.match(readFileSync(new URL("../../database/models/user.js", import.meta.url), "utf8"), /defaultValue: "student"/);
});

test("form cleaning drops anything that is not a form field (role, status, user ids)", () => {
	const { values } = cleanForm({ role: "instructor", status: "approved", user_id: "x", admin_notes: "hi", full_name: "  Ann \n Tester ", version: 99 });
	assert.deepEqual(Object.keys(values), ["full_name"]);
	assert.equal(values.full_name, "Ann Tester");
});

test("links: https only, no credentials, no internal hosts", () => {
	assert.equal(cleanUrl("https://youtu.be/abc"), "https://youtu.be/abc");
	for (const bad of ["http://example.com/x", "javascript:alert(1)", "https://user:pw@example.com/", "https://localhost/x", "https://127.0.0.1/x", "https://192.168.1.2/x", "ftp://example.com", "not a url", "https://" + "a".repeat(600) + ".com"]) assert.equal(cleanUrl(bad), null, bad);
});

// ------------------------------------------------------- application

test("required fields are validated on the server; a fresher with no teaching history can still apply", async () => {
	const ctx = setup();
	await saveDraft(ctx.deps, actorOf("ann"), { full_name: "Ann" });
	const err = await submitApplication(ctx.deps, actorOf("ann"), {}).catch((e) => e);
	assert.ok(err instanceof ApplicationError && err.status === 422);
	for (const k of ["phone", "education_level", "subjects", "sample_kind", "motivation", "agreed_policies", "consented_privacy"]) assert.ok(err.fields[k], k);
	// fresher: no teaching experience, no years/modes required
	const fresher = good({ has_teaching_experience: false, teaching_years: 0, teaching_modes: [], prior_experience: "" });
	assert.deepEqual(validateForSubmit(fresher), {});
	const a = await submitApplication(ctx.deps, actorOf("ann"), fresher);
	assert.equal(a.application.status, "pending");
	// experienced applicants must say what they taught
	assert.ok(validateForSubmit(good({ prior_experience: "" })).prior_experience);
});

test("a written lesson demonstration is an accepted alternative to a video, but must be detailed", () => {
	assert.deepEqual(validateForSubmit(good({ sample_kind: "lesson_plan", sample_url: "", sample_outline: "x".repeat(200) })), {});
	assert.ok(validateForSubmit(good({ sample_kind: "lesson_plan", sample_url: "", sample_outline: "too short for a demo lesson plan but over fifty characters long, yes" })).sample_outline);
	assert.ok(validateForSubmit(good({ sample_kind: "video", sample_url: "" })).sample_url);
});

test("subjects must be real categories; format errors are reported", async () => {
	const ctx = setup();
	await rejects(saveDraft(ctx.deps, actorOf("ann"), { subjects: ["99999999-9999-4999-8999-999999999999"] }), 422, "invalid");
	await rejects(saveDraft(ctx.deps, actorOf("ann"), { sample_url: "http://insecure.example.com/x" }), 422, "invalid");
	await rejects(saveDraft(ctx.deps, actorOf("ann"), { phone: "abc" }), 422, "invalid");
	const r = await saveDraft(ctx.deps, actorOf("ann"), { subjects: [CATS[1].id] });
	assert.deepEqual(r.application.subjects, [CATS[1]]);
});

test("draft saves, edits, then submits as pending; the account stays a student", async () => {
	const ctx = setup();
	const d = await saveDraft(ctx.deps, actorOf("ann"), { full_name: "Ann T" });
	assert.equal(d.application.status, "draft");
	await saveDraft(ctx.deps, actorOf("ann"), good());
	const s = await submitApplication(ctx.deps, actorOf("ann"), {});
	assert.equal(s.application.status, "pending");
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
	assert.equal(s.application.can_edit, false);
	// applicant + admin were e-mailed
	assert.ok(ctx.sent.some((m) => m.to === "ann@example.com" && /received/i.test(m.subject)));
	assert.ok(ctx.sent.some((m) => m.to === "admin@sharpstudy.test"));
});

test("submitted applications cannot silently change (edit and re-submit are refused)", async () => {
	const ctx = setup();
	await submitted(ctx);
	await rejects(saveDraft(ctx.deps, actorOf("ann"), { full_name: "Changed" }), 409, "locked");
	await rejects(submitApplication(ctx.deps, actorOf("ann"), {}), 409, "invalid_transition");
});

test("unverified email, existing instructors and admins cannot apply", async () => {
	const ctx = setup();
	await saveDraft(ctx.deps, actorOf("unverified"), good());
	await rejects(submitApplication(ctx.deps, actorOf("unverified"), {}), 403, "email_unverified");
	await rejects(saveDraft(ctx.deps, actorOf("ivy", "instructor"), good()), 409, "already_instructor");
	await rejects(saveDraft(ctx.deps, actorOf("admin-1", "admin"), good()), 403, "not_eligible");
	await rejects(saveDraft(ctx.deps, null, good()), 401);
});

test("the role in the request actor is not trusted: eligibility comes from the stored user", async () => {
	const ctx = setup();
	// token claims say "student" but the database says instructor
	await rejects(saveDraft(ctx.deps, actorOf("ivy", "student"), good()), 409, "already_instructor");
});

test("applicants only ever see their own application", async () => {
	const ctx = setup();
	await submitted(ctx, "ann");
	await submitted(ctx, "bob", { full_name: "Bob Tester" });
	const a = await getMine(ctx.deps, actorOf("ann"));
	const b = await getMine(ctx.deps, actorOf("bob"));
	assert.equal(a.application.full_name, "Ann Tester");
	assert.equal(b.application.full_name, "Bob Tester");
	assert.notEqual(a.application.id, b.application.id);
	assert.equal((await getMine(ctx.deps, actorOf("cat"))).application, null);
	// there is no applicant API that takes an application id at all
	assert.equal(getMine.length, 2);
});

test("applicant view never contains admin notes, rubric or reviewer data", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	await reviewAction(ctx.deps, admin, app.id, { action: "save_review", admin_notes: "SECRET-NOTE seems weak", rubric: { subject_knowledge: 2 } });
	await reviewAction(ctx.deps, admin, app.id, { action: "request_info", feedback: "Please add a longer sample.", admin_notes: "SECRET-NOTE-2" });
	const mine = await getMine(ctx.deps, actorOf("ann"));
	const json = JSON.stringify(mine);
	assert.doesNotMatch(json, /SECRET-NOTE/);
	for (const k of ["admin_notes", "rubric", "reviewed_by", "internal_note", "notify"]) assert.ok(!(k in mine.application), k);
	assert.equal(mine.application.feedback, "Please add a longer sample.");
	assert.ok(mine.application.history.every((h) => !("internal_note" in h)));
	assert.doesNotMatch(JSON.stringify(ctx.sent), /SECRET-NOTE/);
});

// ------------------------------------------------------- authorization

test("only admins can list, read or act on applications", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	for (const actor of [actorOf("ann"), actorOf("ivy", "instructor"), actorOf("bob")]) {
		await rejects(listApplications(ctx.deps, actor), 403);
		await rejects(getApplication(ctx.deps, actor, app.id), 403);
		await rejects(reviewAction(ctx.deps, actor, app.id, { action: "approve", confirm: true }), 403);
	}
	await rejects(reviewAction(ctx.deps, null, app.id, { action: "approve", confirm: true }), 401);
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
});

test("a student cannot approve their own application even if the actor claims admin", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	await rejects(reviewAction(ctx.deps, actorOf("ann", "student"), app.id, { action: "approve", confirm: true }), 403);
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
});

test("an admin cannot approve their own application", async () => {
	const ctx = setup();
	// becomes an applicant while a student, is promoted to admin afterwards
	const app = await submitted(ctx, "ann");
	ctx.repo._db.users.find((u) => u.id === "ann").role = "admin";
	await rejects(reviewAction(ctx.deps, actorOf("ann", "admin"), app.id, { action: "approve", confirm: true }), 403, "self_approval");
});

test("pending and under-review applicants remain students; approval needs confirmation", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
	await reviewAction(ctx.deps, admin, app.id, { action: "start_review" });
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "approve" }), 422, "confirmation_required");
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: "yes" }), 422, "confirmation_required");
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
});

test("approval grants only the instructor role, writes history + audit, e-mails the applicant, and fills the teaching profile", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	const out = await reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true, feedback: "Great sample lesson.", admin_notes: "Strong." });
	assert.equal(out.application.status, "approved");
	const u = await ctx.repo.getUser("ann");
	assert.equal(u.role, "instructor");
	assert.deepEqual(Object.keys(u).sort(), Object.keys(await ctx.repo.getUser("bob")).sort()); // no extra privilege fields
	assert.ok(!("family" in u) && !("is_admin" in u));
	assert.ok(ctx.repo._db.events.some((e) => e.to_status === "approved" && e.actor_user_id === "admin-1"));
	assert.ok(ctx.audits.some((x) => x.a === "instructor_application.approve" && x.u === "admin-1" && x.d.roleTo === "instructor"));
	assert.ok(ctx.sent.some((m) => m.to === "ann@example.com" && /approved/i.test(m.subject)));
	const p = ctx.repo._db.profiles.find((x) => x.user_id === "ann");
	assert.match(p.subjects, /Mathematics/);
	// other accounts are untouched
	assert.equal((await ctx.repo.getUser("bob")).role, "student");
	assert.equal((await ctx.repo.getUser("admin-1")).role, "admin");
});

test("approval requires a verified, enabled student account", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	ctx.repo._db.users.find((u) => u.id === "ann").email_confirmed = false;
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true }), 409, "email_unverified");
	ctx.repo._db.users.find((u) => u.id === "ann").email_confirmed = true;
	ctx.repo._db.users.find((u) => u.id === "ann").status = false;
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true }), 409, "account_disabled");
});

test("approving a former applicant who has since become an admin never demotes or changes them", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	ctx.repo._db.users.find((u) => u.id === "ann").role = "admin";
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true }), 409, "not_eligible");
	assert.equal((await ctx.repo.getUser("ann")).role, "admin");
});

test("rejected applicants stay students, get feedback and must wait before reapplying", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "reject", confirm: true }), 422); // feedback required
	await reviewAction(ctx.deps, admin, app.id, { action: "reject", confirm: true, feedback: "Please gain more classroom experience.", admin_notes: "private" });
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
	const mine = await getMine(ctx.deps, actorOf("ann"));
	assert.equal(mine.application.status, "rejected");
	assert.match(mine.application.feedback, /classroom experience/);
	assert.equal(mine.application.can_reapply, false);
	await rejects(reapply(ctx.deps, actorOf("ann")), 403, "cooldown");
	await rejects(submitApplication(ctx.deps, actorOf("ann"), good()), 409, "invalid_transition");
	ctx.state.clock = new Date("2026-12-01T00:00:00Z");
	const again = await reapply(ctx.deps, actorOf("ann"));
	assert.equal(again.application.status, "draft");
	assert.equal(again.application.attempt, 2);
	assert.equal(again.application.agreed_policies, false); // must consent again
	assert.equal((await ctx.repo.getUser("ann")).role, "student"); // reapplying grants nothing
});

test("more information: admin asks, applicant edits and resubmits, application returns to pending", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "request_info", feedback: "short" }), 422);
	await reviewAction(ctx.deps, admin, app.id, { action: "request_info", feedback: "Please link a longer sample lesson." });
	assert.equal((await getMine(ctx.deps, actorOf("ann"))).application.can_edit, true);
	await saveDraft(ctx.deps, actorOf("ann"), { sample_title: "Longer lesson" });
	const re = await submitApplication(ctx.deps, actorOf("ann"), { sample_url: "https://videos.example.com/watch/longer" });
	assert.equal(re.application.status, "pending");
	assert.equal(re.application.sample_title, "Longer lesson");
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
});

test("invalid transitions are refused", async () => {
	const ctx = setup();
	const d = await saveDraft(ctx.deps, actorOf("ann"), good());
	await rejects(reviewAction(ctx.deps, admin, d.application.id, { action: "approve", confirm: true }), 404); // drafts are invisible to admins
	const app = await submitted(ctx, "bob");
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "revoke", confirm: true, feedback: "not approved yet" }), 409, "invalid_transition");
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "make_admin", confirm: true }), 422, "invalid_action");
	await reviewAction(ctx.deps, admin, app.id, { action: "reject", confirm: true, feedback: "Not a fit right now." });
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true }), 409, "invalid_transition");
	for (const [name, t] of Object.entries(TRANSITIONS)) assert.ok(t.from.length && t.to, name);
});

test("two simultaneous approvals: exactly one wins", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	const results = await Promise.allSettled([admin, { userId: "admin-2", role: "admin" }].map((a) => reviewAction(ctx.deps, a, app.id, { action: "approve", confirm: true })));
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
	assert.equal(ctx.repo._db.events.filter((e) => e.to_status === "approved").length, 1);
});

test("a database failure during approval leaves the application pending and the user a student", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	ctx.repo._failNextTransition = true;
	await assert.rejects(reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true }), /simulated/);
	assert.equal((await ctx.repo.findById(app.id)).status, "pending");
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
});

test("revocation removes instructor access and is recorded; only approved applications can be revoked", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	await reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true });
	assert.equal((await ctx.repo.getUser("ann")).role, "instructor");
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "revoke", feedback: "Policy breach confirmed." }), 422, "confirmation_required");
	await reviewAction(ctx.deps, admin, app.id, { action: "revoke", confirm: true, feedback: "Policy breach confirmed." });
	assert.equal((await ctx.repo.getUser("ann")).role, "student");
	assert.equal((await ctx.repo.findById(app.id)).status, "revoked");
	assert.ok(ctx.audits.some((x) => x.a === "instructor_application.revoke"));
	assert.ok(ctx.sent.some((m) => /removed/i.test(m.subject)));
	await rejects(reviewAction(ctx.deps, admin, app.id, { action: "revoke", confirm: true, feedback: "Again please." }), 409, "invalid_transition");
});

test("legitimate existing instructors and admins are not affected by any of this", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	await reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true });
	await reviewAction(ctx.deps, admin, app.id, { action: "revoke", confirm: true, feedback: "Policy breach confirmed." });
	assert.equal((await ctx.repo.getUser("ivy")).role, "instructor"); // never had an application; untouched
	assert.equal((await ctx.repo.getUser("admin-1")).role, "admin");
	assert.equal((await ctx.repo.getUser("admin-2")).role, "admin");
});

// ------------------------------------------------------- admin dashboard

test("admin list: counts, search, status filter, pagination; drafts are never listed", async () => {
	const ctx = setup();
	await saveDraft(ctx.deps, actorOf("cat"), good()); // stays draft
	const a = await submitted(ctx, "ann");
	await submitted(ctx, "bob", { full_name: "Bob Builder" });
	await reviewAction(ctx.deps, admin, a.id, { action: "start_review" });
	const all = await listApplications(ctx.deps, admin, {});
	assert.equal(all.count, 2);
	assert.deepEqual(all.counts, { pending: 1, under_review: 1, more_info_requested: 0, approved: 0, rejected: 0, revoked: 0 });
	assert.equal((await listApplications(ctx.deps, admin, { status: "under_review" })).applications[0].email, "ann@example.com");
	assert.equal((await listApplications(ctx.deps, admin, { q: "builder" })).count, 1);
	assert.equal((await listApplications(ctx.deps, admin, { q: "bob@example" })).count, 1);
	assert.equal((await listApplications(ctx.deps, admin, { status: "draft" })).count, 2); // "draft" ignored = default list
	const detail = await getApplication(ctx.deps, admin, a.id);
	assert.equal(detail.applicant.email, "ann@example.com");
	assert.deepEqual(detail.allowed.sort(), ["approve", "reject", "request_info"]);
	assert.ok(detail.history.length >= 2);
});

test("review notes and the rubric are saved privately and sanitised", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	const r = await reviewAction(ctx.deps, admin, app.id, { action: "save_review", admin_notes: "Good clarity", rubric: { subject_knowledge: 5, teaching_clarity: 9, bogus: 3, communication: "4" } });
	assert.equal(r.application.admin_notes, "Good clarity");
	assert.deepEqual(r.application.rubric, { subject_knowledge: 5, communication: 4 });
});

// ------------------------------------------------------- notifications

test("an e-mail failure never undoes the decision; it is recorded and can be retried", async () => {
	const ctx = setup();
	const app = await submitted(ctx);
	ctx.state.mail = async () => ({ ok: false, error: "smtp down" });
	const out = await reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true });
	assert.equal(out.application.status, "approved");
	assert.equal((await ctx.repo.getUser("ann")).role, "instructor");
	assert.equal(out.application.notify.status, "failed");
	ctx.state.mail = async () => {
		throw new Error("boom");
	};
	assert.equal((await reviewAction(ctx.deps, admin, app.id, { action: "retry_email" })).application.notify.status, "failed");
	ctx.state.mail = async (m) => (ctx.sent.push(m), { ok: true });
	assert.equal((await reviewAction(ctx.deps, admin, app.id, { action: "retry_email" })).application.notify.status, "sent");
});

test("missing e-mail configuration is reported as skipped, not as success", async () => {
	const ctx = setup();
	ctx.state.mail = async () => ({ ok: false, skipped: true, error: "e-mail credentials are not configured" });
	const app = await submitted(ctx);
	assert.equal((await getApplication(ctx.deps, admin, app.id)).notify.status, "skipped");
});

test("a failing audit hook cannot block a decision", async () => {
	const ctx = setup({ audit: async () => { throw new Error("audit down"); } });
	const app = await submitted(ctx);
	assert.equal((await reviewAction(ctx.deps, admin, app.id, { action: "approve", confirm: true })).application.status, "approved");
});

test("e-mails escape applicant-controlled text and never include admin notes", () => {
	const m = applicationEmail("more_info", { app: { applicant_feedback: "<script>x</script>" }, user: { first_name: "<b>Ann</b>", email: "a@b.co" }, baseUrl: "https://x.test" });
	assert.doesNotMatch(m.html, /<script>|<b>Ann/);
	assert.equal(applicationEmail("nope", { app: {}, user: {}, baseUrl: "" }), null);
});

// ------------------------------------------------------- wiring (static checks of the real routes)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("legacy approval endpoints can no longer grant the instructor role", () => {
	for (const p of ["pages/api/instructor/requests.js", "pages/api/instructor/new.js"]) {
		assert.doesNotMatch(read(p), /User\.update|role: "instructor"|instId/, p);
	}
	assert.match(read("lib/mastery/admin.js"), /instructor_application_required|Instructor Applications/);
});

test("every instructor-application admin route is admin-only and every applicant route requires a verified account", () => {
	assert.match(read("pages/api/instructor/requests.js"), /requireRole\(req, res, \["admin"\]\)/);
	assert.match(read("pages/api/instructor/new.js"), /requireAccount\(req, res\)/);
	// the existing Requests tab is reused: no parallel admin page or API for applications
	for (const p of ["pages/api/admin/instructor-applications", "pages/api/instructor-application", "pages/admin/instructor/applications.js"]) assert.equal(existsSync(new URL(`../../${p}`, import.meta.url)), false, p);
});

test("instructor-only APIs and pages are gated by the database role, not the client", () => {
	for (const p of ["pages/api/instructor/dashboard.js", "pages/api/instructor/profile.js", "pages/api/instructor/students.js"]) assert.match(read(p), /requireRole\(req, res, \["instructor"/, p);
	const app = read("pages/_app.js");
	assert.match(app, /guardRoute|pageAccess/);
});

test("applicant view type is stable", () => {
	assert.equal(applicantView(null, []), null);
});

test("page gate: admin and instructor screens are closed to everyone without the role", async () => {
	const { pageAccess } = await import("../../lib/auth/pageAccess.js");
	assert.equal(pageAccess("/admin/instructor/requests", { role: "student" }), "/");
	assert.equal(pageAccess("/admin", { role: "instructor" }), "/");
	assert.equal(pageAccess("/admin", { role: "admin" }), null);
	assert.equal(pageAccess("/instructor/course/create", { role: "student" }), "/become-an-instructor");
	assert.equal(pageAccess("/instructor/dashboard", { role: "instructor" }), null);
	assert.equal(pageAccess("/instructor/dashboard", null), "/");
	assert.equal(pageAccess("/become-an-instructor", { role: "student" }), null);
	assert.equal(pageAccess("/courses", { role: "student" }), null);
});
