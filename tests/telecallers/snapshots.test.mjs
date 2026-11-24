// "Answers as submitted": a snapshot of the complete submitted form on every submit / resubmit event. In-memory repository
// only: no database is touched and the migration is not needed to run these.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { memoryRepo } from "./memoryRepo.mjs";
import {
	getMine, saveDraft, uploadResume, submitApplication, reapply, getApplication, reviewAction, getMember, buildSnapshot, snapshotView,
	FORM_FIELDS, REAPPLY_DAYS, TelecallerError,
} from "../../lib/telecallers/service.js";
import { createColumnProbe, eventAttributes, eventRow, SNAPSHOT_COLUMN } from "../../lib/telecallers/snapshotColumn.js";

const DAY = 86400000;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const pdf = (x = "") => Buffer.from(`%PDF-1.4\n% snapshot test ${x}\n%%EOF`);
const file = (name, buf) => ({ filename: name, data: buf.toString("base64") });
const form = (over = {}) => ({
	full_name: "Asha Verma", phone: "+91 98765 43210", city: "Pune", state: "Maharashtra", qualification: "bachelor",
	has_telecalling_experience: true, experience_years: 3, previous_company: "Acme Calls", languages: "English, Hindi",
	employment_preference: "full_time", additional_info: "Available immediately.", confirmed_adult: true, consented_privacy: true, ...over,
});

function env() {
	const repo = memoryRepo();
	const clock = { t: Date.UTC(2026, 10, 2, 9, 0, 0) };
	const deps = { repo, mailer: async () => ({ ok: false, skipped: true }), baseUrl: "http://localhost:3000", adminEmail: "", reapplyDays: REAPPLY_DAYS, audit: async () => {}, now: () => new Date(clock.t) };
	const admin = repo.addUser({ role: "admin", first_name: "Ada", last_name: "Admin" });
	const applicant = repo.addUser({ first_name: "Asha", last_name: "Verma" });
	const actorOf = (u) => ({ kind: "account", userId: u.id, role: u.role, email: u.email });
	return { repo, deps, clock, admin, applicant, A: actorOf(admin), P: actorOf(applicant), actorOf };
}
const appId = (t) => [...t.repo.apps.keys()][0];
const submits = (t, id = appId(t)) => t.repo.events.filter((e) => e.application_id === id && e.actor === "applicant" && e.to_status === "pending");
const code = async (p) => { try { await p; } catch (e) { return e instanceof TelecallerError ? `${e.status}:${e.code}` : `other:${e && e.message}`; } return "ok"; };

// ---------------------------------------------------------------- initial submission

test("an initial submission stores a complete snapshot with its event, tagged with the attempt", async () => {
	const t = env();
	await uploadResume(t.deps, t.P, file("cv.pdf", pdf("one")));
	await submitApplication(t.deps, t.P, form());
	const [ev] = submits(t);
	assert.ok(ev.form_snapshot, "the submit event carries a snapshot");
	assert.equal(ev.attempt, 1);
	assert.equal(ev.form_snapshot.attempt, ev.attempt, "the snapshot and its event agree on the attempt");
	assert.equal(ev.form_snapshot.v, 1);
	assert.deepEqual(Object.keys(ev.form_snapshot.fields).sort(), [...FORM_FIELDS].sort(), "every form field is in the snapshot");
	assert.deepEqual(ev.form_snapshot.fields, { ...form() }, "values are exactly what was submitted");
	assert.equal(ev.form_snapshot.resumes.length, 1);
	assert.equal(ev.form_snapshot.resumes[0].filename, "cv.pdf");
	assert.match(ev.form_snapshot.resumes[0].sha256, /^[0-9a-f]{64}$/);
	// only the submit event has one: the draft event and every other event do not
	const others = t.repo.events.filter((e) => e !== ev);
	assert.ok(others.length >= 1 && others.every((e) => e.form_snapshot === undefined || e.form_snapshot === null));
});

test("saving drafts and uploading resumes never create a snapshot (only a submission does)", async () => {
	const t = env();
	await saveDraft(t.deps, t.P, form());
	await uploadResume(t.deps, t.P, file("cv.pdf", pdf("d")));
	await saveDraft(t.deps, t.P, { city: "Mumbai" });
	assert.equal(t.repo.events.filter((e) => e.form_snapshot).length, 0);
	await submitApplication(t.deps, t.P, {});
	assert.equal(t.repo.events.filter((e) => e.form_snapshot).length, 1);
	assert.equal(submits(t)[0].form_snapshot.fields.city, "Mumbai", "the snapshot is the merged, validated form that was submitted");
});

test("a failed submission (validation error) stores nothing", async () => {
	const t = env();
	await saveDraft(t.deps, t.P, form());
	assert.equal(await code(submitApplication(t.deps, t.P, {})), "422:invalid", "no resume yet");
	assert.equal(t.repo.events.filter((e) => e.form_snapshot).length, 0);
});

test("the snapshot holds only form data: no admin notes, feedback, internal notes, status or file bytes", async () => {
	const t = env();
	await uploadResume(t.deps, t.P, file("cv.pdf", pdf("secret-bytes-123")));
	await submitApplication(t.deps, t.P, form());
	await reviewAction(t.deps, t.A, appId(t), { action: "save_notes", admin_notes: "PRIVATE-NOTE-XYZ" });
	await reviewAction(t.deps, t.A, appId(t), { action: "request_info", feedback: "FEEDBACK-TEXT-ABC please add details", admin_notes: "INTERNAL-NOTE-QRS" });
	await saveDraft(t.deps, t.P, { city: "Nagpur" });
	await submitApplication(t.deps, t.P, {});
	for (const e of submits(t)) {
		const json = JSON.stringify(e.form_snapshot);
		for (const forbidden of ["PRIVATE-NOTE-XYZ", "FEEDBACK-TEXT-ABC", "INTERNAL-NOTE-QRS", "secret-bytes-123", "%PDF"]) assert.ok(!json.includes(forbidden), forbidden);
		assert.deepEqual(Object.keys(e.form_snapshot).sort(), ["attempt", "fields", "resumes", "v"]);
		assert.ok(!("admin_notes" in e.form_snapshot.fields) && !("feedback" in e.form_snapshot.fields) && !("status" in e.form_snapshot.fields));
		assert.ok(e.form_snapshot.resumes.every((r) => !("data" in r)));
	}
});

// ---------------------------------------------------------------- resubmission, new attempts, preservation

test("a resubmission after 'more information' adds a SECOND snapshot in the same attempt; the first is untouched", async () => {
	const t = env();
	await uploadResume(t.deps, t.P, file("cv1.pdf", pdf("v1")));
	await submitApplication(t.deps, t.P, form({ city: "Pune", languages: "English" }));
	const id = appId(t);
	const first = JSON.parse(JSON.stringify(submits(t)[0].form_snapshot));
	await reviewAction(t.deps, t.A, id, { action: "request_info", feedback: "Please add another language and a newer resume." });
	await saveDraft(t.deps, t.P, { languages: "English, Hindi, Marathi", city: "Nagpur" });
	await uploadResume(t.deps, t.P, file("cv2.pdf", pdf("v2")));
	await submitApplication(t.deps, t.P, {});

	const all = submits(t);
	assert.equal(all.length, 2);
	assert.deepEqual(all.map((e) => e.attempt), [1, 1]);
	assert.deepEqual(all[0].form_snapshot, first, "the first snapshot is byte-for-byte what it was");
	assert.equal(all[0].form_snapshot.fields.city, "Pune");
	assert.equal(all[0].form_snapshot.fields.languages, "English");
	assert.deepEqual(all[0].form_snapshot.resumes.map((r) => r.filename), ["cv1.pdf"]);
	assert.equal(all[1].form_snapshot.fields.city, "Nagpur");
	assert.equal(all[1].form_snapshot.fields.languages, "English, Hindi, Marathi");
	assert.deepEqual(all[1].form_snapshot.resumes.map((r) => r.filename), ["cv1.pdf", "cv2.pdf"]);
	assert.equal(t.repo.apps.get(id).city, "Nagpur", "the live row has the new answers; the snapshot kept the old ones");
});

test("a new attempt keeps every earlier snapshot; each attempt's snapshots belong to that attempt", async () => {
	const t = env();
	await uploadResume(t.deps, t.P, file("a1.pdf", pdf("a1")));
	await submitApplication(t.deps, t.P, form({ city: "Pune", previous_company: "Acme Calls" }));
	const id = appId(t);
	const attempt1 = JSON.parse(JSON.stringify(submits(t)[0].form_snapshot));
	await reviewAction(t.deps, t.A, id, { action: "reject", confirm: true, feedback: "Please gain some experience first." });
	t.clock.t += (REAPPLY_DAYS + 1) * DAY;
	await reapply(t.deps, t.P);
	// the form starts from the previous answers; the applicant changes some
	await saveDraft(t.deps, t.P, { city: "Hyderabad", previous_company: "Globex Telecom", has_telecalling_experience: true, experience_years: 5, confirmed_adult: true, consented_privacy: true });
	await uploadResume(t.deps, t.P, file("a2.pdf", pdf("a2")));
	await submitApplication(t.deps, t.P, {});

	const all = submits(t);
	assert.deepEqual(all.map((e) => e.attempt), [1, 2]);
	assert.deepEqual(all.map((e) => e.form_snapshot.attempt), [1, 2], "each snapshot is tied to its own attempt");
	assert.deepEqual(all[0].form_snapshot, attempt1, "attempt 1's answers are preserved permanently");
	assert.equal(all[0].form_snapshot.fields.city, "Pune");
	assert.equal(all[0].form_snapshot.fields.previous_company, "Acme Calls");
	assert.equal(all[1].form_snapshot.fields.city, "Hyderabad");
	assert.equal(all[1].form_snapshot.fields.experience_years, 5);
	assert.deepEqual(all[0].form_snapshot.resumes.map((r) => r.filename), ["a1.pdf"]);
	assert.deepEqual(all[1].form_snapshot.resumes.map((r) => r.filename), ["a2.pdf"], "the snapshot lists the resumes attached to THAT attempt only");
	assert.equal(t.repo.apps.get(id).city, "Hyderabad");
});

test("nothing that happens later can change a stored snapshot: edits, decisions, notes, approval, deactivation, reads", async () => {
	const t = env();
	await uploadResume(t.deps, t.P, file("cv.pdf", pdf("p")));
	await submitApplication(t.deps, t.P, form());
	const id = appId(t);
	const existing = t.repo.events.length;
	const before = JSON.stringify(t.repo.events.map((e) => e.form_snapshot ?? null));
	await reviewAction(t.deps, t.A, id, { action: "save_notes", admin_notes: "a note" });
	await getApplication(t.deps, t.A, id);
	await getMine(t.deps, t.P);
	await reviewAction(t.deps, t.A, id, { action: "approve", confirm: true, feedback: "Welcome aboard" });
	assert.equal(await code(saveDraft(t.deps, t.P, { city: "Elsewhere" })), "409:locked");
	await getMember(t.deps, t.A, t.applicant.id);
	// a view handed out to a caller is a copy: changing it does not change what is stored
	const view = await getApplication(t.deps, t.A, id);
	view.attempts[0].events.find((e) => e.snapshot).snapshot.fields.city = "TAMPERED";
	// approval added one event (without a snapshot); every event that existed before still holds exactly what it held
	assert.equal(t.repo.events.length, existing + 1);
	const after = JSON.stringify(t.repo.events.slice(0, existing).map((e) => e.form_snapshot ?? null));
	assert.equal(after, before);
	assert.equal(submits(t)[0].form_snapshot.fields.city, "Pune");
	// events that are not submissions never get one
	assert.ok(t.repo.events.filter((e) => !(e.actor === "applicant" && e.to_status === "pending")).every((e) => !e.form_snapshot));
});

// ---------------------------------------------------------------- admin view and access

test("the admin review record shows each attempt's snapshots; submission events are flagged", async () => {
	const t = env();
	await uploadResume(t.deps, t.P, file("cv1.pdf", pdf("1")));
	await submitApplication(t.deps, t.P, form({ city: "Pune" }));
	const id = appId(t);
	await reviewAction(t.deps, t.A, id, { action: "request_info", feedback: "Please update your city if it changed." });
	await saveDraft(t.deps, t.P, { city: "Nagpur" });
	await submitApplication(t.deps, t.P, {});
	await reviewAction(t.deps, t.A, id, { action: "reject", confirm: true, feedback: "Not a fit at this time, sorry." });
	t.clock.t += (REAPPLY_DAYS + 1) * DAY;
	await reapply(t.deps, t.P);
	await uploadResume(t.deps, t.P, file("cv2.pdf", pdf("2")));
	await submitApplication(t.deps, t.P, form({ city: "Mumbai", confirmed_adult: true, consented_privacy: true }));

	const v = await getApplication(t.deps, t.A, id);
	assert.deepEqual(v.attempts.map((a) => a.attempt), [1, 2]);
	const snaps = (a) => a.events.filter((e) => e.snapshot).map((e) => e.snapshot.fields.city);
	assert.deepEqual(snaps(v.attempts[0]), ["Pune", "Nagpur"]);
	assert.deepEqual(snaps(v.attempts[1]), ["Mumbai"]);
	for (const a of v.attempts) for (const e of a.events) {
		assert.equal(e.submission, e.actor === "applicant" && e.to === "pending");
		if (e.snapshot) assert.equal(e.snapshot.attempt, a.attempt, "a snapshot is shown under its own attempt");
		if (!e.submission) assert.equal(e.snapshot, null);
	}
	// the same record is what the Approved Telecallers profile shows once approved
	await reviewAction(t.deps, t.A, id, { action: "approve", confirm: true });
	const m = await getMember(t.deps, t.A, t.applicant.id);
	assert.deepEqual(m.application.attempts.map((a) => a.events.filter((e) => e.snapshot).length), [2, 1]);
});

test("snapshots are admin-only: the applicant view, other users and non-admins never receive them", async () => {
	const t = env();
	await uploadResume(t.deps, t.P, file("cv.pdf", pdf("x")));
	await submitApplication(t.deps, t.P, form({ city: "OldCity" }));
	const id = appId(t);
	await reviewAction(t.deps, t.A, id, { action: "request_info", feedback: "Please double check your city." });
	await saveDraft(t.deps, t.P, { city: "NewCity" });
	await submitApplication(t.deps, t.P, {});

	const mine = JSON.stringify(await getMine(t.deps, t.P));
	assert.doesNotMatch(mine, /form_snapshot|"snapshot"|Answers as submitted/);
	assert.doesNotMatch(mine, /OldCity/, "an earlier answer is not in anything the applicant is sent back");
	assert.match(mine, /NewCity/, "the applicant still sees their own current answers");
	assert.doesNotMatch(mine, /internal_note|admin_notes/);

	const instr = t.repo.addUser({ role: "instructor" });
	const other = t.repo.addUser({});
	for (const who of [t.P, t.actorOf(instr), t.actorOf(other)]) {
		assert.equal(await code(getApplication(t.deps, who, id)), "403:forbidden");
		assert.equal(await code(getMember(t.deps, who, t.applicant.id)), "403:forbidden");
		assert.equal(await code(reviewAction(t.deps, who, id, { action: "save_notes", admin_notes: "x" })), "403:forbidden");
	}
	assert.equal(await code(getApplication(t.deps, null, id)), "401:unauthenticated");
	assert.match(JSON.stringify(await getApplication(t.deps, t.A, id)), /OldCity/, "the admin does see the earlier answers");
});

test("events without a snapshot (created before the column existed) keep working normally", async () => {
	const t = env();
	await uploadResume(t.deps, t.P, file("cv.pdf", pdf("legacy")));
	await submitApplication(t.deps, t.P, form());
	const id = appId(t);
	// simulate an older database row: the column was never written
	for (const e of t.repo.events) delete e.form_snapshot;
	let v = await getApplication(t.deps, t.A, id);
	const sub = v.attempts[0].events.find((e) => e.submission);
	assert.equal(sub.snapshot, null, "no snapshot, no crash");
	assert.equal(v.attempts[0].events.length, 2);
	assert.equal(v.status, "pending");
	assert.ok(await getMine(t.deps, t.P));
	// the normal flow goes on, and NEW submissions get snapshots while the old event stays without
	await reviewAction(t.deps, t.A, id, { action: "request_info", feedback: "Please add one more detail." });
	await saveDraft(t.deps, t.P, { city: "Nagpur" });
	await submitApplication(t.deps, t.P, {});
	v = await getApplication(t.deps, t.A, id);
	const subs = v.attempts[0].events.filter((e) => e.submission);
	assert.deepEqual(subs.map((e) => (e.snapshot ? e.snapshot.fields.city : null)), [null, "Nagpur"]);
	assert.equal((await reviewAction(t.deps, t.A, id, { action: "approve", confirm: true })).application.status, "approved");
});

test("snapshotView: only known form fields come back, damaged or unknown values become null, strings are parsed", () => {
	const good = buildSnapshot({ ...form(), attempt: 3, status: "approved", admin_notes: "SECRET", role: "admin" }, [{ id: "r1", original_filename: "a.pdf", mime_type: "application/pdf", size_bytes: 10, sha256: "x".repeat(64), data: Buffer.from("BYTES") }]);
	assert.deepEqual(Object.keys(good.fields).sort(), [...FORM_FIELDS].sort(), "building drops anything that is not a form field");
	assert.ok(!JSON.stringify(good).includes("SECRET") && !JSON.stringify(good).includes("BYTES"));
	assert.equal(good.attempt, 3);
	const parsed = snapshotView(JSON.stringify(good));
	assert.equal(parsed.fields.full_name, "Asha Verma");
	// a stored JSON that somehow holds extra keys: they are not passed on
	const polluted = snapshotView({ v: 1, attempt: 1, fields: { ...good.fields, admin_notes: "LEAK", role: "admin" }, resumes: [{ id: "r", filename: "f.pdf", data: "LEAK" }], admin_notes: "LEAK" });
	assert.ok(!JSON.stringify(polluted).includes("LEAK"));
	assert.deepEqual(Object.keys(polluted.fields).sort(), [...FORM_FIELDS].sort());
	for (const bad of [null, undefined, "", "not json", "[]", 5, {}, { fields: "x" }, { fields: null }]) assert.equal(snapshotView(bad), null, String(bad));
	assert.equal(snapshotView({ fields: { full_name: "A" } }).fields.phone, null, "a missing field is null");
});

// ---------------------------------------------------------------- before the migration is applied

test("the column probe: absent until seen, then remembered; a miss is re-checked only after the retry window", async () => {
	let calls = 0, present = false, fail = false, t = 0;
	const probe = createColumnProbe(async () => { calls++; if (fail) throw new Error("no connection"); return present ? { id: {}, [SNAPSHOT_COLUMN]: {} } : { id: {} }; }, { now: () => t, retryMs: 30000 });
	assert.equal(await probe(), false);
	assert.equal(await probe(), false);
	assert.equal(calls, 1, "a miss does not cost a schema query on every call");
	t += 29999;
	assert.equal(await probe(), false);
	assert.equal(calls, 1);
	present = true; // the migration is applied
	assert.equal(await probe(), false, "still inside the window");
	t += 2;
	assert.equal(await probe(), true, "picked up after the window, with no restart");
	present = false; // once seen, it is remembered
	t += 100000;
	assert.equal(await probe(), true);
	assert.equal(calls, 2, "a positive answer is never asked again");
	// an error counts as absent (the page keeps working) and is retried later
	calls = 0; fail = true; t = 0;
	const failing = createColumnProbe(async () => { calls++; throw new Error("boom"); }, { now: () => t, retryMs: 1000 });
	assert.equal(await failing(), false);
	t += 1001;
	assert.equal(await failing(), false);
	assert.equal(calls, 2);
});

test("without the column events are read and written without it, so nothing breaks before the migration is applied", () => {
	assert.deepEqual(eventAttributes(false), { exclude: ["form_snapshot"] });
	assert.equal(eventAttributes(true), undefined, "with the column: the default (all columns)");
	const ev = { application_id: "a", attempt: 1, to_status: "pending", form_snapshot: { v: 1 } };
	assert.ok(!("form_snapshot" in eventRow(ev, false)), "a submission is still recorded, just without its snapshot");
	assert.equal(eventRow(ev, false).to_status, "pending");
	assert.equal(eventRow(ev, true), ev, "with the column: written as is");
	const plain = { application_id: "a", to_status: "draft" };
	assert.equal(eventRow(plain, false), plain);
	assert.ok("form_snapshot" in ev, "the original object was not modified");
});

// ---------------------------------------------------------------- wiring (source)

test("wiring: repository tolerance on every event path, snapshots written only at insert, no new route, admin-only UI", () => {
	const repo = read("lib/telecallers/repo.js");
	assert.equal((repo.match(/eventRow\(/g) || []).length, 3, "createApplication, updateIf and transition all write events through eventRow");
	assert.equal((repo.match(/eventAttributes\(/g) || []).length, 1, "the only event read goes through eventAttributes");
	assert.match(repo, /createColumnProbe\(\(\) => connection\.getQueryInterface\(\)\.describeTable\("telecaller_application_events"\)\)/);
	assert.equal((repo.match(/TelecallerApplicationEvent\.update/g) || []).length, 1);
	assert.match(repo, /TelecallerApplicationEvent\.update\(\{ email_status: status \}/, "the only event update touches e-mail bookkeeping, never a snapshot");
	assert.doesNotMatch(repo.replace(/\/\/.*$/gm, ""), /form_snapshot\s*[:=]|\.form_snapshot\s*=/, "the repository never assigns a snapshot");
	assert.doesNotMatch(repo, /sync\(|queryInterface\.(addColumn|createTable)|ALTER TABLE/i, "the application never changes the schema by itself");

	assert.match(read("database/models/telecaller.js"), /form_snapshot: DataTypes\.JSON/);

	const svc = read("lib/telecallers/service.js");
	assert.equal((svc.match(/form_snapshot: buildSnapshot\(/g) || []).length, 1, "exactly one place writes a snapshot: the applicant's submit event");
	assert.doesNotMatch(svc.slice(svc.indexOf("export function applicantView"), svc.indexOf("// The admin's full review record")), /snapshot/, "the applicant view cannot include a snapshot");
	const reapplyFn = svc.slice(svc.indexOf("export async function reapply("), svc.indexOf("// ---------------------------------------------------------------- admin: applications"));
	assert.doesNotMatch(reapplyFn, /snapshot/);
	const reviewFn = svc.slice(svc.indexOf("export async function reviewAction("), svc.indexOf("// Admin-only download of one resume version"));
	assert.doesNotMatch(reviewFn, /buildSnapshot/, "admin decisions never write snapshots");

	// no new API route: snapshots travel in the existing admin application / member responses
	const routes = (dir) => readdirSync(new URL(`../../${dir}/`, import.meta.url), { recursive: true }).filter((f) => /\.js$/.test(f)).sort();
	// (Phase 3 added activity.js, the admin Activity & Call History API; snapshots still use no new route of their own.)
	assert.deepEqual(routes("pages/api/admin/telecallers"), ["activity.js", "applications.js", "members.js", "resumes/[id].js", "summary.js", "resumes\\[id].js"].filter((f) => routes("pages/api/admin/telecallers").includes(f)).sort());
	assert.deepEqual(routes("pages/api/telecallers"), ["apply.js", "resume.js"]);

	const ui = read("components/Admin/Telecallers/shared.js");
	assert.match(ui, /Answers as submitted/);
	assert.match(ui, /Answers as submitted were not recorded for this submission/, "a submission without a snapshot says so");
	assert.match(ui, /changed since the previous submission/);
	assert.doesNotMatch(read("components/BecomeATelecaller/TelecallerApplicationForm.js"), /snapshot|Answers as submitted/i, "nothing of it in the applicant UI");
	for (const f of ["components/Admin/Telecallers/ApplicationsBoard.js", "components/Admin/Telecallers/MembersBoard.js"]) assert.match(read(f), /AttemptHistory/, f);
});
