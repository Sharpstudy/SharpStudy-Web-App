// Telecaller applications (Phase 2). In-memory repository only: no database is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { memoryRepo } from "./memoryRepo.mjs";
import {
	getMine, saveDraft, uploadResume, submitApplication, reapply, listApplications, getApplication, reviewAction, getResumeForAdmin,
	listMembers, getMember, setMemberStatus, getSummary, cleanForm, REAPPLY_DAYS, TelecallerError,
} from "../../lib/telecallers/service.js";

const DAY = 86400000;

// ---------------------------------------------------------------- fixtures
const pdf = (extra = "") => Buffer.from(`%PDF-1.4\n% test resume ${extra}\n1 0 obj<<>>endobj\n%%EOF`);
const docx = (extra = "") => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`[Content_Types].xml word/document.xml ${extra}`)]);
const doc = (extra = "") => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("WordDocument", "utf16le"), Buffer.from(extra)]);
const xls = () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("Workbook", "utf16le")]);
const file = (name, buf) => ({ filename: name, data: buf.toString("base64") });

const form = (over = {}) => ({
	full_name: "Asha Verma", phone: "+91 98765 43210", city: "Pune", state: "Maharashtra", qualification: "bachelor",
	has_telecalling_experience: true, experience_years: 3, previous_company: "Acme Calls", languages: "English, Hindi",
	employment_preference: "full_time", additional_info: "Available immediately.", confirmed_adult: true, consented_privacy: true, ...over,
});

function env() {
	const repo = memoryRepo();
	const mails = [];
	const audits = [];
	const clock = { t: Date.UTC(2026, 10, 2, 9, 0, 0) };
	const deps = {
		repo,
		mailer: async (m) => (mails.push(m), { ok: false, skipped: true, error: "email not configured" }), // SES is not configured locally
		baseUrl: "http://localhost:3000",
		adminEmail: "admin@example.com",
		reapplyDays: REAPPLY_DAYS,
		audit: async (action, actorUserId, details) => audits.push({ action, actorUserId, details }),
		now: () => new Date(clock.t),
	};
	const admin = repo.addUser({ role: "admin", first_name: "Ada", last_name: "Admin" });
	const applicant = repo.addUser({ first_name: "Asha", last_name: "Verma", phone: "" });
	const actorOf = (u) => ({ kind: "account", userId: u.id, role: u.role, email: u.email });
	return { repo, deps, mails, audits, clock, admin, applicant, A: actorOf(admin), P: actorOf(applicant), actorOf };
}

const code = async (p) => {
	try {
		await p;
	} catch (e) {
		return e instanceof TelecallerError ? `${e.status}:${e.code}` : `other:${e && e.message}`;
	}
	return "ok";
};

// Fill a complete application (form + resume) and submit it.
async function submitComplete(t, who = t.applicant, over = {}) {
	const actor = t.actorOf(who);
	await uploadResume(t.deps, actor, file("cv.pdf", pdf(who.id)));
	return submitApplication(t.deps, actor, form({ full_name: `${who.first_name} ${who.last_name}`, ...over }));
}

// ---------------------------------------------------------------- eligibility

test("who may apply: signed-in, active, non-admin, not a learner login; e-mail must be confirmed to submit", async () => {
	const t = env();
	assert.equal(await code(getMine(t.deps, null)), "401:unauthenticated");
	assert.equal(await code(saveDraft(t.deps, t.A, form())), "403:not_eligible", "an administrator cannot apply");
	assert.equal((await getMine(t.deps, t.A)).eligible, false);

	const child = t.repo.addUser({});
	t.repo.markLearner(child.id);
	assert.equal(await code(saveDraft(t.deps, t.actorOf(child), form())), "403:not_eligible", "a child's learner login cannot apply");
	assert.equal(await code(uploadResume(t.deps, t.actorOf(child), file("cv.pdf", pdf()))), "403:not_eligible");
	const mineChild = await getMine(t.deps, t.actorOf(child));
	assert.equal(mineChild.eligible, false);
	assert.match(mineChild.ineligible_reason, /learner/i);

	const disabled = t.repo.addUser({ status: false });
	assert.equal(await code(getMine(t.deps, t.actorOf(disabled))), "401:unauthenticated");

	// a parent-only account is just a student account to this service: it may apply
	const parent = t.repo.addUser({});
	assert.equal((await getMine(t.deps, t.actorOf(parent))).eligible, true);
	assert.equal(await code(saveDraft(t.deps, t.actorOf(parent), form())), "ok");

	// an instructor may apply too (non-admin)
	const inst = t.repo.addUser({ role: "instructor" });
	assert.equal(await code(saveDraft(t.deps, t.actorOf(inst), form())), "ok");

	// unconfirmed e-mail: may save a draft and upload, may not submit
	const unconfirmed = t.repo.addUser({ email_confirmed: false });
	const U = t.actorOf(unconfirmed);
	await saveDraft(t.deps, U, form());
	await uploadResume(t.deps, U, file("cv.pdf", pdf("u")));
	assert.equal(await code(submitApplication(t.deps, U, form())), "403:email_unverified");
});

// ---------------------------------------------------------------- the form: cleaning, validation, nothing self-assigned

test("only known form fields are stored; status, role, user id, version and decision fields from the browser are dropped", async () => {
	const t = env();
	const { values } = cleanForm({ ...form(), status: "approved", role: "admin", user_id: "x", version: 99, admin_notes: "hi", decided_by: "y", attempt: 7, feedback: "ok", id: "z" });
	assert.deepEqual(Object.keys(values).sort(), ["additional_info", "city", "confirmed_adult", "consented_privacy", "employment_preference", "experience_years", "full_name", "has_telecalling_experience", "languages", "phone", "previous_company", "qualification", "state"].sort());

	const saved = await saveDraft(t.deps, t.P, { ...form(), status: "approved", role: "admin", attempt: 9, user_id: "someone-else", version: 50 });
	assert.equal(saved.application.status, "draft");
	assert.equal(saved.application.attempt, 1);
	assert.equal(t.repo.users.get(t.applicant.id).role, "student");
	const row = [...t.repo.apps.values()][0];
	assert.equal(row.user_id, t.applicant.id);
	assert.equal(row.version, 0);
});

test("format errors are refused with the offending fields", async () => {
	const t = env();
	const r = async (over) => { try { await saveDraft(t.deps, t.P, over); return null; } catch (e) { return e.fields; } };
	assert.ok((await r({ phone: "abc" })).phone);
	assert.ok((await r({ phone: "12" })).phone);
	assert.ok((await r({ phone: "+1 (555) 123-4567 ext 9" })).phone);
	assert.ok((await r({ experience_years: 61 })).experience_years);
	assert.ok((await r({ experience_years: "2.5" })).experience_years);
	assert.equal(await r(form()), null);
	// no experience means no years, whatever was sent
	const noExp = await saveDraft(t.deps, t.P, { has_telecalling_experience: false, experience_years: 8 });
	assert.equal(noExp.application.experience_years, null);
});

test("submission requires every required field, the 18+ confirmation, privacy consent and a resume", async () => {
	const t = env();
	await saveDraft(t.deps, t.P, { full_name: "A" });
	let e = (await submitApplication(t.deps, t.P, {}).catch((x) => x));
	assert.equal(e.status, 422);
	for (const k of ["full_name", "phone", "city", "state", "qualification", "has_telecalling_experience", "languages", "employment_preference", "confirmed_adult", "consented_privacy", "resume"]) assert.ok(e.fields[k], k);
	e = await submitApplication(t.deps, t.P, form({ confirmed_adult: false })).catch((x) => x);
	assert.ok(e.fields.confirmed_adult && e.fields.resume);
	await uploadResume(t.deps, t.P, file("cv.pdf", pdf()));
	e = await submitApplication(t.deps, t.P, form({ has_telecalling_experience: true, experience_years: null })).catch((x) => x);
	assert.ok(e.fields.experience_years);
	e = await submitApplication(t.deps, t.P, form({ consented_privacy: false })).catch((x) => x);
	assert.ok(e.fields.consented_privacy);
	e = await submitApplication(t.deps, t.P, form({ qualification: "wizard", employment_preference: "whenever" })).catch((x) => x);
	assert.ok(e.fields.qualification && e.fields.employment_preference);
	// previous company is optional
	assert.equal(await code(submitApplication(t.deps, t.P, form({ previous_company: "" }))), "ok");
});

// ---------------------------------------------------------------- resumes

test("resume validation: real file signature, 2 MB, allowed types, extension must agree; claimed MIME is ignored", async () => {
	const t = env();
	assert.equal(await code(uploadResume(t.deps, t.P, file("cv.pdf", pdf("1")))), "ok");
	assert.equal(await code(uploadResume(t.deps, t.P, file("cv.docx", docx("1")))), "ok");
	assert.equal(await code(uploadResume(t.deps, t.P, file("cv.doc", doc("1")))), "ok");
	assert.equal(await code(uploadResume(t.deps, t.P, file("CV FINAL.PDF", pdf("2")))), "ok", "extension case does not matter");

	assert.equal(await code(uploadResume(t.deps, t.P, file("cv.exe", Buffer.from("MZ....")))), "422:bad_type");
	assert.equal(await code(uploadResume(t.deps, t.P, file("cv.pdf", Buffer.from("MZ not a pdf at all")))), "422:bad_type", "extension alone is not trusted");
	assert.equal(await code(uploadResume(t.deps, t.P, file("cv.pdf", docx("x")))), "422:type_mismatch");
	assert.equal(await code(uploadResume(t.deps, t.P, file("cv.docx", pdf("x")))), "422:type_mismatch");
	assert.equal(await code(uploadResume(t.deps, t.P, file("sheet.doc", xls()))), "422:bad_type", "an Excel / PowerPoint OLE file is not a Word document");
	assert.equal(await code(uploadResume(t.deps, t.P, file("script.pdf.html", Buffer.from("<script>alert(1)</script>")))), "422:bad_type");
	assert.equal(await code(uploadResume(t.deps, t.P, { filename: "cv.pdf", data: "" })), "422:missing_file");
	assert.equal(await code(uploadResume(t.deps, t.P, { filename: "cv.pdf", data: "!!!not base64!!!" })), "422:bad_file");
	assert.equal(await code(uploadResume(t.deps, t.P, { filename: "cv", data: pdf().toString("base64") })), "422:bad_type", "no extension");

	const big = Buffer.concat([pdf(), Buffer.alloc(2 * 1024 * 1024 + 1, 65)]);
	assert.equal(await code(uploadResume(t.deps, t.P, file("big.pdf", big))), "422:too_large");
	const t2 = env(); // a fresh applicant: one applicant may keep at most 5 versions per attempt
	const exactly = Buffer.concat([pdf("edge"), Buffer.alloc(2 * 1024 * 1024 - pdf("edge").length, 65)]);
	assert.equal(exactly.length, 2 * 1024 * 1024);
	assert.equal(await code(uploadResume(t2.deps, t2.P, file("edge.pdf", exactly))), "ok", "exactly 2 MB is allowed");
	// a data: URL prefix from a browser FileReader is accepted
	assert.equal(await code(uploadResume(t2.deps, t2.P, { filename: "d.pdf", data: `data:application/pdf;base64,${pdf("durl").toString("base64")}` })), "ok");

	// the stored type is the detected one, and the stored name is clean
	await uploadResume(t2.deps, t2.P, { filename: "../../etc/pa<s>s\\wd resume.pdf", data: pdf("name").toString("base64") });
	const names = t2.repo.allResumeRows().map((r) => r.original_filename);
	assert.ok(names.every((n) => !/[\\/<>:*?|"]/.test(n)), names.join(", "));
	assert.ok(t2.repo.allResumeRows().every((r) => ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(r.mime_type)));
});

test("resumes are immutable versions: a repeat upload is a no-op, a new file adds a version, nothing is replaced; at most 5 per attempt", async () => {
	const t = env();
	const a = await uploadResume(t.deps, t.P, file("one.pdf", pdf("one")));
	assert.equal(a.duplicate, false);
	assert.equal(a.application.status, "draft", "uploading creates the draft if there is none");
	const again = await uploadResume(t.deps, t.P, file("one-renamed.pdf", pdf("one")));
	assert.equal(again.duplicate, true);
	assert.equal(t.repo.allResumeRows().length, 1);
	const b = await uploadResume(t.deps, t.P, file("two.pdf", pdf("two")));
	assert.equal(b.application.resumes.length, 2);
	assert.deepEqual(b.application.resumes.map((r) => r.filename), ["one.pdf", "two.pdf"]);
	for (const r of b.application.resumes) {
		assert.equal(r.attempt, 1);
		assert.match(r.sha256, /^[0-9a-f]{64}$/);
		assert.ok(r.size_bytes > 0 && r.uploaded_at && r.mime_type);
	}
	for (let i = 3; i <= 5; i++) await uploadResume(t.deps, t.P, file(`v${i}.pdf`, pdf(`v${i}`)));
	assert.equal(await code(uploadResume(t.deps, t.P, file("v6.pdf", pdf("v6")))), "409:too_many");
	assert.equal(t.repo.allResumeRows().length, 5);
});

test("file bytes never appear in any applicant or admin view", async () => {
	const t = env();
	await submitComplete(t);
	const view = JSON.stringify([await getMine(t.deps, t.P), await listApplications(t.deps, t.A, {}), await getApplication(t.deps, t.A, [...t.repo.apps.keys()][0])]);
	assert.doesNotMatch(view, /"data"/);
	assert.doesNotMatch(view, /%PDF/);
	assert.doesNotMatch(view, /"type":"Buffer"/);
});

test("a resume can only be added while the application is editable", async () => {
	const t = env();
	await submitComplete(t);
	assert.equal(await code(uploadResume(t.deps, t.P, file("late.pdf", pdf("late")))), "409:locked", "pending");
});

// ---------------------------------------------------------------- submit, duplicates, pending

test("submit creates a PENDING application with a history row, notifies admins, and grants no access", async () => {
	const t = env();
	const out = await submitComplete(t);
	assert.equal(out.application.status, "pending");
	assert.equal(out.application.attempt, 1);
	assert.ok(out.application.submitted_at);
	assert.equal(out.application.can_edit, false);
	assert.equal(t.repo.profiles.size, 0, "no telecaller profile");
	assert.equal(t.repo.users.get(t.applicant.id).role, "student", "users.role unchanged");
	assert.equal((await getMine(t.deps, t.P)).access, null);

	const ev = t.repo.events.filter((e) => e.to_status === "pending");
	assert.equal(ev.length, 1);
	assert.equal(ev[0].attempt, 1);
	assert.equal(ev[0].actor, "applicant");
	assert.equal(ev[0].email_status, "skipped", "e-mail is not configured: recorded honestly, not as sent");

	const adminNote = t.repo.log.notifications.filter((n) => n.type === "telecaller_application_submitted");
	assert.equal(adminNote.length, 1);
	assert.equal(adminNote[0].user_id, t.admin.id);
	assert.match(adminNote[0].link, /^\/admin\/telecallers\/applications\/\?open=/);
	assert.ok(t.mails.some((m) => m.to === "admin@example.com"));
	assert.ok(t.audits.some((a) => a.action === "telecaller_application.submit"));
});

test("duplicate applications are prevented: one row per user, and a pending application cannot be submitted again", async () => {
	const t = env();
	await submitComplete(t);
	assert.equal(await code(submitApplication(t.deps, t.P, form())), "409:invalid_transition");
	assert.equal(await code(saveDraft(t.deps, t.P, form())), "409:locked");
	assert.equal(t.repo.apps.size, 1);
	assert.equal(await code(reapply(t.deps, t.P)), "409:invalid_transition");
	// two tabs creating the first draft at once: the loser gets the winner's row
	const t2 = env();
	const results = await Promise.all([saveDraft(t2.deps, t2.P, form()), saveDraft(t2.deps, t2.P, form({ city: "Mumbai" }))]);
	assert.equal(t2.repo.apps.size, 1);
	assert.ok(results.every((r) => r.application.id === [...t2.repo.apps.keys()][0]));
});

// ---------------------------------------------------------------- authorization

test("only admins may list, read, decide, download or manage; an applicant gets 403 and a stranger 401", async () => {
	const t = env();
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	const rid = t.repo.allResumeRows()[0].id;
	const instr = t.repo.addUser({ role: "instructor" });
	const other = t.repo.addUser({});
	for (const who of [t.P, t.actorOf(instr), t.actorOf(other)]) {
		assert.equal(await code(listApplications(t.deps, who, {})), "403:forbidden");
		assert.equal(await code(getApplication(t.deps, who, id)), "403:forbidden");
		for (const action of ["approve", "reject", "request_info", "save_notes"]) assert.equal(await code(reviewAction(t.deps, who, id, { action, confirm: true, feedback: "long enough feedback" })), "403:forbidden", action);
		assert.equal(await code(getResumeForAdmin(t.deps, who, rid)), "403:forbidden");
		assert.equal(await code(listMembers(t.deps, who, {})), "403:forbidden");
		assert.equal(await code(getMember(t.deps, who, t.applicant.id)), "403:forbidden");
		assert.equal(await code(setMemberStatus(t.deps, who, t.applicant.id, { action: "deactivate", reason: "long enough reason" })), "403:forbidden");
		assert.equal(await code(getSummary(t.deps, who)), "403:forbidden");
	}
	for (const fn of [() => listApplications(t.deps, null, {}), () => reviewAction(t.deps, null, id, { action: "approve", confirm: true }), () => getResumeForAdmin(t.deps, null, rid), () => listMembers(t.deps, null, {})]) {
		assert.equal(await code(fn()), "401:unauthenticated");
	}
	assert.equal(t.repo.apps.get(id).status, "pending", "nothing changed");
});

test("applicants only ever load their own application", async () => {
	const t = env();
	await submitComplete(t);
	const other = t.repo.addUser({});
	const mine = await getMine(t.deps, t.actorOf(other));
	assert.equal(mine.application, null);
	const res = await uploadResume(t.deps, t.actorOf(other), file("o.pdf", pdf("o")));
	assert.equal(res.application.resumes.length, 1);
	assert.equal(t.repo.apps.size, 2);
	assert.equal((await getMine(t.deps, t.P)).application.resumes.length, 1);
});

test("the applicant view never contains admin notes or internal notes, and the admin view does", async () => {
	const t = env();
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	await reviewAction(t.deps, t.A, id, { action: "save_notes", admin_notes: "PRIVATE-NOTE-123" });
	const mineJson = JSON.stringify(await getMine(t.deps, t.P));
	assert.doesNotMatch(mineJson, /PRIVATE-NOTE-123/);
	assert.doesNotMatch(mineJson, /internal_note|admin_notes/);
	assert.match(JSON.stringify(await getApplication(t.deps, t.A, id)), /PRIVATE-NOTE-123/);
	// and not in any e-mail or notification
	await reviewAction(t.deps, t.A, id, { action: "request_info", feedback: "Please add your last employer.", admin_notes: "PRIVATE-NOTE-456" });
	assert.ok(!JSON.stringify(t.mails).includes("PRIVATE-NOTE"));
	assert.ok(!JSON.stringify(t.repo.log.notifications).includes("PRIVATE-NOTE"));
});

// ---------------------------------------------------------------- more information requested

test("more information requested: applicant edits, adds a resume version, resubmits; history is preserved and nothing is overwritten", async () => {
	const t = env();
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "request_info", feedback: "short" })), "422:invalid");
	const r = await reviewAction(t.deps, t.A, id, { action: "request_info", feedback: "Please add your previous employer.", admin_notes: "n1" });
	assert.equal(r.application.status, "more_info_requested");
	assert.deepEqual(r.application.allowed, [], "nothing more to decide until the applicant responds");

	const mine = await getMine(t.deps, t.P);
	assert.equal(mine.application.status, "more_info_requested");
	assert.equal(mine.application.can_edit, true);
	assert.equal(mine.application.feedback, "Please add your previous employer.");
	assert.ok(t.repo.log.notifications.some((n) => n.type === "telecaller_application_more_info" && n.user_id === t.applicant.id));
	assert.ok(t.mails.some((m) => m.to === t.applicant.email && /More information/.test(m.subject)));

	await saveDraft(t.deps, t.P, { previous_company: "Globex Telecom" });
	await uploadResume(t.deps, t.P, file("cv-v2.pdf", pdf("v2")));
	const re = await submitApplication(t.deps, t.P, {});
	assert.equal(re.application.status, "pending");
	assert.equal(re.application.attempt, 1, "a response is not a new attempt");
	assert.equal(re.application.resumes.length, 2, "the first resume is still there");

	const adminView = await getApplication(t.deps, t.A, id);
	const a1 = adminView.attempts.find((a) => a.attempt === 1);
	assert.deepEqual(a1.events.map((e) => e.to), ["draft", "pending", "more_info_requested", "pending"]);
	assert.equal(a1.events[2].feedback, "Please add your previous employer.");
	assert.equal(a1.events[2].internal_note, "n1");
	assert.equal(a1.events[2].actor_name, "Ada Admin");
	assert.equal(a1.events[3].feedback, "Applicant responded and resubmitted.");
	assert.deepEqual(a1.resumes.map((x) => x.filename), ["cv.pdf", "cv-v2.pdf"]);
	// the admin is told again
	assert.equal(t.repo.log.notifications.filter((n) => n.type === "telecaller_application_submitted").length, 2);
});

// ---------------------------------------------------------------- approval

test("approval: admin only, needs confirmation, creates an ACTIVE profile and never touches users.role", async () => {
	const t = env();
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "approve" })), "422:confirmation_required");
	assert.equal(t.repo.profiles.size, 0);

	const r = await reviewAction(t.deps, t.A, id, { action: "approve", confirm: true, feedback: "Welcome aboard", admin_notes: "good call" });
	assert.equal(r.application.status, "approved");
	assert.equal(r.application.profile.status, "active");
	assert.equal(r.application.profile.approved_by_name, "Ada Admin");
	assert.equal(t.repo.profiles.size, 1);
	const p = t.repo.profiles.get(t.applicant.id);
	assert.deepEqual([p.status, p.application_id, p.approved_by], ["active", id, t.admin.id]);
	assert.equal(t.repo.users.get(t.applicant.id).role, "student", "users.role is unchanged");
	assert.equal(t.repo.apps.get(id).decided_by, t.admin.id);

	assert.ok(t.repo.log.notifications.some((n) => n.type === "telecaller_application_approved" && n.user_id === t.applicant.id));
	assert.ok(t.mails.some((m) => m.to === t.applicant.email && /approved/i.test(m.subject)));
	assert.ok(t.audits.some((a) => a.action === "telecaller_application.approve" && a.details.attempt === 1));
	assert.equal((await getMine(t.deps, t.P)).access.status, "active");

	// the approved application is final: no edits, no submit, no new resume, no second decision
	assert.equal(await code(saveDraft(t.deps, t.P, form())), "409:locked");
	assert.equal(await code(uploadResume(t.deps, t.P, file("x.pdf", pdf("x")))), "409:locked");
	assert.equal(await code(submitApplication(t.deps, t.P, form())), "409:invalid_transition");
	assert.equal(await code(reapply(t.deps, t.P)), "409:invalid_transition");
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "reject", confirm: true, feedback: "changed my mind" })), "409:invalid_transition");
	assert.equal(t.repo.profiles.size, 1);
});

test("approval guards: no self-approval, e-mail must be confirmed, account active, not an admin or a learner login; stale versions lose", async () => {
	const t = env();
	// self approval: an admin cannot apply at all, so simulate a row owned by the actor
	const t2 = env();
	await submitComplete(t2);
	const id2 = [...t2.repo.apps.keys()][0];
	assert.equal(await code(reviewAction(t2.deps, t2.actorOf(t2.applicant), id2, { action: "approve", confirm: true })), "403:forbidden");
	t2.repo.users.get(t2.applicant.id).role = "admin"; // the account became an admin after applying
	assert.equal(await code(reviewAction(t2.deps, t2.actorOf(t2.applicant), id2, { action: "approve", confirm: true })), "403:self_approval");
	assert.equal(await code(reviewAction(t2.deps, t2.A, id2, { action: "approve", confirm: true })), "409:not_eligible", "an admin account is never approved as a telecaller");

	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	t.repo.users.get(t.applicant.id).email_confirmed = false;
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "approve", confirm: true })), "409:email_unverified");
	t.repo.users.get(t.applicant.id).email_confirmed = true;
	t.repo.users.get(t.applicant.id).status = false;
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "approve", confirm: true })), "409:account_disabled");
	t.repo.users.get(t.applicant.id).status = true;
	t.repo.markLearner(t.applicant.id);
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "approve", confirm: true })), "409:not_eligible");
	assert.equal(t.repo.profiles.size, 0);

	// two admins clicking at once: exactly one decision is recorded
	const t3 = env();
	await submitComplete(t3);
	const id3 = [...t3.repo.apps.keys()][0];
	const admin2 = t3.repo.addUser({ role: "admin" });
	const settled = await Promise.allSettled([reviewAction(t3.deps, t3.A, id3, { action: "approve", confirm: true }), reviewAction(t3.deps, t3.actorOf(admin2), id3, { action: "reject", confirm: true, feedback: "Not a fit right now." })]);
	assert.equal(settled.filter((s) => s.status === "fulfilled").length, 1);
	assert.equal(t3.repo.events.filter((e) => e.actor === "admin").length, 1);
});

test("unknown actions and bad ids are refused", async () => {
	const t = env();
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "make_admin" })), "422:invalid_action");
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "revoke", confirm: true })), "422:invalid_action");
	assert.equal(await code(reviewAction(t.deps, t.A, "not-a-uuid", { action: "approve", confirm: true })), "404:not_found");
	assert.equal(await code(getApplication(t.deps, t.A, "'; DROP TABLE users;--")), "404:not_found");
	assert.equal(await code(reviewAction(t.deps, t.A, "00000000-0000-4000-8000-000000000000", { action: "approve", confirm: true })), "404:not_found");
});

// ---------------------------------------------------------------- rejection, new attempts

test("rejection: needs a reason, records it, keeps access off, and the applicant sees the status and feedback", async () => {
	const t = env();
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "reject", confirm: true })), "422:invalid");
	assert.equal(await code(reviewAction(t.deps, t.A, id, { action: "reject", feedback: "Not enough experience for now." })), "422:confirmation_required");
	const r = await reviewAction(t.deps, t.A, id, { action: "reject", confirm: true, feedback: "Not enough experience for now.", admin_notes: "weak" });
	assert.equal(r.application.status, "rejected");
	assert.equal(t.repo.profiles.size, 0);
	assert.equal(t.repo.users.get(t.applicant.id).role, "student");
	const mine = await getMine(t.deps, t.P);
	assert.equal(mine.application.status, "rejected");
	assert.equal(mine.application.feedback, "Not enough experience for now.");
	assert.equal(mine.application.can_reapply, false);
	assert.ok(mine.application.reapply_after);
	assert.equal(mine.access, null);
	assert.ok(t.repo.log.notifications.some((n) => n.type === "telecaller_application_rejected"));
	assert.equal(await code(saveDraft(t.deps, t.P, form())), "409:locked");
	assert.equal(await code(reapply(t.deps, t.P)), "403:cooldown");
});

test("a new attempt after the waiting period keeps every earlier event, decision and resume, tagged by attempt", async () => {
	const t = env();
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	await reviewAction(t.deps, t.A, id, { action: "reject", confirm: true, feedback: "Please gain some experience first.", admin_notes: "attempt-1-note" });
	const before = t.repo.events.length;
	const resumeIds = t.repo.allResumeRows().map((r) => r.id);

	t.clock.t += 29 * DAY;
	assert.equal(await code(reapply(t.deps, t.P)), "403:cooldown");
	t.clock.t += 2 * DAY;
	assert.equal((await getMine(t.deps, t.P)).application.can_reapply, true);
	const re = await reapply(t.deps, t.P);
	assert.equal(re.application.status, "draft");
	assert.equal(re.application.attempt, 2);
	assert.equal(re.application.confirmed_adult, false, "the 18+ confirmation and consent must be given again");
	assert.equal(re.application.consented_privacy, false);
	assert.equal(re.application.feedback, null);
	assert.equal(t.repo.events.length, before + 1, "one event added, none removed");
	assert.deepEqual(t.repo.allResumeRows().map((r) => r.id), resumeIds, "the earlier resume is untouched");

	// the resume of attempt 1 does NOT satisfy attempt 2
	let e = await submitApplication(t.deps, t.P, form()).catch((x) => x);
	assert.equal(e.status, 422);
	assert.ok(e.fields.resume);
	// the same file may be uploaded again for attempt 2 (versions are per attempt) and is stored as a separate row
	await uploadResume(t.deps, t.P, file("cv.pdf", pdf(t.applicant.id)));
	assert.equal(t.repo.allResumeRows().length, 2);
	const s = await submitApplication(t.deps, t.P, form());
	assert.equal(s.application.status, "pending");
	assert.equal(s.application.attempt, 2);

	const v = await getApplication(t.deps, t.A, id);
	assert.deepEqual(v.attempts.map((a) => a.attempt), [1, 2]);
	const [a1, a2] = v.attempts;
	assert.deepEqual(a1.events.map((x) => x.to), ["draft", "pending", "rejected"]);
	assert.equal(a1.events[2].feedback, "Please gain some experience first.");
	assert.equal(a1.events[2].internal_note, "attempt-1-note");
	assert.deepEqual(a2.events.map((x) => x.to), ["draft", "pending"]);
	assert.equal(a1.resumes.length, 1);
	assert.equal(a2.resumes.length, 1);
	assert.notEqual(a1.resumes[0].id, a2.resumes[0].id);
	assert.equal(a1.resumes[0].current, false);
	assert.equal(a2.resumes[0].current, true);
	assert.ok(t.repo.events.every((x) => Number.isInteger(x.attempt) && x.attempt >= 1), "every event carries its attempt");

	// attempt 2 can be approved; attempt 1's record is still there
	await reviewAction(t.deps, t.A, id, { action: "approve", confirm: true });
	const done = await getApplication(t.deps, t.A, id);
	assert.equal(done.attempts[0].events.length, 3);
	assert.equal(done.profile.status, "active");
});

test("rejected applications keep working in the rejected list; waiting period follows the configured days", async () => {
	const t = env();
	t.deps.reapplyDays = 7;
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	await reviewAction(t.deps, t.A, id, { action: "reject", confirm: true, feedback: "Please apply again later." });
	t.clock.t += 8 * DAY;
	assert.equal(await code(reapply(t.deps, t.P)), "ok");
});

// ---------------------------------------------------------------- admin lists

test("Applications / Rejected lists, counters, search and pagination", async () => {
	const t = env();
	const people = [];
	for (let i = 0; i < 12; i++) {
		const u = t.repo.addUser({ first_name: `Person${String(i).padStart(2, "0")}`, last_name: "Test", email: `p${i}@example.com` });
		people.push(u);
		await submitComplete(t, u);
		t.clock.t += 1000;
	}
	const open = await listApplications(t.deps, t.A, {});
	assert.equal(open.view, "open");
	assert.equal(open.count, 12);
	assert.equal(open.pages, 2);
	assert.equal(open.applications.length, 10);
	assert.deepEqual(open.counts, { pending: 12, more_info_requested: 0, approved: 0, rejected: 0 });
	const row = open.applications[0];
	for (const k of ["id", "name", "email", "phone", "city", "state", "qualification", "experience", "employment_preference", "status", "attempt", "submitted_at"]) assert.ok(k in row, k);
	assert.equal(row.qualification, "bachelor");
	assert.equal(row.experience, "3 yr");
	assert.equal((await listApplications(t.deps, t.A, { page: 2 })).applications.length, 2);
	assert.equal((await listApplications(t.deps, t.A, { q: "p3@example" })).count, 1);
	assert.equal((await listApplications(t.deps, t.A, { q: "Person07" })).count, 1);
	assert.equal((await listApplications(t.deps, t.A, { q: "nobody-by-this-name" })).count, 0);

	const ids = [...t.repo.apps.values()];
	await reviewAction(t.deps, t.A, ids[0].id, { action: "reject", confirm: true, feedback: "Not this time, sorry." });
	await reviewAction(t.deps, t.A, ids[1].id, { action: "request_info", feedback: "Need one more detail." });
	await reviewAction(t.deps, t.A, ids[2].id, { action: "approve", confirm: true });
	const after = await listApplications(t.deps, t.A, {});
	assert.equal(after.count, 10, "pending (9) + more information requested (1); approved and rejected leave the open list");
	assert.deepEqual(after.counts, { pending: 9, more_info_requested: 1, approved: 1, rejected: 1 });
	assert.equal((await listApplications(t.deps, t.A, { status: "more_info_requested" })).count, 1);
	assert.equal((await listApplications(t.deps, t.A, { status: "approved" })).count, 10, "an out-of-view status filter is ignored");
	const rej = await listApplications(t.deps, t.A, { view: "rejected" });
	assert.equal(rej.view, "rejected");
	assert.equal(rej.count, 1);
	assert.equal(rej.applications[0].status, "rejected");
	assert.ok(rej.applications[0].decided_at);
	// drafts never show up anywhere
	const draftOnly = t.repo.addUser({});
	await saveDraft(t.deps, t.actorOf(draftOnly), form());
	assert.equal((await listApplications(t.deps, t.A, {})).count, 10);
	assert.equal(await code(getApplication(t.deps, t.A, [...t.repo.apps.values()].find((a) => a.user_id === draftOnly.id).id)), "404:not_found");
});

// ---------------------------------------------------------------- admin resume download

test("the admin download returns the right version, is audited, and fails cleanly for unknown ids", async () => {
	const t = env();
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	await reviewAction(t.deps, t.A, id, { action: "request_info", feedback: "Please send a newer resume." });
	await uploadResume(t.deps, t.P, file("newer.pdf", pdf("newer")));
	const view = await getApplication(t.deps, t.A, id);
	const [first, second] = view.attempts[0].resumes;
	const a = await getResumeForAdmin(t.deps, t.A, first.id);
	const b = await getResumeForAdmin(t.deps, t.A, second.id);
	assert.equal(a.filename, "cv.pdf");
	assert.equal(b.filename, "newer.pdf");
	assert.equal(a.mime, "application/pdf");
	assert.ok(Buffer.isBuffer(a.buffer) && a.buffer.equals(pdf(t.applicant.id)));
	assert.ok(b.buffer.equals(pdf("newer")), "the newer version did not replace the first");
	const dl = t.audits.filter((x) => x.action === "telecaller_resume.download");
	assert.equal(dl.length, 2);
	assert.equal(dl[0].details.applicantId, t.applicant.id);
	assert.match(dl[0].details.sha256, /^[0-9a-f]{64}$/);
	assert.ok(!JSON.stringify(dl).includes("%PDF"), "the audit log never holds file content");
	assert.equal(await code(getResumeForAdmin(t.deps, t.A, "00000000-0000-4000-8000-000000000000")), "404:not_found");
	assert.equal(await code(getResumeForAdmin(t.deps, t.A, "nope")), "404:not_found");
});

// ---------------------------------------------------------------- approved telecallers

test("approved telecallers: list, profile, deactivate (reason required) and reactivate, admin only, with versions and audit", async () => {
	const t = env();
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	await reviewAction(t.deps, t.A, id, { action: "approve", confirm: true });
	const list = await listMembers(t.deps, t.A, {});
	assert.equal(list.count, 1);
	assert.deepEqual(list.counts, { active: 1, inactive: 0 });
	const m = list.members[0];
	assert.deepEqual([m.user_id, m.name, m.email, m.city, m.state, m.status], [t.applicant.id, "Asha Verma", t.applicant.email, "Pune", "Maharashtra", "active"]);
	assert.equal((await listMembers(t.deps, t.A, { q: "asha" })).count, 1);
	assert.equal((await listMembers(t.deps, t.A, { q: "zzz" })).count, 0);
	assert.equal((await listMembers(t.deps, t.A, { status: "inactive" })).count, 0);

	const detail = await getMember(t.deps, t.A, t.applicant.id);
	assert.equal(detail.profile.status, "active");
	assert.equal(detail.application.attempts[0].resumes.length, 1, "the full profile includes the application and its resumes");
	assert.equal(await code(getMember(t.deps, t.A, "nope")), "404:not_found");

	assert.equal(await code(setMemberStatus(t.deps, t.A, t.applicant.id, { action: "deactivate", reason: "short" })), "422:invalid");
	assert.equal(await code(setMemberStatus(t.deps, t.A, t.applicant.id, { action: "activate", reason: "" })), "409:invalid_transition", "already active");
	assert.equal(await code(setMemberStatus(t.deps, t.A, t.applicant.id, { action: "explode", reason: "long enough reason" })), "422:invalid_action");
	const off = await setMemberStatus(t.deps, t.A, t.applicant.id, { action: "deactivate", reason: "Policy breach during onboarding." });
	assert.equal(off.profile.status, "inactive");
	assert.equal(off.profile.status_reason, "Policy breach during onboarding.");
	assert.equal(off.profile.status_changed_by_name, "Ada Admin");
	assert.equal(t.repo.profiles.get(t.applicant.id).version, 1);
	assert.equal((await getMine(t.deps, t.P)).access.status, "inactive", "deactivation is visible immediately: access is read from the profile row each time");
	assert.deepEqual((await listMembers(t.deps, t.A, {})).counts, { active: 0, inactive: 1 });
	assert.ok(t.audits.some((a) => a.action === "telecaller_profile.deactivate" && a.details.reason));
	assert.ok(t.repo.log.notifications.some((n) => n.type === "telecaller_access_deactivated" && n.user_id === t.applicant.id));
	assert.equal(t.repo.users.get(t.applicant.id).role, "student");

	const on = await setMemberStatus(t.deps, t.A, t.applicant.id, { action: "activate", reason: "" });
	assert.equal(on.profile.status, "active");
	assert.equal(t.repo.profiles.get(t.applicant.id).version, 2);
	assert.ok(t.repo.log.notifications.some((n) => n.type === "telecaller_access_reactivated"));
	assert.equal(t.repo.events.filter((e) => e.to_status === "approved").length, 1, "access changes do not rewrite the application history");

	const sum = await getSummary(t.deps, t.A);
	assert.deepEqual(sum, { applications: { pending: 0, more_info_requested: 0, approved: 1, rejected: 0 }, telecallers: { active: 1, inactive: 0 } });
});

test("pending and rejected applicants have no profile, so no telecaller access", async () => {
	const t = env();
	await submitComplete(t);
	assert.equal((await getMine(t.deps, t.P)).access, null);
	const id = [...t.repo.apps.keys()][0];
	await reviewAction(t.deps, t.A, id, { action: "reject", confirm: true, feedback: "Not at this time, thanks." });
	assert.equal((await getMine(t.deps, t.P)).access, null);
	assert.equal(t.repo.profiles.size, 0);
	assert.equal((await listMembers(t.deps, t.A, {})).count, 0);
});

test("e-mail problems never undo a decision and are recorded honestly", async () => {
	const t = env();
	t.deps.mailer = async () => { throw new Error("SMTP down"); };
	await submitComplete(t);
	const id = [...t.repo.apps.keys()][0];
	const r = await reviewAction(t.deps, t.A, id, { action: "approve", confirm: true });
	assert.equal(r.application.status, "approved");
	assert.equal(t.repo.events.find((e) => e.to_status === "approved").email_status, "failed");
	t.deps.mailer = async () => ({ ok: true });
	const t2 = env();
	t2.deps.mailer = async () => ({ ok: true });
	await submitComplete(t2);
	assert.equal(t2.repo.events.find((e) => e.to_status === "pending").email_status, "sent");
	// notification retries are idempotent
	const before = t.repo.log.notifications.length;
	await reviewAction(t.deps, t.A, id, { action: "save_notes", admin_notes: "x" });
	assert.equal(t.repo.log.notifications.length, before);
});
