// Concurrency, private status links and e-mail configuration for the meeting requests.
import test from "node:test";
import assert from "node:assert/strict";
import { submitRequest, processRequest, visitorView, visitorAct, deriveToken, MeetingError } from "../../lib/meetings/service.js";
import { emailConfigStatus, sendMail, verifyEmailTransport, sendTestEmail, scrub } from "../../lib/meetings/mailer.js";
import { createMeetingRepo } from "./memoryRepo.mjs";

const NOW = new Date("2026-10-14T12:00:00Z");
const adminA = { userId: "admin-a", role: "admin" };
const adminB = { userId: "admin-b", role: "admin" };
const URL1 = "https://meet.example.com/room";
const SECRET = "unit-test-link-secret";

function setup({ repoOpts, secret = SECRET, ...over } = {}) {
	const repo = createMeetingRepo(repoOpts);
	const sent = [];
	const state = { mail: async (m) => (sent.push(m), { ok: true }) };
	const deps = { repo, baseUrl: "https://app.test", adminEmail: "admin@sharpstudy.test", defaultMeetingUrl: "", linkSecret: secret, now: () => NOW, mailer: (m) => state.mail(m), ...over };
	return { repo, sent, state, deps };
}
let seq = 0;
const good = (extra = {}) => ({ name: "Ada Lovelace", email: `ada${++seq}@example.com`, phone: "+1 416 555 0100", purpose: "product_demo", date: "2026-10-21", time: "10:00", timeZone: "UTC", ...extra });
const ok = (promise) => promise.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
const linkOf = (mail) => {
	const m = /href="(https:\/\/app\.test\/schedule-a-call\/status\/\?ref=(MTG-[A-Z0-9]{8})&amp;token=([a-f0-9]{48}))"/.exec(mail.html) || /href="(https:\/\/app\.test\/schedule-a-call\/status\/\?ref=(MTG-[A-Z0-9]{8})&token=([a-f0-9]{48}))"/.exec(mail.html);
	return m ? { url: m[1], ref: m[2], token: m[3] } : null;
};
const overlapping = (rows) => {
	const a = rows.filter((r) => r.status === "approved").sort((x, y) => x.confirmed_start - y.confirmed_start);
	return a.some((r, i) => i > 0 && a[i - 1].confirmed_end > r.confirmed_start);
};

// ============================================================== concurrency

async function manyRequests(deps, repo, count) {
	const ids = [];
	for (let i = 0; i < count; i++) {
		await submitRequest(deps, good({ time: `10:${String(i * 4).padStart(2, "0")}` })); // 10:00, 10:04, ... all overlap each other (30 min)
		ids.push(repo._db.requests.at(-1).id);
	}
	return ids;
}

test("CONTROL: without the scheduling lock the same race double-books (the test can detect the bug)", async () => {
	const { deps, repo } = setup({ repoOpts: { overlapDelayMs: 15, noLock: true } });
	const ids = await manyRequests(deps, repo, 4);
	const results = await Promise.all(ids.map((id, i) => ok(processRequest(deps, i % 2 ? adminA : adminB, id, "approve", { version: 0, meetingUrl: URL1 }))));
	assert.ok(results.filter((r) => r.ok).length > 1, "unlocked approvals race and several succeed");
	assert.equal(overlapping(repo._db.requests), true);
});

test("two admins approving different overlapping requests at the same moment: exactly one wins", async () => {
	const { deps, repo } = setup({ repoOpts: { overlapDelayMs: 15 } });
	const [a, b] = await manyRequests(deps, repo, 2);
	const [r1, r2] = await Promise.all([ok(processRequest(deps, adminA, a, "approve", { version: 0, meetingUrl: URL1 })), ok(processRequest(deps, adminB, b, "approve", { version: 0, meetingUrl: URL1 }))]);
	assert.equal([r1, r2].filter((r) => r.ok).length, 1);
	const loser = [r1, r2].find((r) => !r.ok).e;
	assert.ok(loser instanceof MeetingError && loser.status === 409 && loser.code === "overlap");
	assert.equal(repo._db.requests.filter((r) => r.status === "approved").length, 1);
	assert.equal(repo._db.requests.find((r) => r.id === (r1.ok ? b : a)).status, "pending", "the loser is untouched");
});

test("a burst of simultaneous approvals never produces overlapping meetings", async () => {
	const { deps, repo } = setup({ repoOpts: { overlapDelayMs: 8 } });
	const ids = await manyRequests(deps, repo, 8);
	const results = await Promise.all(ids.map((id, i) => ok(processRequest(deps, i % 2 ? adminA : adminB, id, "approve", { version: 0, meetingUrl: URL1 }))));
	assert.equal(results.filter((r) => r.ok).length, 1, "all 8 overlap, so only one can be approved");
	assert.equal(overlapping(repo._db.requests), false);
	// non-overlapping slots may all be approved concurrently
	const far = [];
	for (let i = 0; i < 4; i++) {
		await submitRequest(deps, good({ date: "2026-10-22", time: `${String(9 + i).padStart(2, "0")}:00` }));
		far.push(repo._db.requests.at(-1).id);
	}
	const res2 = await Promise.all(far.map((id) => ok(processRequest(deps, adminA, id, "approve", { version: 0, meetingUrl: URL1 }))));
	assert.equal(res2.filter((r) => r.ok).length, 4);
	assert.equal(overlapping(repo._db.requests), false);
});

test("a visitor accepting a proposal races an admin approval of the same slot: one wins", async () => {
	const { deps, repo } = setup({ repoOpts: { overlapDelayMs: 15 } });
	const a = await submitRequest(deps, good({ time: "08:00" }));
	const idA = repo._db.requests[0].id;
	await processRequest(deps, adminA, idA, "reschedule", { version: 0, meetingUrl: URL1, date: "2026-10-21", time: "10:10" });
	await submitRequest(deps, good());
	const idB = repo._db.requests[1].id; // requested 10:00 on the 21st -> overlaps 10:10
	const [v, ad] = await Promise.all([ok(visitorAct(deps, a.reference, a.manageToken, "accept")), ok(processRequest(deps, adminB, idB, "approve", { version: 0, meetingUrl: URL1 }))]);
	assert.equal([v, ad].filter((r) => r.ok).length, 1);
	assert.equal(overlapping(repo._db.requests), false);
});

test("failed approvals roll back cleanly and the lock is not left held", async () => {
	const { deps, repo } = setup({ repoOpts: { overlapDelayMs: 5 } });
	const [a, b, c] = await manyRequests(deps, repo, 3);
	await processRequest(deps, adminA, a, "approve", { version: 0, meetingUrl: URL1 });
	for (let i = 0; i < 3; i++) await assert.rejects(processRequest(deps, adminA, b, "approve", { version: 0, meetingUrl: URL1 }), (e) => e.code === "overlap");
	await processRequest(deps, adminA, a, "cancel", { version: 1 });
	const after = await ok(processRequest(deps, adminB, c, "approve", { version: 0, meetingUrl: URL1 }));
	assert.equal(after.ok, true, "later approvals still work");
});

// =========================================================== status links

test("every e-mail the visitor receives carries a working private status link", async () => {
	const { deps, repo, sent } = setup();
	const a = await submitRequest(deps, good());
	const id = repo._db.requests[0].id;
	const received = sent.find((m) => /received/i.test(m.subject));
	const l0 = linkOf(received);
	assert.ok(l0, "received e-mail has the link");
	assert.equal(l0.token, a.manageToken);
	assert.equal(l0.ref, a.reference);

	await processRequest(deps, adminA, id, "reschedule", { version: 0, meetingUrl: URL1, date: "2026-10-23", time: "10:00" });
	const prop = linkOf(sent.at(-1));
	assert.ok(prop && prop.token === a.manageToken, "reschedule e-mail has the link");
	assert.equal((await visitorView(deps, prop.ref, prop.token)).status, "reschedule_requested");

	await processRequest(deps, adminA, id, "approve", { version: 1, meetingUrl: URL1 });
	const appr = linkOf(sent.at(-1));
	assert.ok(appr, "approval e-mail has the link");
	const view = await visitorView(deps, appr.ref, appr.token);
	assert.equal(view.status, "approved");
	assert.equal(view.meetingUrl, URL1);

	await processRequest(deps, adminA, id, "cancel", { version: 2 });
	const canc = linkOf(sent.at(-1));
	assert.ok(canc, "cancellation e-mail has the link");
	assert.equal((await visitorView(deps, canc.ref, canc.token)).status, "cancelled");

	// rejection path on a second request
	await submitRequest(deps, good({ time: "15:00" }));
	const id2 = repo._db.requests[1].id;
	await processRequest(deps, adminA, id2, "reject", { version: 0 });
	const rej = linkOf(sent.at(-1));
	assert.ok(rej, "rejection e-mail has the link");
	const rv = await visitorView(deps, rej.ref, rej.token);
	assert.equal(rv.status, "rejected");
	assert.equal(rv.meetingUrl, null);
	await assert.rejects(visitorAct(deps, rej.ref, rej.token, "cancel"), (e) => e.status === 409);
});

test("the admin Retry action also includes the link", async () => {
	const { deps, repo, sent, state } = setup();
	state.mail = async () => ({ ok: false, error: "smtp down" });
	await submitRequest(deps, good());
	state.mail = async (m) => (sent.push(m), { ok: true });
	await processRequest(deps, adminA, repo._db.requests[0].id, "resend_email");
	assert.ok(linkOf(sent.at(-1)));
});

test("tokens are derived, not stored: the database holds only a hash, and different requests get different tokens", async () => {
	const { deps, repo } = setup();
	const a = await submitRequest(deps, good());
	const b = await submitRequest(deps, good({ time: "11:00" }));
	assert.notEqual(a.manageToken, b.manageToken);
	assert.equal(a.manageToken, deriveToken(SECRET, repo._db.requests[0].id));
	const dump = JSON.stringify([repo._db.requests, repo._db.events]);
	assert.ok(!dump.includes(a.manageToken) && !dump.includes(b.manageToken), "no plaintext token anywhere in stored data");
	assert.match(repo._db.requests[0].manage_token_hash, /^[a-f0-9]{64}$/);
	assert.notEqual(deriveToken("another-secret", repo._db.requests[0].id), a.manageToken, "a different server secret cannot produce the token");
	// token of one request does not open another
	await assert.rejects(visitorView(deps, b.reference, a.manageToken), (e) => e.status === 404);
});

test("tokens and links never appear in logs or stored error text", async () => {
	const { deps, repo, state } = setup();
	const logs = [];
	const orig = console.error;
	console.error = (...a) => logs.push(a.join(" "));
	try {
		state.mail = async (m) => ({ ok: false, error: `could not deliver ${m.html.match(/token=[a-f0-9]+/)?.[0] || ""}`.trim() });
		const a = await submitRequest(deps, good());
		await processRequest(deps, adminA, repo._db.requests[0].id, "reject", { version: 0 });
		const stored = JSON.stringify(repo._db.requests) + JSON.stringify(repo._db.events);
		assert.ok(!stored.includes(a.manageToken));
		assert.ok(logs.length > 0, "failures were logged");
		assert.ok(!logs.join("\n").includes(a.manageToken), "token not in logs");
	} finally {
		console.error = orig;
	}
});

test("without a link secret a random one-time token is used and later e-mails omit the link (no crash)", async () => {
	const { deps, repo, sent } = setup({ secret: "" });
	const a = await submitRequest(deps, good());
	assert.match(a.manageToken, /^[a-f0-9]{48}$/);
	assert.ok(linkOf(sent.find((m) => /received/i.test(m.subject))), "first e-mail still has the link");
	await processRequest(deps, adminA, repo._db.requests[0].id, "reject", { version: 0 });
	assert.equal(linkOf(sent.at(-1)), null);
	assert.equal((await visitorView(deps, a.reference, a.manageToken)).status, "rejected", "the visitor's saved link still works");
});

test("legacy rows (random token, now with a secret configured) keep working but get no derived link", async () => {
	const legacy = setup({ secret: "" });
	const a = await submitRequest(legacy.deps, good());
	const withSecret = { ...legacy.deps, linkSecret: SECRET };
	await processRequest(withSecret, adminA, legacy.repo._db.requests[0].id, "reject", { version: 0 });
	assert.equal(linkOf(legacy.sent.at(-1)), null);
	assert.equal((await visitorView(withSecret, a.reference, a.manageToken)).status, "rejected");
});

// ================================================== e-mail configuration

const FULL = { AWS_SES_USER: "AKIAEXAMPLEUSER12345", AWS_SES_PASSWORD: "super-secret-password-value", MEETING_ADMIN_EMAIL: "boss@sharpstudy.test", JWT_SECRET: "x" };

test("configuration status reports presence only, never values", () => {
	const s = emailConfigStatus(FULL);
	assert.equal(s.ready, true);
	assert.equal(s.adminEmailMasked, "b***@sharpstudy.test");
	const dump = JSON.stringify(s);
	for (const secret of [FULL.AWS_SES_USER, FULL.AWS_SES_PASSWORD, FULL.JWT_SECRET, "boss@"]) assert.ok(!dump.includes(secret), `status must not contain ${secret}`);
	const empty = emailConfigStatus({});
	assert.equal(empty.ready, false);
	assert.deepEqual(empty.missing, ["AWS_SES_USER", "AWS_SES_PASSWORD", "MEETING_ADMIN_EMAIL"]);
	assert.ok(emailConfigStatus({ ...FULL, MEETING_ADMIN_EMAIL: "not-an-email" }).problems.length === 1);
	assert.equal(emailConfigStatus({ ...FULL, MEETING_ADMIN_EMAIL: "not-an-email" }).ready, false);
	assert.ok(emailConfigStatus({ ...FULL, MEETING_DEFAULT_URL: "javascript:x" }).problems.length === 1);
});

test("sendMail: skipped without credentials, ok with them, errors are scrubbed", async () => {
	let calls = 0;
	const good = { sendMail: async () => (calls++, {}) };
	assert.deepEqual(await sendMail({ to: "a@b.co", subject: "s", html: "h" }, { transport: good, env: {} }), { ok: false, skipped: true, error: "e-mail credentials are not configured" });
	assert.equal(calls, 0, "no transport call without credentials");
	assert.deepEqual(await sendMail({ to: "a@b.co", subject: "s", html: "h" }, { transport: good, env: FULL }), { ok: true });
	const bad = { sendMail: async () => { throw new Error(`535 auth failed for ${FULL.AWS_SES_USER} using ${FULL.AWS_SES_PASSWORD}`); } };
	const r = await sendMail({ to: "a@b.co", subject: "s", html: "h" }, { transport: bad, env: FULL });
	assert.equal(r.ok, false);
	assert.ok(!r.error.includes(FULL.AWS_SES_USER) && !r.error.includes(FULL.AWS_SES_PASSWORD));
	assert.match(r.error, /\[hidden\]/);
	assert.equal(scrub(`x ${FULL.AWS_SES_PASSWORD} y`, FULL), "x [hidden] y");
});

test("verify connects but never sends; the test e-mail goes only to the configured admin address, once", async () => {
	const t = { sent: [], verified: 0, verify: async () => void t.verified++, sendMail: async (m) => void t.sent.push(m) };
	assert.equal((await verifyEmailTransport({ transport: t, env: FULL })).ok, true);
	assert.equal(t.verified, 1);
	assert.equal(t.sent.length, 0, "verify sends nothing");
	assert.equal((await verifyEmailTransport({ transport: t, env: {} })).skipped, true);
	assert.equal(t.verified, 1, "no connection attempt without credentials");

	const unconfigured = await sendTestEmail({ transport: t, env: { AWS_SES_USER: "u", AWS_SES_PASSWORD: "p" } });
	assert.equal(unconfigured.ok, false);
	assert.equal(t.sent.length, 0, "nothing sent while MEETING_ADMIN_EMAIL is missing");
	const sent = await sendTestEmail({ transport: t, env: FULL });
	assert.equal(sent.ok, true);
	assert.equal(t.sent.length, 1);
	assert.equal(t.sent[0].to, "boss@sharpstudy.test");
	assert.match(t.sent[0].subject, /test/i);

	const failing = { verify: async () => { throw new Error(`connect ETIMEDOUT ${FULL.AWS_SES_PASSWORD}`); } };
	const v = await verifyEmailTransport({ transport: failing, env: FULL });
	assert.equal(v.ok, false);
	assert.ok(!v.error.includes(FULL.AWS_SES_PASSWORD));
});

test("e-mail failures: the request is saved, state recorded, retry succeeds, credentials never stored", async () => {
	const { deps, repo, state, sent } = setup();
	state.mail = (m) => sendMail(m, { transport: { sendMail: async () => { throw new Error(`535 bad login ${FULL.AWS_SES_PASSWORD}`); } }, env: FULL });
	const out = await submitRequest(deps, good());
	assert.equal(out.status, "pending");
	const row = repo._db.requests[0];
	assert.deepEqual([row.admin_email_status, row.visitor_email_status], ["failed", "failed"]);
	assert.ok(!JSON.stringify(repo._db.requests).includes(FULL.AWS_SES_PASSWORD), "credential never stored");
	state.mail = async (m) => (sent.push(m), { ok: true });
	const r = await processRequest(deps, adminA, row.id, "resend_email");
	assert.deepEqual([r.request.adminEmailStatus, r.request.visitorEmailStatus], ["sent", "sent"]);
});
