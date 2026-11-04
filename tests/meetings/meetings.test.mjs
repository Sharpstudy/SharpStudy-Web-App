import test from "node:test";
import assert from "node:assert/strict";
import { submitRequest, processRequest, listRequests, getRequest, visitorView, visitorAct, validateSubmission, MeetingError, publicView } from "../../lib/meetings/service.js";
import { zonedToUtc, isValidTimeZone, formatInZone } from "../../lib/meetings/time.js";
import { createMeetingRepo } from "./memoryRepo.mjs";

const NOW = new Date("2026-10-14T12:00:00Z");
const admin = { userId: "admin-1", role: "admin" };
const student = { userId: "stu-1", role: "student" };
const instructor = { userId: "ins-1", role: "instructor" };

function setup(over = {}) {
	const repo = createMeetingRepo();
	const sent = [];
	const state = { clock: NOW, mail: async (m) => (sent.push(m), { ok: true }) };
	const deps = {
		repo,
		baseUrl: "https://app.test",
		adminEmail: "admin@sharpstudy.test",
		defaultMeetingUrl: "",
		now: () => state.clock,
		mailer: (m) => state.mail(m),
		...over,
	};
	return { repo, sent, state, deps };
}
const good = (extra = {}) => ({ name: "Ada Lovelace", email: "Ada@Example.com", phone: "+1 (416) 555-0100", organization: "Analytical Engines", purpose: "product_demo", message: "Hello", date: "2026-10-20", time: "14:30", timeZone: "America/Toronto", ...extra });
const rejects = (p, status, code) => assert.rejects(p, (e) => e instanceof MeetingError && e.status === status && (!code || e.code === code), `expected ${status} ${code || ""}`);
const URL1 = "https://meet.example.com/room-1";

// ------------------------------------------------------------------ time

test("time zones: conversion honours DST and rejects impossible values", () => {
	assert.equal(zonedToUtc("2026-10-20", "14:30", "America/Toronto").toISOString(), "2026-10-20T18:30:00.000Z"); // EDT
	assert.equal(zonedToUtc("2026-11-02", "09:00", "America/Toronto").toISOString(), "2026-11-02T14:00:00.000Z"); // EST
	assert.equal(zonedToUtc("2026-10-20", "10:00", "Asia/Kolkata").toISOString(), "2026-10-20T04:30:00.000Z");
	assert.equal(zonedToUtc("2026-10-20", "10:00", "UTC").toISOString(), "2026-10-20T10:00:00.000Z");
	for (const bad of [["2026-02-30", "10:00", "UTC"], ["2026-13-01", "10:00", "UTC"], ["2026-10-20", "25:00", "UTC"], ["2026-10-20", "10:60", "UTC"], ["20-10-2026", "10:00", "UTC"], ["2026-10-20", "10:00", "Mars/Base"]]) {
		assert.equal(zonedToUtc(...bad), null, bad.join(" "));
	}
	assert.equal(isValidTimeZone("Europe/Paris"), true);
	assert.equal(isValidTimeZone("Not/AZone"), false);
	assert.match(formatInZone(new Date("2026-10-20T18:30:00Z"), "America/Toronto"), /2:30 PM \(America\/Toronto\)/);
});

// ---------------------------------------------------------------- submission

test("a valid request is saved as pending, notifies the admin and the visitor, and is not confirmed", async () => {
	const { deps, repo, sent } = setup();
	const out = await submitRequest(deps, good());
	assert.match(out.reference, /^MTG-[A-Z0-9]{8}$/);
	assert.equal(out.status, "pending");
	assert.match(out.manageToken, /^[a-f0-9]{48}$/);
	const row = repo._db.requests[0];
	assert.equal(row.status, "pending");
	assert.equal(row.email, "ada@example.com", "e-mail normalised");
	assert.equal(row.requested_at.toISOString(), "2026-10-20T18:30:00.000Z");
	assert.equal(row.confirmed_start, null);
	assert.notEqual(row.manage_token_hash, out.manageToken, "only a hash of the token is stored");
	assert.equal(repo._db.events.length, 1);
	assert.deepEqual(sent.map((m) => m.to), ["admin@sharpstudy.test", "ada@example.com"]);
	assert.match(sent[0].html, new RegExp(out.reference));
	assert.match(sent[0].html, /https:\/\/app\.test\/admin\/meetings\/\?open=/);
	assert.match(sent[1].html, /not confirmed yet/i);
	assert.equal(row.admin_email_status, "sent");
	assert.equal(row.visitor_email_status, "sent");
});

test("invalid submissions are rejected with field errors and nothing is saved or e-mailed", async () => {
	const { deps, repo, sent } = setup();
	const cases = [
		[{ name: "" }, "name"],
		[{ name: "A" }, "name"],
		[{ email: "" }, "email"],
		[{ email: "not-an-email" }, "email"],
		[{ email: "a@b" }, "email"],
		[{ phone: "" }, "phone"],
		[{ phone: "abc" }, "phone"],
		[{ phone: "12" }, "phone"],
		[{ purpose: "" }, "purpose"],
		[{ purpose: "free_money" }, "purpose"],
		[{ timeZone: "" }, "timeZone"],
		[{ timeZone: "Mars/Base" }, "timeZone"],
		[{ date: "" }, "date"],
		[{ date: "2026-02-30" }, "date"],
		[{ date: "2026-10-13" }, "date"], // yesterday
		[{ date: "2020-01-01" }, "date"],
		[{ date: "2026-10-14", time: "08:00" }, "date"], // earlier today
		[{ date: "2026-10-14", time: "12:30", timeZone: "UTC" }, "date"], // < 1 hour ahead
		[{ date: "2027-12-01" }, "date"], // beyond 180 days
		[{ time: "" }, "time"],
		[{ time: "25:00" }, "time"],
		[{ submissionKey: "x" }, "submissionKey"],
	];
	for (const [extra, field] of cases) {
		await assert.rejects(submitRequest(deps, good(extra)), (e) => e instanceof MeetingError && e.status === 422 && field in e.fields, `${JSON.stringify(extra)} -> ${field}`);
	}
	await rejects(submitRequest(deps, {}), 422);
	await rejects(submitRequest(deps, null), 422);
	assert.equal(repo._db.requests.length, 0);
	assert.equal(sent.length, 0);
});

test("fields are cleaned: control characters, whitespace and oversize text", () => {
	const v = validateSubmission(good({ name: "  Ada\r\n  Lovelace\u0000 ", message: "x".repeat(5000), organization: "  " }), NOW);
	assert.equal(v.name, "Ada Lovelace");
	assert.equal(v.message.length, 2000);
	assert.equal(v.organization, null);
});

test("pressing submit twice (same submission key) or resending the same request creates one request", async () => {
	const { deps, repo, sent } = setup();
	const a = await submitRequest(deps, good({ submissionKey: "key-12345678" }));
	const b = await submitRequest(deps, good({ submissionKey: "key-12345678" }));
	assert.equal(b.duplicate, true);
	assert.equal(b.reference, a.reference);
	assert.equal(b.manageToken, undefined, "the secret is never returned again");
	const c = await submitRequest(deps, good({ email: "ADA@example.com" })); // same person, same moment, still pending
	assert.equal(c.duplicate, true);
	assert.equal(repo._db.requests.length, 1);
	assert.equal(sent.length, 2, "no extra e-mails for duplicates");
});

test("per-address daily limit", async () => {
	const { deps, repo } = setup();
	for (const time of ["10:00", "11:00", "12:00"]) await submitRequest(deps, good({ time }));
	await rejects(submitRequest(deps, good({ time: "13:00" })), 429, "too_many_requests");
	assert.equal(repo._db.requests.length, 3);
	await submitRequest(deps, good({ time: "13:00", email: "someone.else@example.com" })); // other addresses unaffected
});

// -------------------------------------------------------------------- e-mail

test("e-mail failure never loses the request; it is recorded and can be retried", async () => {
	const { deps, repo, state } = setup();
	state.mail = async () => ({ ok: false, error: "SMTP connection refused" });
	const out = await submitRequest(deps, good());
	assert.equal(out.status, "pending");
	let row = repo._db.requests[0];
	assert.equal(row.admin_email_status, "failed");
	assert.equal(row.visitor_email_status, "failed");
	assert.match(row.last_email_error, /SMTP connection refused/);

	state.mail = async () => {
		throw new Error("boom");
	};
	await submitRequest(deps, good({ time: "15:00" })); // a throwing mailer is also survived
	assert.equal(repo._db.requests.length, 2);

	const delivered = [];
	state.mail = async (m) => (delivered.push(m), { ok: true });
	const r = await processRequest(deps, admin, row.id, "resend_email");
	assert.equal(r.request.adminEmailStatus, "sent");
	assert.equal(r.request.visitorEmailStatus, "sent");
	assert.equal(delivered.length, 2);
});

test("missing admin address or credentials is recorded as skipped, not an error", async () => {
	const { deps, repo } = setup({ adminEmail: "" });
	await submitRequest(deps, good());
	assert.equal(repo._db.requests[0].admin_email_status, "skipped");
	assert.match(repo._db.requests[0].last_email_error, /MEETING_ADMIN_EMAIL/);
	const s2 = setup();
	s2.state.mail = async () => ({ ok: false, skipped: true, error: "e-mail credentials are not configured" });
	await submitRequest(s2.deps, good());
	assert.equal(s2.repo._db.requests[0].visitor_email_status, "skipped");
});

test("e-mails escape visitor-supplied HTML and keep subjects on one line", async () => {
	const { deps, sent } = setup();
	await submitRequest(deps, good({ name: '<img src=x onerror="alert(1)"> Eve', message: "<script>x</script>", organization: "<b>Co</b>" }));
	for (const m of sent) {
		assert.ok(!m.html.includes("<img"), "name escaped");
		assert.ok(!m.html.includes("<script>"));
		assert.ok(!/[\r\n]/.test(m.subject));
	}
	assert.match(sent[0].html, /&lt;img/);
});

// ---------------------------------------------------------------- visitor

test("only the holder of the secret link can view, cancel or accept; admin notes stay private", async () => {
	const { deps, repo } = setup();
	const { reference, manageToken } = await submitRequest(deps, good());
	const id = repo._db.requests[0].id;
	await processRequest(deps, admin, id, "note", { notes: "VIP, handle with care" });
	const view = await visitorView(deps, reference, manageToken);
	assert.equal(view.status, "pending");
	assert.ok(!JSON.stringify(view).includes("VIP"), "no admin notes");
	for (const k of ["email", "phone", "adminNotes", "manage_token_hash", "id", "processedBy"]) assert.ok(!(k in view), `public view must not contain ${k}`);

	const miss = (ref, tok) => rejects(visitorView(deps, ref, tok), 404, "not_found");
	await miss(reference, "0".repeat(48));
	await miss("MTG-ZZZZZZZZ", manageToken);
	await miss(reference, "");
	await miss(reference, undefined);
	await miss({ $ne: "" }, manageToken);
	await miss("' OR 1=1 --", manageToken);
	const other = await submitRequest(deps, good({ email: "bob@example.com", time: "16:00" }));
	await miss(reference, other.manageToken); // someone else's token

	const cancelled = await visitorAct(deps, reference, manageToken, "cancel");
	assert.equal(cancelled.status, "cancelled");
	await rejects(visitorAct(deps, reference, manageToken, "cancel"), 409, "invalid_transition");
	await rejects(visitorAct(deps, reference, manageToken, "accept"), 409);
	await rejects(visitorAct(deps, reference, manageToken, "approve"), 422);
});

test("a visitor can accept a proposed time; it is re-checked for overlaps", async () => {
	const { deps, repo, sent } = setup();
	const a = await submitRequest(deps, good());
	const idA = repo._db.requests[0].id;
	const p = await processRequest(deps, admin, idA, "reschedule", { version: 0, date: "2026-10-22", time: "09:00", meetingUrl: URL1, notes: "Busy that day" });
	assert.equal(p.request.status, "reschedule_requested");
	assert.equal(+p.request.proposedStart, +repo._db.requests[0].proposed_start);
	const propose = sent.at(-1);
	assert.match(propose.subject, /new time is proposed/i);
	assert.match(propose.html, /Oct 22, 2026/);
	assert.ok(!propose.html.includes("Busy that day"), "admin notes never e-mailed");
	assert.equal(+(await visitorView(deps, a.reference, a.manageToken)).proposedStart, +repo._db.requests[0].proposed_start);

	// someone else gets that slot first
	const b = await submitRequest(deps, good({ email: "bob@example.com", date: "2026-10-22", time: "09:15" }));
	const idB = repo._db.requests.find((r) => r.reference === b.reference).id;
	await processRequest(deps, admin, idB, "approve", { version: 0, meetingUrl: URL1 });
	await rejects(visitorAct(deps, a.reference, a.manageToken, "accept"), 409, "overlap");
	await processRequest(deps, admin, idB, "cancel", { version: 1 });
	const accepted = await visitorAct(deps, a.reference, a.manageToken, "accept");
	assert.equal(accepted.status, "approved");
	assert.equal(accepted.meetingUrl, URL1);
	assert.equal(repo._db.requests[0].confirmed_end - repo._db.requests[0].confirmed_start, 30 * 60000);
});

// -------------------------------------------------------------------- admin

test("admin endpoints refuse anonymous, student and instructor actors", async () => {
	const { deps, repo } = setup();
	await submitRequest(deps, good());
	const id = repo._db.requests[0].id;
	for (const [actor, status] of [[null, 401], [{}, 401], [student, 403], [instructor, 403], [{ userId: "x", role: "admin-ish" }, 403]]) {
		await rejects(listRequests(deps, actor), status);
		await rejects(getRequest(deps, actor, id), status);
		await rejects(processRequest(deps, actor, id, "approve", { version: 0, meetingUrl: URL1 }), status);
		await rejects(processRequest(deps, actor, id, "note", { notes: "x" }), status);
		await rejects(processRequest(deps, actor, id, "resend_email"), status);
	}
	assert.equal(repo._db.requests[0].status, "pending");
	assert.equal(repo._db.requests[0].admin_notes, null);
});

test("approve: records the verified admin, the confirmed slot and the meeting link, and e-mails the visitor", async () => {
	const { deps, repo, sent } = setup();
	await submitRequest(deps, good());
	const id = repo._db.requests[0].id;
	const r = await processRequest(deps, admin, id, "approve", { version: 0, meetingUrl: URL1, notes: "ok", processedBy: "someone-else", status: "rejected", role: "admin" });
	assert.equal(r.request.status, "approved");
	assert.equal(r.request.processedBy, "admin-1", "the acting admin comes from the verified actor only");
	assert.ok(r.request.processedAt);
	assert.equal(r.request.confirmedStart.toISOString(), "2026-10-20T18:30:00.000Z", "defaults to the requested time");
	assert.equal(r.request.meetingUrl, URL1);
	assert.equal(r.request.version, 1);
	const mail = sent.at(-1);
	assert.equal(mail.to, "ada@example.com");
	assert.match(mail.subject, /confirmed/i);
	assert.match(mail.html, /Tue, Oct 20, 2026, 2:30 PM \(America\/Toronto\)/);
	assert.match(mail.html, /meet\.example\.com\/room-1/);
	const detail = await getRequest(deps, admin, id);
	assert.deepEqual(detail.events.map((e) => [e.from, e.to, e.actor]), [[null, "pending", "visitor"], ["pending", "approved", "admin"]]);
});

test("approval needs a valid http(s) link (or MEETING_DEFAULT_URL) and a future time", async () => {
	const { deps, repo } = setup();
	await submitRequest(deps, good());
	const id = repo._db.requests[0].id;
	await rejects(processRequest(deps, admin, id, "approve", { version: 0 }), 422);
	for (const meetingUrl of ["javascript:alert(1)", "ftp://x.test", "not a url", "data:text/html,hi"]) await rejects(processRequest(deps, admin, id, "approve", { version: 0, meetingUrl }), 422);
	await rejects(processRequest(deps, admin, id, "approve", { version: 0, meetingUrl: URL1, date: "2026-10-01", time: "10:00" }), 422);
	await rejects(processRequest(deps, admin, id, "approve", { version: 0, meetingUrl: URL1, date: "2026-02-30", time: "10:00" }), 422);
	assert.equal(repo._db.requests[0].status, "pending");
	deps.defaultMeetingUrl = "https://default.example.com/lobby";
	const ok = await processRequest(deps, admin, id, "approve", { version: 0 });
	assert.equal(ok.request.meetingUrl, "https://default.example.com/lobby");
});

test("reject and cancel: polite e-mail, no slot kept", async () => {
	const { deps, repo, sent } = setup();
	await submitRequest(deps, good());
	const id = repo._db.requests[0].id;
	const r = await processRequest(deps, admin, id, "reject", { version: 0, notes: "Out of scope" });
	assert.equal(r.request.status, "rejected");
	assert.equal(r.request.confirmedStart, null);
	assert.match(sent.at(-1).html, /not able to schedule/i);
	assert.ok(!sent.at(-1).html.includes("Out of scope"));

	await submitRequest(deps, good({ email: "c@example.com" }));
	const id2 = repo._db.requests[1].id;
	await processRequest(deps, admin, id2, "approve", { version: 0, meetingUrl: URL1 });
	const c = await processRequest(deps, admin, id2, "cancel", { version: 1 });
	assert.equal(c.request.status, "cancelled");
	assert.equal(c.request.confirmedStart, null);
});

test("invalid transitions and unknown actions are refused", async () => {
	const { deps, repo } = setup();
	await submitRequest(deps, good());
	const id = repo._db.requests[0].id;
	await processRequest(deps, admin, id, "reject", { version: 0 });
	for (const action of ["approve", "reject", "reschedule", "cancel"]) await rejects(processRequest(deps, admin, id, action, { version: 1, meetingUrl: URL1 }), 409);
	await rejects(processRequest(deps, admin, id, "delete", { version: 1 }), 422);
	await rejects(processRequest(deps, admin, id, "", { version: 1 }), 422);
	await rejects(processRequest(deps, admin, "no-such-id", "approve", { version: 0 }), 404);
	assert.equal(repo._db.requests[0].status, "rejected");
});

test("concurrent updates: version mismatch and double approval are refused", async () => {
	const { deps, repo } = setup();
	await submitRequest(deps, good());
	const id = repo._db.requests[0].id;
	await rejects(processRequest(deps, admin, id, "approve", { meetingUrl: URL1 }), 422, "invalid"); // version required
	await rejects(processRequest(deps, admin, id, "approve", { version: "0", meetingUrl: URL1 }), 422);
	await rejects(processRequest(deps, admin, id, "approve", { version: 5, meetingUrl: URL1 }), 409, "conflict");

	// Two admins click Approve and Reject at the same moment on the same version.
	const results = await Promise.allSettled([
		processRequest(deps, admin, id, "approve", { version: 0, meetingUrl: URL1 }),
		processRequest(deps, { userId: "admin-2", role: "admin" }, id, "reject", { version: 0 }),
	]);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one wins");
	assert.equal(results.filter((r) => r.status === "rejected" && r.reason.status === 409).length, 1);
	const final = repo._db.requests[0];
	assert.equal(final.version, 1);
	assert.equal(repo._db.events.filter((e) => e.to_status !== "pending").length, 1, "only one status change was recorded");

	// Double submit of Approve with the (now stale) version
	if (final.status === "approved") await rejects(processRequest(deps, admin, id, "approve", { version: 0, meetingUrl: URL1 }), 409);
});

test("overlapping confirmed meetings are refused; adjacent ones are fine; cancelling frees the slot", async () => {
	const { deps, repo } = setup();
	const ids = [];
	for (const [email, time] of [["a@example.com", "10:00"], ["b@example.com", "10:15"], ["c@example.com", "10:30"], ["d@example.com", "09:45"]]) {
		await submitRequest(deps, good({ email, time, timeZone: "UTC", date: "2026-10-21" }));
		ids.push(repo._db.requests.at(-1).id);
	}
	await processRequest(deps, admin, ids[0], "approve", { version: 0, meetingUrl: URL1 }); // 10:00-10:30
	await rejects(processRequest(deps, admin, ids[1], "approve", { version: 0, meetingUrl: URL1 }), 409, "overlap"); // 10:15
	await rejects(processRequest(deps, admin, ids[3], "approve", { version: 0, meetingUrl: URL1 }), 409, "overlap"); // 09:45-10:15
	await processRequest(deps, admin, ids[2], "approve", { version: 0, meetingUrl: URL1 }); // 10:30-11:00 touches, does not overlap
	assert.equal(repo._db.requests[1].status, "pending", "a refused approval changes nothing");
	await processRequest(deps, admin, ids[0], "cancel", { version: 1 });
	const freed = await processRequest(deps, admin, ids[3], "approve", { version: 0, meetingUrl: URL1 }); // 09:45-10:15, only clashed with the cancelled one
	assert.equal(freed.request.status, "approved");
	await rejects(processRequest(deps, admin, ids[1], "approve", { version: 0, meetingUrl: URL1 }), 409, "overlap"); // 10:15-10:45 now clashes with the 10:30 meeting
	// An already-approved meeting cannot be approved a second time
	await rejects(processRequest(deps, admin, ids[2], "approve", { version: 1, meetingUrl: URL1 }), 409, "invalid_transition");
});

test("reschedule proposals need a future time and a link; they can be re-proposed", async () => {
	const { deps, repo } = setup();
	await submitRequest(deps, good());
	const id = repo._db.requests[0].id;
	await rejects(processRequest(deps, admin, id, "reschedule", { version: 0, meetingUrl: URL1, date: "2026-10-10", time: "10:00" }), 422);
	await rejects(processRequest(deps, admin, id, "reschedule", { version: 0, date: "2026-10-23", time: "10:00" }), 422); // no link
	const p1 = await processRequest(deps, admin, id, "reschedule", { version: 0, meetingUrl: URL1, date: "2026-10-23", time: "10:00" });
	const p2 = await processRequest(deps, admin, id, "reschedule", { version: 1, meetingUrl: URL1, date: "2026-10-24", time: "10:00" });
	assert.equal(p2.request.status, "reschedule_requested");
	assert.notEqual(+p1.request.proposedStart, +p2.request.proposedStart);
	// admin can still approve the proposal (defaults to the proposed time)
	const ok = await processRequest(deps, admin, id, "approve", { version: 2, meetingUrl: URL1 });
	assert.equal(ok.request.confirmedStart.toISOString(), "2026-10-24T14:00:00.000Z");
});

test("admin list: counts, status filter, search, pagination; private data stays admin-side", async () => {
	const { deps } = setup();
	const names = ["Ann", "Bob", "Cy", "Di", "Ed", "Flo", "Gus"];
	for (let i = 0; i < names.length; i++) await submitRequest(deps, good({ name: `${names[i]} Tester`, email: `${names[i].toLowerCase()}@example.com`, organization: i === 2 ? "Rocket Labs" : "", time: "10:00", date: `2026-10-${20 + i}` }));
	const all = await listRequests(deps, admin, {});
	assert.equal(all.total, 7);
	assert.deepEqual(all.counts, { pending: 7, approved: 0, rejected: 0, reschedule_requested: 0, cancelled: 0 });
	const first = all.requests[0];
	await processRequest(deps, admin, first.id, "reject", { version: 0 });
	assert.equal((await listRequests(deps, admin, { status: "rejected" })).total, 1);
	assert.equal((await listRequests(deps, admin, { status: "bogus" })).total, 7, "unknown status ignored");
	assert.equal((await listRequests(deps, admin, { q: "rocket" })).total, 1);
	assert.equal((await listRequests(deps, admin, { q: "CY@EXAMPLE" })).total, 1);
	assert.equal((await listRequests(deps, admin, { q: "%" })).total, 0, "wildcards are literal");
	const page2 = await listRequests(deps, admin, { page: 2, pageSize: 5 });
	assert.equal(page2.requests.length, 2);
	assert.equal(page2.pages, 2);
	const c = (await listRequests(deps, admin, {})).counts;
	assert.deepEqual([c.pending, c.rejected], [6, 1]);
	assert.ok(!("manage_token_hash" in all.requests[0]) && !JSON.stringify(all).includes("manage_token"));
});

test("publicView never exposes contact details or notes", () => {
	const v = publicView({ reference: "MTG-AAAAAAAA", status: "pending", name: "Ada", purpose: "other", requested_at: NOW, time_zone: "UTC", admin_notes: "secret", email: "a@b.c", phone: "1", manage_token_hash: "h", id: "x" });
	assert.ok(!JSON.stringify(v).match(/secret|a@b\.c|manage_token|"id"/));
});
