// Free Demo Class requests: stored as meeting requests of kind "free_demo" (see lib/meetings/service.js validateDemoSubmission).
import test from "node:test";
import assert from "node:assert/strict";
import { submitRequest, processRequest, listRequests, getRequest, demoStats, validateSubmission, MeetingError, adminView } from "../../lib/meetings/service.js";
import { createMeetingRepo } from "./memoryRepo.mjs";

const NOW = new Date("2026-11-23T12:00:00Z");
const admin = { userId: "admin-1", role: "admin" };
const telecaller = { userId: "tel-1", role: "student" }; // an ordinary account: must never reach the admin-only calls

function setup() {
	const repo = createMeetingRepo();
	const sent = [];
	const deps = { repo, baseUrl: "https://app.test", adminEmail: "admin@sharpstudy.test", defaultMeetingUrl: "https://meet.example.com/room", now: () => NOW, mailer: async (m) => (sent.push(m), { ok: true }) };
	return { repo, sent, deps };
}
const demo = (extra = {}) => ({ kind: "free_demo", name: "Asha Rao", phone: "+91 98765 43210", childName: "Ravi", childGrade: "Grade 5", program: "mathx", source: "program_mathx", page: "/programs/mathx/", timeZone: "Asia/Kolkata", submissionKey: "key-0000000001", ...extra });
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof MeetingError && e.status === 422 && (!code || !!e.fields[code]), code);

test("the minimum demo request is accepted: parent name, phone, child name, grade and program; everything else is optional", async () => {
	const { repo, sent, deps } = setup();
	const out = await submitRequest(deps, demo());
	assert.equal(out.duplicate, false);
	assert.match(out.reference, /^MTG-[A-Z0-9]{8}$/, "a unique request ID is generated");
	const row = repo._db.requests[0];
	assert.equal(row.kind, "free_demo");
	assert.equal(row.purpose, "product_demo");
	assert.deepEqual([row.child_name, row.child_grade, row.program, row.source, row.source_page], ["Ravi", "Grade 5", "mathx", "program_mathx", "/programs/mathx/"]);
	assert.deepEqual([row.email, row.requested_at, row.requested_date, row.requested_time, row.class_mode], [null, null, null, null, null]);
	assert.ok(row.created_at instanceof Date, "submission timestamp recorded");
	assert.equal(row.status, "pending");
	assert.equal(sent.filter((m) => m.to === "admin@sharpstudy.test").length, 1, "the admin is notified");
	assert.equal(sent.length, 1, "no visitor e-mail without an address");
	assert.equal(row.visitor_email_status, "skipped");
	assert.ok(out.manageToken, "the parent still gets a private status link");
});

test("required fields are validated on the server, with a message per field", async () => {
	const { deps } = setup();
	for (const [bad, field] of [[{ name: "A" }, "name"], [{ phone: "12" }, "phone"], [{ childName: "" }, "childName"], [{ childGrade: "" }, "childGrade"], [{ program: "" }, "program"], [{ program: "chess" }, "program"], [{ email: "not-an-email" }, "email"], [{ classMode: "hybrid" }, "classMode"], [{ date: "2026-12-01" }, "time"], [{ time: "10:00" }, "date"]]) {
		await rejects(submitRequest(deps, demo(bad)), field);
	}
});

test("optional fields work: email, online/offline, preferred date and time, message", async () => {
	const { repo, sent, deps } = setup();
	const out = await submitRequest(deps, demo({ email: "Asha@Example.com", classMode: "online", date: "2026-12-05", time: "16:30", message: "After school please", submissionKey: "key-0000000002" }));
	const row = repo._db.requests.find((r) => r.reference === out.reference);
	assert.deepEqual([row.email, row.class_mode, row.requested_date, row.requested_time, row.time_zone], ["asha@example.com", "online", "2026-12-05", "16:30", "Asia/Kolkata"]);
	assert.equal(row.requested_at.toISOString(), "2026-12-05T11:00:00.000Z");
	assert.equal(row.message, "After school please");
	assert.equal(sent.length, 2, "admin notice and visitor receipt");
	assert.match(sent.find((m) => m.to === "asha@example.com").subject, /free demo request/i);
});

test("preferred time keeps the same limits as a meeting (at least an hour ahead, within 180 days)", async () => {
	const { deps } = setup();
	await rejects(submitRequest(deps, demo({ date: "2026-11-23", time: "12:10" })), "date");
	await rejects(submitRequest(deps, demo({ date: "2027-12-01", time: "10:00" })), "date");
});

test("source and page are recorded but sanitised: unknown sources become 'other', odd paths become '/'", async () => {
	const { repo, deps } = setup();
	await submitRequest(deps, demo({ source: "<script>alert(1)</script>", page: "//evil.example/x", submissionKey: "key-0000000003", childName: "Mira" }));
	assert.deepEqual([repo._db.requests[0].source, repo._db.requests[0].source_page], ["other", "/"]);
});

test("duplicates: the same button pressed twice, and the same parent/child/program while still open, are ONE request", async () => {
	const { repo, deps } = setup();
	const a = await submitRequest(deps, demo());
	const again = await submitRequest(deps, demo()); // same submission key
	assert.equal(again.duplicate, true);
	assert.equal(again.reference, a.reference);
	const retry = await submitRequest(deps, demo({ submissionKey: "key-0000000009", childName: "RAVI" })); // new key, same parent/child/program
	assert.equal(retry.duplicate, true);
	assert.equal(retry.reference, a.reference);
	assert.equal(repo._db.requests.length, 1);
	const other = await submitRequest(deps, demo({ submissionKey: "key-0000000010", program: "leadership" })); // a different program is a new request
	assert.equal(other.duplicate, false);
	assert.equal(repo._db.requests.length, 2);
});

test("a parent cannot flood the system: more than three demo requests a day from one phone are refused", async () => {
	const { deps } = setup();
	for (let n = 0; n < 3; n++) await submitRequest(deps, demo({ submissionKey: `key-flood-00${n}`, childName: `Child ${n}` }));
	await assert.rejects(submitRequest(deps, demo({ submissionKey: "key-flood-009", childName: "Child 9" })), (e) => e instanceof MeetingError && e.status === 429);
});

test("ordinary meeting requests are exactly as strict as before (email, date and time are still required)", () => {
	const meeting = { name: "Ada Lovelace", email: "ada@example.com", phone: "+1 (416) 555-0100", purpose: "product_demo", date: "2026-12-05", time: "10:00", timeZone: "UTC" };
	assert.equal(validateSubmission(meeting, NOW).kind, "meeting");
	for (const drop of ["email", "date", "time"]) {
		const m = { ...meeting };
		delete m[drop];
		assert.throws(() => validateSubmission(m, NOW), (e) => e instanceof MeetingError && e.status === 422, drop);
	}
});

test("admin: listing, filters (kind, program, source, status, search), details and statistics", async () => {
	const { deps } = setup();
	await submitRequest(deps, demo());
	await submitRequest(deps, demo({ submissionKey: "key-0000000011", childName: "Mira", program: "leadership", source: "homepage_hero", page: "/", phone: "+91 90000 11111" }));
	await submitRequest(deps, demo({ submissionKey: "key-0000000012", childName: "Dev", program: "leadership", source: "automatic_popup", page: "/gallery/", phone: "+91 90000 22222" }));
	await submitRequest(deps, { name: "Ada Lovelace", email: "ada@example.com", phone: "+1 (416) 555-0100", purpose: "partnership", date: "2026-12-05", time: "10:00", timeZone: "UTC", submissionKey: "key-meeting-001" });
	const all = await listRequests(deps, admin, {});
	assert.equal(all.total, 4);
	const demos = await listRequests(deps, admin, { kind: "free_demo" });
	assert.equal(demos.total, 3);
	assert.equal((await listRequests(deps, admin, { kind: "free_demo", program: "leadership" })).total, 2);
	assert.equal((await listRequests(deps, admin, { kind: "free_demo", source: "automatic_popup" })).total, 1);
	assert.equal((await listRequests(deps, admin, { kind: "free_demo", q: "mira" })).total, 1, "search finds the child's name");
	assert.equal((await listRequests(deps, admin, { kind: "free_demo", q: "90000 22222" })).total, 1, "search finds the phone number");
	assert.equal(demos.counts.pending, 3, "status counts are scoped to the kind");
	const row = demos.requests[0];
	assert.ok(row.childName && row.childGrade && row.program && row.source && row.sourcePage);
	const stats = await demoStats(deps, admin);
	assert.equal(stats.total, 3);
	assert.deepEqual(stats.byProgram, { mathx: 1, leadership: 2 });
	assert.deepEqual(stats.bySource, { program_mathx: 1, homepage_hero: 1, automatic_popup: 1 });
	assert.equal(stats.statuses.pending, 3);
	const detail = await getRequest(deps, admin, row.id);
	assert.equal(detail.request.kind, "free_demo");
});

test("admin approval: a demo with no preferred time needs the admin to choose one; with one it works as for any meeting", async () => {
	const { repo, deps } = setup();
	const a = await submitRequest(deps, demo());
	const id = repo._db.requests[0].id;
	await assert.rejects(processRequest(deps, admin, id, "approve", { version: 0 }), (e) => e instanceof MeetingError && e.status === 422 && /no preferred time/i.test(e.message));
	const ok = await processRequest(deps, admin, id, "approve", { version: 0, date: "2026-12-10", time: "17:00" });
	assert.equal(ok.request.status, "approved");
	assert.equal(ok.request.confirmedStart.toISOString(), "2026-12-10T11:30:00.000Z");
	assert.equal(a.duplicate, false);
});

test("only administrators can list, read, process or see statistics", async () => {
	const { repo, deps } = setup();
	await submitRequest(deps, demo());
	for (const call of [() => listRequests(deps, telecaller, {}), () => getRequest(deps, telecaller, repo._db.requests[0].id), () => demoStats(deps, telecaller), () => listRequests(deps, null, {})]) {
		await assert.rejects(call(), (e) => e instanceof MeetingError && [401, 403].includes(e.status));
	}
});

test("the admin view of an ordinary meeting still reports kind 'meeting' with no demo fields", () => {
	const v = adminView({ id: "1", reference: "MTG-AAAAAAAA", status: "pending", version: 0, name: "x", email: "a@b.co", phone: "1234567", purpose: "other", created_at: NOW, updated_at: NOW });
	assert.deepEqual([v.kind, v.childName, v.program, v.source], ["meeting", null, null, null]);
});
