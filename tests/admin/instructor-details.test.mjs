// Admin > Instructors > one instructor: every figure must come from THAT instructor's own records.
// In-memory repo only (it filters by instructor id exactly as the SQL does); no database is touched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildInstructorDetails, loadInstructorDetails, effectiveSession, actualSeconds, DetailsError } from "../../lib/admin/instructorDetails.js";
import { NA, formatDate, formatTimeRange, formatMinutes, formatHours, formatPercent, orNA } from "../../lib/admin/formatDetails.js";
import { ANON_DOMAIN } from "../../lib/admin/anonymized.js";
import { WINDOW } from "../../lib/live-sessions/service.js";

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // an instructor with nothing at all
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const S4 = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-30T12:00:00Z");
const at = (d, h, m = 0) => new Date(Date.UTC(2026, 9, d, h, m)).toISOString();

let n = 0;
const sess = (instructor, o) => ({ id: `s-${++n}`, instructor_id: instructor, title: `Class ${n}`, subject: "Maths", course_id: null, time_zone: "Asia/Kolkata", session_type: "group", capacity: 30, started_at: null, ended_at: null, cancelled_at: null, ...o });

function world() {
	const users = [
		{ id: A, first_name: "Ann", last_name: "Alpha", email: "ann@example.com", role: "instructor", status: true, created_at: "2026-01-05T00:00:00Z", phone: "+1 555 0100", instructor_subject: "Maths", bio: "Ann bio" },
		{ id: B, first_name: "Ben", last_name: "Beta", email: "ben@example.com", role: "instructor", status: false, created_at: "2026-02-10T00:00:00Z", phone: null, instructor_subject: null, instructor_description: null, bio: null },
		{ id: C, first_name: "Cy", last_name: "Empty", email: "cy@example.com", role: "instructor", status: true, created_at: "2026-03-01T00:00:00Z" },
		{ id: S1, first_name: "Stu", last_name: "One", email: "s1@example.com", role: "student" },
		{ id: S2, first_name: "Stu", last_name: "Two", email: "s2@example.com", role: "student" },
		{ id: S3, first_name: "Stu", last_name: "Three", email: "s3@example.com", role: "student" },
		{ id: S4, first_name: "Gone", last_name: "Student", email: `anonymized-${S4}@${ANON_DOMAIN}`, role: "student" },
	];
	const courses = [
		{ id: "c-a1", userId: A, title: "Algebra", approved: true, created_at: "2026-01-10T00:00:00Z", category: "Maths" },
		{ id: "c-a2", userId: A, title: "Geometry", approved: false, created_at: "2026-02-10T00:00:00Z", category: null },
		{ id: "c-b1", userId: B, title: "Biology", approved: true, created_at: "2026-02-20T00:00:00Z", category: "Science" },
	];
	const sessions = [
		// ---- Instructor A
		sess(A, { id: "a-done-1", title: "Algebra 1", course_id: "c-a1", status: "completed", start_at: at(10, 4), end_at: at(10, 5), started_at: at(10, 4, 2), ended_at: at(10, 5, 2) }), // 60 min actual
		sess(A, { id: "a-done-2", title: "Algebra 2", course_id: "c-a1", status: "completed", start_at: at(12, 4), end_at: at(12, 5), started_at: at(12, 4, 5), ended_at: at(12, 4, 50) }), // 45 min actual
		sess(A, { id: "a-norecord", title: "No end recorded", status: "completed", start_at: at(14, 4), end_at: at(14, 5), started_at: at(14, 4, 1), ended_at: null }), // held, duration unknown
		sess(A, { id: "a-cancel", title: "Cancelled one", status: "cancelled", start_at: at(16, 4), end_at: at(16, 5), cancelled_at: at(15, 1) }),
		sess(A, { id: "a-up", title: "Next week", status: "scheduled", start_at: at(31, 4), end_at: at(31, 5) }),
		sess(A, { id: "a-nothold", title: "Nobody started", status: "completed", start_at: at(18, 4), end_at: at(18, 5) }), // completed row, never started
		sess(A, { id: "a-stale-sched", title: "Stale scheduled", status: "scheduled", start_at: at(20, 4), end_at: at(20, 5) }), // past due, not yet settled by the service
		sess(A, { id: "a-stale-live", title: "Stale live", status: "live", start_at: at(22, 4), end_at: at(22, 5), started_at: at(22, 4, 3) }), // past due: settles to completed, ended at the scheduled end
		sess(A, { id: "a-live", title: "In progress", status: "live", start_at: at(30, 11), end_at: at(30, 13), started_at: at(30, 11, 1) }),
		// ---- Instructor B
		sess(B, { id: "b-done", title: "Cells", course_id: "c-b1", status: "completed", start_at: at(11, 6), end_at: at(11, 8), started_at: at(11, 6), ended_at: at(11, 8) }), // 120 min
		sess(B, { id: "b-up", title: "Genetics", status: "scheduled", start_at: at(29 + 5, 6), end_at: at(29 + 5, 7) }),
	];
	const seats = [
		// A-done-1: 3 seats (S1,S2,S3) / A-done-2: 2 seats (S1,S4) / others
		...[S1, S2, S3].map((u) => ({ class_id: "a-done-1", participant_key: `u:${u}`, user_id: u })),
		...[S1, S4].map((u) => ({ class_id: "a-done-2", participant_key: `u:${u}`, user_id: u })),
		{ class_id: "a-up", participant_key: `u:${S2}`, user_id: S2 },
		{ class_id: "b-done", participant_key: `u:${S1}`, user_id: S1 }, // S1 also studies with B
		{ class_id: "b-done", participant_key: `u:${S2}`, user_id: S2 },
	];
	const att = (cls, u, status = "present") => ({ class_id: cls, participant_key: `u:${u}`, display_name: `name-${u.slice(0, 2)}`, status, total_seconds: 100 });
	const attendance = [
		att("a-done-1", S1), att("a-done-1", S2, "late"), att("a-done-1", S3, "absent"), // 2 of 3 attended
		att("a-done-2", S1), att("a-done-2", S4), // 2 of 2
		att("b-done", S1), att("b-done", S2, "excused"), // B: only S1 attended
	];
	// Paid course enrolments (a different thing from attendance): S3 is enrolled in A's course but never attended a class.
	const enrolments = [
		{ courseId: "c-a1", userId: S1, status: "paid" }, { courseId: "c-a1", userId: S3, status: "paid" }, { courseId: "c-a1", userId: S2, status: "pending" },
		{ courseId: "c-b1", userId: S2, status: "paid" },
	];
	return { users, courses, sessions, seats, attendance, enrolments };
}

// Mirrors lib/admin/instructorDetailsRepo.js: every query is keyed by the selected instructor.
function memoryRepo(db = world()) {
	const calls = [];
	return {
		calls,
		async getInstructor(id) { calls.push(["getInstructor", id]); const u = db.users.find((x) => x.id === id && x.role === "instructor"); return u ? { ...u } : null; },
		async getProfile(id) { return id === B ? { subjects: "Biology, Chemistry" } : null; },
		async getApplicationPhone(id) { return id === B ? { phone: "+44 7000 000000" } : null; },
		async listSessions(id) { calls.push(["listSessions", id]); return db.sessions.filter((s) => s.instructor_id === id).map((s) => ({ ...s })); },
		async listSeats(ids) { return db.seats.filter((x) => ids.includes(x.class_id)); },
		async listAttendance(ids) { return db.attendance.filter((x) => ids.includes(x.class_id)); },
		async listCourses(id) { calls.push(["listCourses", id]); return db.courses.filter((c) => c.userId === id); },
		async courseTitles(ids) { return new Map(db.courses.filter((c) => ids.includes(c.id)).map((c) => [c.id, c.title])); },
		async enrolmentCounts(ids) { const m = new Map(); for (const e of db.enrolments) if (ids.includes(e.courseId) && e.status === "paid") m.set(e.courseId, (m.get(e.courseId) || 0) + 1); return m; },
		async studentUsers(ids) { return new Map(db.users.filter((u) => ids.includes(u.id)).map((u) => [u.id, { ...u }])); },
	};
}
const detailsFor = (id, repo = memoryRepo()) => loadInstructorDetails(repo, id, NOW);

// ---------------------------------------------------------------- isolation
test("instructor A sees only A's records; instructor B only B's", async () => {
	const a = await detailsFor(A);
	const b = await detailsFor(B);
	assert.equal(a.profile.id, A);
	assert.equal(b.profile.id, B);
	assert.ok(a.sessions.every((s) => ["a-"].some((p) => s.id.startsWith(p))), "A has no B sessions");
	assert.ok(b.sessions.every((s) => s.id.startsWith("b-")), "B has no A sessions");
	assert.deepEqual(a.courses.map((c) => c.title).sort(), ["Algebra", "Geometry"]);
	assert.deepEqual(b.courses.map((c) => c.title), ["Biology"]);
	assert.equal(a.sessions.length, 9);
	assert.equal(b.sessions.length, 2);
	assert.ok(!JSON.stringify(a).includes("Cells") && !JSON.stringify(b).includes("Algebra 1"));
});

test("every repository read is keyed by the selected instructor's id", async () => {
	const repo = memoryRepo();
	await detailsFor(B, repo);
	assert.ok(repo.calls.length >= 3);
	assert.ok(repo.calls.every(([, id]) => id === B));
});

test("an instructor with no sessions, courses or students gets empty lists and zero/N/A figures", async () => {
	const c = await detailsFor(C);
	assert.deepEqual([c.sessions, c.courses, c.students], [[], [], []]);
	assert.equal(c.stats.completedSessions, 0);
	assert.equal(c.stats.uniqueStudents, 0);
	assert.equal(c.stats.teachingHours, 0);
	assert.equal(c.stats.averageAttendance, null);
	assert.equal(c.stats.lastConductedAt, null);
	assert.equal(c.profile.phone, null);
	assert.equal(c.profile.subject, null);
});

test("rows that do not belong to this instructor's sessions are ignored even if the repo returns them", () => {
	const db = world();
	const base = { user: db.users[0], profile: null, application: null, sessions: db.sessions.filter((s) => s.instructor_id === A), seats: db.seats, attendance: db.attendance, courses: [], enrolmentCounts: new Map(), courseTitles: new Map(), studentUsers: new Map(db.users.map((u) => [u.id, u])), now: NOW };
	const withStray = buildInstructorDetails(base); // seats/attendance include B's rows
	const clean = buildInstructorDetails({ ...base, seats: db.seats.filter((s) => s.class_id.startsWith("a-")), attendance: db.attendance.filter((s) => s.class_id.startsWith("a-")) });
	assert.deepEqual(withStray.stats, clean.stats);
});

// ---------------------------------------------------------------- statuses
test("completed, upcoming, live, cancelled and never-held are separated, and counted once each", async () => {
	const { stats, sessions } = await detailsFor(A);
	assert.equal(stats.completedSessions, 4); // done-1, done-2, no-end-recorded, stale-live (settled)
	assert.equal(stats.upcomingSessions, 1);
	assert.equal(stats.cancelledSessions, 1);
	assert.equal(stats.liveSessions, 1);
	assert.equal(stats.notHeldSessions, 2); // never started + stale scheduled
	assert.equal(stats.completedSessions + stats.upcomingSessions + stats.cancelledSessions + stats.liveSessions + stats.notHeldSessions, sessions.length);
	const by = Object.fromEntries(sessions.map((s) => [s.id, s.status]));
	assert.equal(by["a-cancel"], "cancelled");
	assert.equal(by["a-up"], "upcoming");
	assert.equal(by["a-nothold"], "not_held");
	assert.equal(by["a-stale-sched"], "not_held");
	assert.equal(by["a-stale-live"], "completed");
	assert.equal(by["a-live"], "live");
});

test("cancelled and upcoming sessions never count as completed; a 'completed' row nobody started is not taught", () => {
	assert.equal(effectiveSession({ status: "cancelled", end_at: at(1, 1) }, NOW).status, "cancelled");
	assert.equal(effectiveSession({ status: "scheduled", end_at: at(31, 5) }, NOW).status, "upcoming");
	assert.equal(effectiveSession({ status: "completed", started_at: null, end_at: at(1, 1) }, NOW).status, "not_held");
	assert.equal(effectiveSession({ status: "completed", started_at: at(1, 1), ended_at: at(1, 2), end_at: at(1, 2) }, NOW).status, "completed");
	// inside the grace window a scheduled session that has just ended is still upcoming/live, not yet settled
	const justEnded = new Date(NOW.getTime() - WINDOW.graceMs + 60000).toISOString();
	assert.equal(effectiveSession({ status: "scheduled", end_at: justEnded }, NOW).status, "upcoming");
	assert.equal(effectiveSession({ status: "live", end_at: justEnded, started_at: justEnded }, NOW).status, "live");
});

test("one session is one row however many students attended it", async () => {
	const { sessions } = await detailsFor(A);
	assert.equal(new Set(sessions.map((s) => s.id)).size, sessions.length);
	const done1 = sessions.find((s) => s.id === "a-done-1");
	assert.equal(done1.registered, 3);
	assert.equal(done1.attended, 2); // present + late; the absent seat holder is not counted
	assert.equal(sessions.filter((s) => s.id === "a-done-1").length, 1);
});

// ---------------------------------------------------------------- hours
test("teaching hours = recorded start to recorded end of held classes, never the scheduled length", async () => {
	const { stats, sessions } = await detailsFor(A);
	// 60 min + 45 min recorded + the settled stale-live class (4:03 -> scheduled end 5:00 = 57 min); the no-end class is left out
	assert.equal(sessions.find((s) => s.id === "a-done-1").actualMinutes, 60);
	assert.equal(sessions.find((s) => s.id === "a-done-2").actualMinutes, 45);
	assert.equal(sessions.find((s) => s.id === "a-done-2").scheduledMinutes, 60);
	assert.equal(sessions.find((s) => s.id === "a-stale-live").actualMinutes, 57);
	assert.equal(sessions.find((s) => s.id === "a-norecord").actualMinutes, null);
	assert.equal(stats.teachingHours, Math.round(((60 + 45 + 57) / 60) * 100) / 100);
	assert.equal(stats.sessionsWithRecordedDuration, 3);
	assert.equal(stats.heldSessionsWithoutRecordedDuration, 1);
	// not-held / cancelled / upcoming never contribute hours
	for (const id of ["a-cancel", "a-up", "a-nothold", "a-stale-sched", "a-live"]) assert.equal(sessions.find((s) => s.id === id).actualMinutes, null, id);
});

test("hours are N/A when classes were held but none has a recorded duration; 0 when none was held", () => {
	const only = sess(A, { status: "completed", start_at: at(1, 4), end_at: at(1, 5), started_at: at(1, 4), ended_at: null });
	const r = buildInstructorDetails({ user: world().users[0], sessions: [only], seats: [], attendance: [], courses: [], enrolmentCounts: new Map(), courseTitles: new Map(), studentUsers: new Map(), now: NOW });
	assert.equal(r.stats.teachingHours, null);
	assert.equal(actualSeconds({ status: "completed", startedAt: at(1, 5), endedAt: at(1, 4) }), null); // end before start is not trusted
	assert.equal(actualSeconds({ status: "cancelled", startedAt: null, endedAt: null }), null);
});

// ---------------------------------------------------------------- students
test("unique students: each student counted once per instructor, not once per class", async () => {
	const a = await detailsFor(A);
	// S1 attended two of A's classes, S2 one (late counts), S4 one, S3 was absent -> S1, S2, S4
	assert.equal(a.stats.uniqueStudents, 3);
	// most classes first; ties by name ("Anonymized student" sorts before "Stu Two")
	assert.deepEqual(a.students.map((s) => [s.key, s.sessionsAttended]), [[`u:${S1}`, 2], [`u:${S4}`, 1], [`u:${S2}`, 1]]);
	const s1 = a.students.find((s) => s.key === `u:${S1}`);
	assert.equal(s1.name, "Stu One");
	assert.equal(s1.email, "s1@example.com");
});

test("students are per instructor: S1 attending both A and B is one student for each, and excused/absent do not count", async () => {
	const b = await detailsFor(B);
	assert.equal(b.stats.uniqueStudents, 1);
	assert.deepEqual(b.students.map((s) => s.key), [`u:${S1}`]);
});

test("course enrolments are never treated as live-class attendance", async () => {
	const a = await detailsFor(A);
	// S3 is a paid student of A's course but never joined a class; S1 is enrolled AND attended
	assert.ok(!a.students.some((s) => s.key === `u:${S3}`));
	assert.equal(a.courses.find((c) => c.id === "c-a1").enrolments, 2); // paid only; S2's pending enrolment is excluded
	assert.equal(a.courses.find((c) => c.id === "c-a2").enrolments, 0);
	assert.equal(a.stats.uniqueStudents, 3);
});

test("an anonymized student shows no name or email", async () => {
	const a = await detailsFor(A);
	const gone = a.students.find((s) => s.key === `u:${S4}`);
	assert.equal(gone.name, "Anonymized student");
	assert.equal(gone.email, null);
});

test("average attendance uses booked seat holders of completed classes only", async () => {
	const a = await detailsFor(A);
	// done-1: 2 of 3 seated attended; done-2: 2 of 2 -> (0.667 + 1) / 2
	assert.equal(a.stats.attendanceSessionsCounted, 2);
	assert.equal(a.stats.averageAttendance, Math.round(((2 / 3 + 1) / 2) * 1000) / 1000);
	const b = await detailsFor(B);
	assert.equal(b.stats.averageAttendance, 0.5); // 1 of 2
	// no completed class with booked students => N/A, not 0%
	assert.equal((await detailsFor(C)).stats.averageAttendance, null);
});

// ---------------------------------------------------------------- profile, courses, last class
test("last conducted class is the latest HELD class, not a cancelled or upcoming one", async () => {
	const a = await detailsFor(A);
	assert.equal(a.stats.lastConductedAt, at(22, 4, 3)); // the settled stale-live class started last
});

test("profile and courses: fallbacks come from the same user's own profile/application; empties stay null", async () => {
	const a = await detailsFor(A);
	assert.deepEqual([a.profile.phone, a.profile.subject, a.profile.about], ["+1 555 0100", "Maths", "Ann bio"]);
	assert.equal(a.profile.registeredAt, "2026-01-05T00:00:00.000Z");
	const b = await detailsFor(B);
	assert.deepEqual([b.profile.phone, b.profile.subject, b.profile.about], ["+44 7000 000000", "Biology, Chemistry", null]);
	assert.equal(b.profile.status, false);
	assert.deepEqual(a.courses.map((c) => [c.title, c.category, c.status]), [["Geometry", null, "pending"], ["Algebra", "Maths", "approved"]]);
});

test("an anonymized instructor does not resurface retained application details", () => {
	const u = { ...world().users[1], email: `anonymized-x@${ANON_DOMAIN}`, phone: null, instructor_subject: null };
	const r = buildInstructorDetails({ user: u, profile: { subjects: "Biology" }, application: { phone: "+44 1" }, sessions: [], seats: [], attendance: [], courses: [], enrolmentCounts: new Map(), courseTitles: new Map(), studentUsers: new Map(), now: NOW });
	assert.deepEqual([r.profile.phone, r.profile.subject, r.profile.anonymized], [null, null, true]);
});

test("no secrets or meeting links are in the payload", async () => {
	const json = JSON.stringify(await detailsFor(A));
	for (const bad of ["password", "reset_password", "meeting_url", "room_name", "token", "$2b$"]) assert.ok(!json.includes(bad), bad);
});

// ---------------------------------------------------------------- validation and permissions
test("the id is validated and must belong to an instructor", async () => {
	const repo = memoryRepo();
	await assert.rejects(loadInstructorDetails(repo, "not-a-uuid", NOW), (e) => e instanceof DetailsError && e.status === 422);
	await assert.rejects(loadInstructorDetails(repo, "1 OR 1=1", NOW), (e) => e.status === 422);
	await assert.rejects(loadInstructorDetails(repo, "99999999-9999-4999-8999-999999999999", NOW), (e) => e.status === 404);
	await assert.rejects(loadInstructorDetails(repo, S1, NOW), (e) => e.status === 404, "a student id is not an instructor");
	assert.equal(repo.calls.filter(([n]) => n === "listSessions").length, 0, "no data query ran for a rejected id");
});

test("the API is admin-only (checked before any query) and read-only", () => {
	const api = read("pages/api/admin/instructors/[id].js");
	assert.match(api, /requireRole\(req, res, \["admin"\]\)/);
	assert.ok(api.indexOf("requireRole") < api.indexOf("loadInstructorDetails("));
	assert.match(api, /req\.method !== "GET"/);
	assert.match(api, /req\.query\.id/);
	const rr = read("lib/auth/requireRole.js");
	assert.match(rr, /res\.status\(401\)/);
	assert.match(rr, /res\.status\(403\)/);
});

test("the repo never selects secrets, and every query is keyed by the instructor/session ids", () => {
	const repo = read("lib/admin/instructorDetailsRepo.js");
	assert.doesNotMatch(repo, /"(password|reset_password_token|reset_password_at|meeting_url|room_name|description)"/); // no secret or private column is ever selected
	assert.match(repo, /where: \{ instructor_id: instructorId \}/);
	assert.match(repo, /where: \{ userId: instructorId \}/);
	assert.match(repo, /where: \{ class_id: classIds \}/);
	assert.match(repo, /role: "instructor"/);
	assert.match(repo, /status: "paid"/);
});

test("the page is wired: details route, Back to Instructors, filters, and no overall-statistics API", () => {
	const page = read("pages/admin/instructor/[id].js");
	assert.match(page, /Back to Instructors/);
	assert.match(page, /\/api\/admin\/instructors\/\$\{id\}/);
	for (const l of ["All sessions", "Completed", "Upcoming", "Cancelled"]) assert.ok(page.includes(l), l);
	assert.doesNotMatch(read("pages/admin/instructor/index.js"), /StatTile|ss-statgrid|ss-stat-mini/, "the list page has no summary cards");
});

// ---------------------------------------------------------------- formatting
test("formatting: time-zone aware, N/A for missing values", () => {
	assert.equal(formatTimeRange("2026-10-10T04:00:00Z", "2026-10-10T05:00:00Z", "Asia/Kolkata"), "09:30 – 10:30");
	assert.equal(formatTimeRange("2026-10-10T04:00:00Z", "2026-10-10T05:00:00Z", "UTC"), "04:00 – 05:00");
	assert.equal(formatDate("2026-10-10T20:00:00Z", "Asia/Kolkata"), "11 Oct 2026"); // already the next day in India
	assert.equal(formatDate("nope"), NA);
	assert.equal(formatTimeRange(null, null), NA);
	assert.equal(formatMinutes(105), "1 h 45 min");
	assert.equal(formatMinutes(60), "1 h");
	assert.equal(formatMinutes(null), NA);
	assert.equal(formatHours(2.7), "2.7 h");
	assert.equal(formatHours(3), "3 h");
	assert.equal(formatHours(null), NA);
	assert.equal(formatPercent(0.667), "67%");
	assert.equal(formatPercent(null), NA);
	assert.equal(orNA("  "), NA);
	assert.equal(formatDate("2026-10-10T04:00:00Z", "Not/AZone"), "10 Oct 2026"); // bad zone falls back to UTC
});
