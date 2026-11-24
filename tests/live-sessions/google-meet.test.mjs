import test from "node:test";
import assert from "node:assert/strict";
import * as ls from "../../lib/live-sessions/service.js";
import { createSessionRepo } from "./memoryRepo.mjs";

const actor = (userId, role = "student", name = userId) => ({ userId, role, name });
const NOW = new Date("2026-10-20T10:00:00Z");
const START = new Date("2026-10-21T12:00:00Z");
const teacher = actor("t1", "instructor");
const teacher2 = actor("t2", "instructor");
const admin = actor("a1", "admin");
const MEET = "https://meet.google.com/abc-defg-hij";

function setup() {
	const repo = createSessionRepo();
	repo._db.courses.push({ id: "c1", slug: "math", title: "Math", userId: "t1" }, { id: "c2", slug: "art", title: "Art", userId: "t2" });
	for (const u of ["s1", "s2"]) repo._db.enrolments.push({ userId: u, courseId: "c1", status: "paid" });
	repo._db.enrolments.push({ userId: "s9", courseId: "c2", status: "paid" });
	return repo;
}
const input = (extra = {}) => ({ title: "Algebra", courseId: "c1", sessionType: "one_to_one", studentIds: ["s1"], date: "2026-10-21", time: "12:00", timeZone: "UTC", durationMin: 60, ...extra });
const create = (repo, extra, who = teacher) => ls.createSession(repo, who, input(extra), NOW);
const early = new Date(START.getTime() - 5 * 60000);
const row = (repo, id) => repo._db.sessions.find((s) => s.id === id);

test("normalizeMeetUrl accepts only https meet.google.com meeting codes", () => {
	assert.equal(ls.normalizeMeetUrl(MEET), MEET);
	assert.equal(ls.normalizeMeetUrl(`  ${MEET}?authuser=1#x `), MEET, "query and fragment dropped");
	assert.equal(ls.normalizeMeetUrl("https://MEET.google.com/ABC-DEFG-HIJ"), MEET);
	for (const bad of [
		"http://meet.google.com/abc-defg-hij",
		"javascript:alert(1)",
		"https://meet.google.com.evil.test/abc-defg-hij",
		"https://evil.test/meet.google.com/abc-defg-hij",
		"https://user:pw@meet.google.com/abc-defg-hij",
		"https://meet.google.com:8443/abc-defg-hij",
		"https://meet.google.com/",
		"https://meet.google.com/abc-defg",
		"https://meet.google.com/abc-defg-hij/extra",
		"https://zoom.us/j/123",
		"",
		null,
		undefined,
		42,
		{},
		"https://meet.google.com/" + "a".repeat(300),
	]) assert.equal(ls.normalizeMeetUrl(bad), null, String(bad));
});

test("provider selection: default stays Jitsi, Google Meet needs a valid link", async () => {
	const repo = setup();
	const j = await create(repo, {});
	assert.equal(j.provider, "jitsi");
	assert.equal(row(repo, j.id).provider, "jitsi");
	assert.ok(!row(repo, j.id).meeting_url);
	const explicit = await create(repo, { time: "14:00", provider: "jitsi", meetingUrl: "https://evil.test" });
	assert.equal(row(repo, explicit.id).meeting_url, null, "a link sent with Jitsi is ignored");

	const m = await create(repo, { time: "16:00", provider: "google_meet", meetingUrl: MEET });
	assert.equal(m.provider, "google_meet");
	assert.equal(m.meetingUrl, MEET);
	assert.equal(row(repo, m.id).provider, "external", "stored in the existing column, no new enum value");
	assert.match(row(repo, m.id).room_name, /^ss-/, "a room name still exists");

	await assert.rejects(create(repo, { time: "18:00", provider: "google_meet" }), { status: 422, code: "invalid_meeting_url" });
	await assert.rejects(create(repo, { time: "18:00", provider: "google_meet", meetingUrl: "http://meet.google.com/abc-defg-hij" }), { status: 422 });
	await assert.rejects(create(repo, { time: "18:00", provider: "zoom" }), { status: 422 });
});

test("instructor can set, change and clear the link; others cannot", async () => {
	const repo = setup();
	const v = await create(repo, {});
	const set = await ls.setSessionProvider(repo, teacher, v.id, { provider: "google_meet", meetingUrl: MEET }, NOW);
	assert.deepEqual([set.provider, set.meetingUrl], ["google_meet", MEET]);
	await assert.rejects(ls.setSessionProvider(repo, teacher, v.id, { provider: "google_meet", meetingUrl: "https://x.test/a" }, NOW), { status: 422 });
	assert.equal((await ls.getSessionDetail(repo, teacher, v.id, NOW)).meetingUrl, MEET, "a rejected change leaves the old link");

	await assert.rejects(ls.setSessionProvider(repo, teacher2, v.id, { provider: "jitsi" }, NOW), { status: 404 });
	await assert.rejects(ls.setSessionProvider(repo, actor("s1"), v.id, { provider: "jitsi" }, NOW), { status: 403 }, "a student is not a teacher");
	assert.equal(row(repo, v.id).provider, "external", "unauthorised attempts changed nothing");
	assert.equal((await ls.setSessionProvider(repo, admin, v.id, { provider: "google_meet", meetingUrl: MEET }, NOW)).provider, "google_meet", "admin may manage");

	const back = await ls.setSessionProvider(repo, teacher, v.id, { provider: "jitsi" }, NOW);
	assert.deepEqual([back.provider, back.meetingUrl], ["jitsi", null]);
	assert.equal(row(repo, v.id).meeting_url, null);

	await ls.cancelSession(repo, teacher, v.id, NOW);
	await assert.rejects(ls.setSessionProvider(repo, teacher, v.id, { provider: "google_meet", meetingUrl: MEET }, NOW), { status: 409 });
});

test("authorised join: assigned paid student and owning instructor get the link, no room", async () => {
	const repo = setup();
	const v = await create(repo, { provider: "google_meet", meetingUrl: MEET });
	const s = await ls.joinSession(repo, actor("s1"), v.id, { domain: "meet.jit.si" }, early);
	assert.deepEqual([s.provider, s.meetingUrl, s.role], ["google_meet", MEET, "student"]);
	assert.ok(!("roomName" in s) && !("domain" in s));
	assert.equal(repo._db.attendance.length, 1, "student attendance is recorded on join");

	const t = await ls.joinSession(repo, teacher, v.id, {}, new Date(START.getTime() - 20 * 60000));
	assert.deepEqual([t.provider, t.meetingUrl, t.status], ["google_meet", MEET, "live"]);
});

test("unauthorised access never reveals the link", async () => {
	const repo = setup();
	const v = await create(repo, { provider: "google_meet", meetingUrl: MEET });
	const leaks = (x) => JSON.stringify(x).includes("meet.google.com");

	await assert.rejects(ls.joinSession(repo, actor("s2"), v.id, {}, early), { status: 404 }, "enrolled classmate, no seat, private 1:1");
	await assert.rejects(ls.joinSession(repo, actor("s9"), v.id, {}, early), { status: 404 }, "paid in another course");
	await assert.rejects(ls.joinSession(repo, teacher2, v.id, {}, early), { status: 404 }, "another instructor");
	await assert.rejects(ls.joinSession(repo, null, v.id, {}, early), { status: 401 });

	// Paid-enrolment restriction: a seat holder whose enrolment lapsed
	const enrolment = repo._db.enrolments.find((e) => e.userId === "s1");
	enrolment.status = "refunded";
	await assert.rejects(ls.joinSession(repo, actor("s1"), v.id, {}, early), { status: 403, code: "not_enrolled" });
	enrolment.status = "paid";

	// Window still applies
	await assert.rejects(ls.joinSession(repo, actor("s1"), v.id, {}, NOW), { status: 409, code: "too_early" });
	await assert.rejects(ls.joinSession(repo, actor("s1"), v.id, {}, new Date(START.getTime() + 3 * 3600000)), { status: 409 });

	// Views: only the owner sees the link
	assert.equal((await ls.getSessionDetail(repo, teacher, v.id, NOW)).meetingUrl, MEET);
	const mine = await ls.getSessionDetail(repo, actor("s1"), v.id, NOW);
	assert.equal(mine.provider, "google_meet");
	assert.ok(!leaks(mine), "student detail has no link");
	assert.ok(!leaks(await ls.listSessions(repo, actor("s1"), {}, NOW)), "student list has no link");
	await assert.rejects(ls.getSessionDetail(repo, actor("s2"), v.id, NOW), { status: 404 });
	await assert.rejects(ls.getSessionDetail(repo, teacher2, v.id, NOW), { status: 404 });
	assert.ok(!leaks(await ls.listSessions(repo, teacher2, { scope: "teaching" }, NOW)), "another instructor's list has no link");

	const c = await create(repo, { time: "16:00", provider: "google_meet", meetingUrl: MEET });
	await ls.cancelSession(repo, teacher, c.id, NOW);
	await assert.rejects(ls.joinSession(repo, actor("s1"), c.id, {}, new Date(START.getTime() + 3.9 * 3600000)), { status: 409, code: "cancelled" });
});

test("an open group session needs a seat before the link is released", async () => {
	const repo = setup();
	const v = await ls.createSession(repo, teacher, input({ sessionType: "group", capacity: 5, studentIds: [], provider: "google_meet", meetingUrl: MEET }), NOW);
	await assert.rejects(ls.joinSession(repo, actor("s1"), v.id, {}, early), { status: 403 }, "no seat yet");
	await ls.takeSeat(repo, actor("s1"), v.id, NOW);
	assert.equal((await ls.joinSession(repo, actor("s1"), v.id, {}, early)).meetingUrl, MEET);
});

test("Jitsi regression: join still returns the room and domain, with no Meet fields", async () => {
	const repo = setup();
	const v = await create(repo, {});
	const s = await ls.joinSession(repo, actor("s1"), v.id, { domain: "meet.example.test" }, early);
	assert.match(s.roomName, /^ss-[0-9a-f]{32}$/);
	assert.equal(s.domain, "meet.example.test");
	assert.ok(!("meetingUrl" in s) && !("provider" in s));
	assert.equal((await ls.getSessionDetail(repo, teacher, v.id, NOW)).meetingUrl, null);

	// An "external" row whose link is not a Google Meet link is still treated as Jitsi
	Object.assign(row(repo, v.id), { provider: "external", meeting_url: "https://zoom.us/j/1" });
	assert.match((await ls.joinSession(repo, actor("s1"), v.id, {}, early)).roomName, /^ss-/);
});
