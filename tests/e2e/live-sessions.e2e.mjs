// End-to-end test of the live-session API against a RUNNING dev server and its
// real MySQL database (separate instructor / student identities via signed tokens).
//   1. yarn dev
//   2. node tests/e2e/live-sessions.e2e.mjs
// Creates temporary courses, enrolments and sessions owned by existing dev users,
// runs the flow (including real concurrent bookings against MySQL row locks) and
// deletes everything it created. Never prints secrets. localhost only.
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("E2E only runs against localhost");

const db = await mysql.createConnection({
	host: process.env.DB_HOSTNAME,
	port: process.env.DB_PORT,
	user: process.env.DB_USERNAME,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME_DEVELOPMENT,
});
const [users] = await db.query("SELECT id, role, email FROM users WHERE status = 1 OR status IS NULL ORDER BY created_at");
const teachers = users.filter((u) => u.role === "instructor");
const students = users.filter((u) => u.role === "student");
assert.ok(teachers.length >= 2 && students.length >= 4, "need two instructors and four students in the dev DB");
const [teacher, teacher2] = teachers;
const [s1, s2, s3, s4] = students; // s4 never enrols
const token = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "10m" });

let [[cat]] = await db.query("SELECT id FROM categories LIMIT 1");
let tempCat = null;
if (!cat) {
	tempCat = randomUUID();
	await db.query("INSERT INTO categories (id, category, slug, created_at, updated_at) VALUES (?, 'tmp-e2e', 'tmp-e2e', NOW(), NOW())", [tempCat]);
	cat = { id: tempCat };
}
const courseId = randomUUID();
const otherCourse = randomUUID();
const addCourse = (id, owner) =>
	db.query("INSERT INTO courses (id, title, slug, userId, catId, created_at, updated_at) VALUES (?, 'E2E Sessions', ?, ?, ?, NOW(), NOW())", [id, `e2e-ls-${id.slice(0, 8)}`, owner, cat.id]);
await addCourse(courseId, teacher.id);
await addCourse(otherCourse, teacher2.id);
const enrol = (u, c, status = "paid") => db.query("INSERT INTO enrolments (id, userId, courseId, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())", [randomUUID(), u.id, c, status]);
for (const u of [s1, s2, s3]) await enrol(u, courseId);
await enrol(s4, courseId, "unpaid");

let passed = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	passed++;
};
const call = async (method, path, { as, body } = {}) => {
	const headers = { "Content-Type": "application/json" };
	if (as) headers.Authorization = token(as);
	const res = await fetch(`${BASE}/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	let json = null;
	try {
		json = await res.json();
	} catch (e) {
		/* empty */
	}
	return { status: res.status, json };
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const form = (extra = {}) => ({ title: "E2E session", courseId, sessionType: "group", capacity: 2, date: day(3), time: "10:00", timeZone: "UTC", durationMin: 60, ...extra });

try {
	// ---- creation / authorization
	check("anonymous cannot create", (await call("POST", "live-sessions/", { body: form() })).status === 401);
	check("student cannot create", (await call("POST", "live-sessions/", { as: s1, body: form() })).status === 403);
	check("instructor cannot use another instructor's course", (await call("POST", "live-sessions/", { as: teacher2, body: form() })).status === 403);
	const grp = await call("POST", "live-sessions/", { as: teacher, body: form({ instructor_id: teacher2.id }) });
	check("instructor creates a group session", grp.status === 201 && grp.json.session.status === "scheduled");
	const gid = grp.json.session.id;
	const [[row]] = await db.query("SELECT instructor_id, room_name, session_type, capacity FROM lc_classes WHERE id = ?", [gid]);
	check("instructor id comes from the token", row.instructor_id === teacher.id && row.session_type === "group" && row.capacity === 2);
	check("room is random and private", /^ss-[0-9a-f]{32}$/.test(row.room_name) && !JSON.stringify(grp.json).includes(row.room_name));
	check("overlap is refused", (await call("POST", "live-sessions/", { as: teacher, body: form({ time: "10:30" }) })).status === 409);
	// Open one-to-one slots (the earlier self-booking flow) can still exist; new one-to-one sessions need an assigned
	// student. Seed an open slot directly to keep covering the exclusive-booking lock.
	const oto = await call("POST", "live-sessions/", { as: teacher, body: form({ time: "14:00", title: "1:1" }) });
	await db.query("UPDATE lc_classes SET session_type = 'one_to_one', capacity = 1 WHERE id = ?", [oto.json.session.id]);
	check("open one-to-one slot exists", oto.status === 201);
	const oid = oto.json.session.id;

	// ---- visibility and entitlement
	const list1 = await call("GET", "live-sessions/", { as: s1 });
	check("enrolled student sees the group session and the open slot", list1.status === 200 && list1.json.sessions.filter((x) => x.courseId === courseId).length === 2);
	check("unpaid enrolment sees nothing", (await call("GET", "live-sessions/", { as: s4 })).json.sessions.filter((x) => x.courseId === courseId).length === 0);
	check("unpaid enrolment cannot book", (await call("POST", `live-sessions/${gid}/seat/`, { as: s4 })).status === 403);
	check("stranger gets 404 on detail", (await call("GET", `live-sessions/${gid}/`, { as: s4 })).status === 404);

	// ---- concurrent booking against real row locks
	const race = await Promise.all([s1, s2, s3].map((u) => call("POST", `live-sessions/${oid}/seat/`, { as: u })));
	check("exactly one concurrent booking wins the exclusive slot", race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.status === 409).length === 2);
	const [[c1]] = await db.query("SELECT COUNT(*) n FROM lc_enrolments WHERE class_id = ?", [oid]);
	check("one seat row stored", c1.n === 1);
	const winner = [s1, s2, s3][race.findIndex((r) => r.status === 200)];
	const loser = [s1, s2, s3].find((u) => u !== winner);
	check("a booked slot is private", (await call("GET", `live-sessions/${oid}/`, { as: loser })).status === 404);
	check("a booked slot disappears from other students", !(await call("GET", "live-sessions/", { as: loser })).json.sessions.some((s) => s.id === oid));

	const race2 = await Promise.all([s1, s2, s3].map((u) => call("POST", `live-sessions/${gid}/seat/`, { as: u })));
	check("group capacity holds under concurrency", race2.filter((r) => r.status === 200).length === 2);
	const [[c2]] = await db.query("SELECT COUNT(*) n FROM lc_enrolments WHERE class_id = ?", [gid]);
	check("two seat rows stored", c2.n === 2);

	// ---- joining
	const seated = [s1, s2, s3].filter((u, i) => race2[i].status === 200);
	const unseated = [s1, s2, s3].find((u, i) => race2[i].status !== 200);
	check("join is refused before the window opens", (await call("POST", `live-sessions/${gid}/join/`, { as: seated[0] })).status === 409);
	check("anonymous cannot join", (await call("POST", `live-sessions/${gid}/join/`)).status === 401);
	check("unseated student cannot join", (await call("POST", `live-sessions/${gid}/join/`, { as: unseated })).status === 403);
	check("other instructor cannot manage", (await call("POST", `live-sessions/${gid}/`, { as: teacher2, body: { action: "cancel" } })).status === 404);

	// move the session into its window directly, as time would
	await db.query("UPDATE lc_classes SET start_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE), end_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 58 MINUTE) WHERE id = ?", [gid]);
	const tj = await call("POST", `live-sessions/${gid}/join/`, { as: teacher });
	check("instructor starts the session", tj.status === 200 && tj.json.status === "live" && tj.json.roomName === row.room_name);
	const sj = await call("POST", `live-sessions/${gid}/join/`, { as: seated[0] });
	check("seat holder gets the same room", sj.status === 200 && sj.json.roomName === row.room_name);
	await call("POST", `live-sessions/${gid}/join/`, { as: seated[0] });
	const [[att]] = await db.query("SELECT COUNT(*) n FROM lc_attendance WHERE class_id = ?", [gid]);
	check("rejoin does not duplicate attendance", att.n === 1);
	check("student sees only their own attendance", (await call("GET", `live-sessions/${gid}/attendance/`, { as: seated[0] })).json.mine.status === "present");
	check("instructor sees the roster", (await call("GET", `live-sessions/${gid}/attendance/`, { as: teacher })).json.participants.length === 2);
	check("unseated student cannot read attendance", (await call("GET", `live-sessions/${gid}/attendance/`, { as: unseated })).status === 404);

	// ---- live questions bound to this session
	const Q = { text: "Prime?", options: ["4", "7"], correctIndex: 1, durationSec: 60, publish: true };
	const lqCall = (method, path, opts) => call(method, `live-questions/${gid}/${path}`, opts);
	check("student cannot publish", (await lqCall("POST", "questions/", { as: seated[0], body: Q })).status === 403);
	const pub = await lqCall("POST", "questions/", { as: teacher, body: Q });
	check("instructor publishes into the session", pub.status === 201 && pub.json.question.status === "open");
	const qid = pub.json.question.id;
	check("seat holder sees it", (await lqCall("GET", "state/", { as: seated[0] })).json.current.id === qid);
	check("unseated student cannot read it", (await lqCall("GET", "state/", { as: unseated })).status === 404);
	check("course-level class does not show it", (await call("GET", `live-questions/e2e-ls-${courseId.slice(0, 8)}/state/`, { as: teacher })).json.current === null);
	const ans = await lqCall("POST", `questions/${qid}/answer/`, { as: seated[0], body: { optionId: "o2" } });
	check("answer accepted", ans.status === 200 && ans.json.received === true);
	const [[stored]] = await db.query("SELECT COUNT(*) n FROM live_question_responses WHERE live_question_id = ?", [qid]);
	const dupAns = await Promise.all([1, 2, 3].map(() => lqCall("POST", `questions/${qid}/answer/`, { as: seated[0], body: { optionId: "o2" } })));
	const [[stored2]] = await db.query("SELECT COUNT(*) n FROM live_question_responses WHERE live_question_id = ?", [qid]);
	check("retries never duplicate a response", stored.n === 1 && stored2.n === 1 && dupAns.every((r) => r.status === 200));
	const [[lqrow]] = await db.query("SELECT class_id FROM live_questions WHERE id = ?", [qid]);
	check("question row is linked to the session", lqrow.class_id === gid);
	check("reveal works", (await lqCall("POST", `questions/${qid}`, { as: teacher, body: { action: "reveal" } })).status === 200);
	check("student sees the correct answer after reveal", (await lqCall("GET", "state/", { as: seated[0] })).json.current.correctOptionId === "o2");

	// ---- ending
	check("a live session cannot be cancelled", (await call("POST", `live-sessions/${gid}/`, { as: teacher, body: { action: "cancel" } })).status === 409);
	const ended = await call("POST", `live-sessions/${gid}/`, { as: teacher, body: { action: "end" } });
	check("instructor ends the session", ended.status === 200 && ended.json.session.status === "completed");
	check("completed sessions cannot be joined", (await call("POST", `live-sessions/${gid}/join/`, { as: seated[0] })).status === 409);
	check("answers are refused after the session", (await lqCall("POST", `questions/${qid}/answer/`, { as: seated[0], body: { optionId: "o2" } })).status === 409);
	check("results remain readable", (await lqCall("GET", "my-results/", { as: seated[0] })).status === 200);

	// ---- cancel / reschedule on the one-to-one slot
	const rs = await call("POST", `live-sessions/${oid}/`, { as: teacher, body: { action: "reschedule", date: day(5), time: "09:00", timeZone: "UTC", durationMin: 30 } });
	check("reschedule keeps the booking", rs.status === 200 && rs.json.session.seatsTaken === 1);
	const cancelled = await call("POST", `live-sessions/${oid}/`, { as: teacher, body: { action: "cancel" } });
	check("instructor cancels", cancelled.status === 200 && cancelled.json.session.status === "cancelled");
	check("cancelled session cannot be rebooked", (await call("POST", `live-sessions/${oid}/seat/`, { as: loser })).status === 409);

	// ================= assigned students, notifications =================
	const el = await call("GET", `live-sessions/students/?courseId=${courseId}`, { as: teacher });
	check("eligible list is paid students of this course only", el.status === 200 && el.json.students.map((u) => u.id).sort().join() === [s1, s2, s3].map((u) => u.id).sort().join());
	check("search narrows the list", (await call("GET", `live-sessions/students/?courseId=${courseId}&q=zzzz-no-match`, { as: teacher })).json.students.length === 0);
	check("another instructor cannot list my course's students", (await call("GET", `live-sessions/students/?courseId=${courseId}`, { as: teacher2 })).status === 403);
	check("a student cannot list students", (await call("GET", `live-sessions/students/?courseId=${courseId}`, { as: s1 })).status === 403);
	check("one-to-one without a student is refused", (await call("POST", "live-sessions/", { as: teacher, body: form({ sessionType: "one_to_one", date: day(6), time: "18:00" }) })).status === 422);
	check("unpaid student cannot be assigned", (await call("POST", "live-sessions/", { as: teacher, body: form({ date: day(6), time: "18:00", studentIds: [s4.id] }) })).status === 422);
	check("a student of another course cannot be assigned", (await call("POST", "live-sessions/", { as: teacher, body: form({ date: day(6), time: "18:00", studentIds: ["00000000-0000-4000-8000-000000000000"] }) })).status === 422);
	const asg = await call("POST", "live-sessions/", { as: teacher, body: form({ title: "Assigned group", date: day(6), time: "18:00", capacity: 3, studentIds: [s1.id, s2.id] }) });
	check("group with two assigned students", asg.status === 201 && asg.json.session.enrollmentMode === "assigned" && asg.json.session.participants.length === 2);
	check("both students were notified once", asg.json.notified && asg.json.notified.created === 2);
	const aid = asg.json.session.id;
	const n1 = (await call("GET", "notifications/", { as: s1 })).json;
	const note = n1.notifications.find((n) => n.type === "live_session_assigned" && n.link === `/learning/live/${aid}/`);
	check("in-app notification has title, instructor, course and link", !!note && /Assigned group/.test(note.title) && /E2E Sessions/.test(note.body) && /UTC/.test(note.body));
	check("the room name is not in any notification", !JSON.stringify(n1).includes("ss-"));
	check("an unassigned classmate gets no notification for it", !(await call("GET", "notifications/", { as: s3 })).json.notifications.some((n) => n.link === `/learning/live/${aid}/`));
	check("anonymous cannot read notifications", (await call("GET", "notifications/")).status === 401);
	check("an unassigned classmate cannot see the session", (await call("GET", `live-sessions/${aid}/`, { as: s3 })).status === 404 && (await call("GET", "live-sessions/", { as: s3 })).json.sessions.every((x) => x.id !== aid));
	check("an unassigned classmate cannot book it", (await call("POST", `live-sessions/${aid}/seat/`, { as: s3 })).status === 403);
	check("an assigned student sees it", (await call("GET", "live-sessions/", { as: s1 })).json.sessions.some((x) => x.id === aid && x.enrollmentMode === "assigned"));
	check("student cannot be double-booked", (await call("POST", "live-sessions/", { as: teacher, body: form({ date: day(6), time: "18:30", studentIds: [s1.id] }) })).status === 409);
	const mv = { action: "reschedule", date: day(7), time: "09:00", timeZone: "UTC", durationMin: 60 };
	const r1 = await call("POST", `live-sessions/${aid}/`, { as: teacher, body: mv });
	const r2 = await call("POST", `live-sessions/${aid}/`, { as: teacher, body: mv });
	check("reschedule notifies once; a retry does not repeat", r1.status === 200 && r1.json.notified.created === 2 && r2.json.notified.created === 0);
	const [[cnt1]] = await db.query("SELECT COUNT(*) n FROM notifications WHERE ref_id = ? AND type = 'live_session_rescheduled'", [aid]);
	check("exactly two rescheduled rows stored", cnt1.n === 2);
	const cn1 = await call("POST", `live-sessions/${aid}/`, { as: teacher, body: { action: "cancel" } });
	const cn2 = await call("POST", `live-sessions/${aid}/`, { as: teacher, body: { action: "cancel" } });
	check("cancel notifies once; a retry does not repeat", cn1.json.notified.created === 2 && cn2.json.notified.created === 0);
	const [[em]] = await db.query("SELECT COUNT(*) n FROM notifications WHERE ref_id = ? AND email_status = 'sent'", [aid]);
	check("e-mail status is recorded and nothing is claimed sent when e-mail is not configured", em.n === 0 || !!process.env.AWS_SES_USER);
	const [[stillThere]] = await db.query("SELECT status FROM lc_classes WHERE id = ?", [aid]);
	check("the session stays saved regardless of e-mail", stillThere.status === "cancelled");
	check("marking read affects only my notifications", (await call("POST", "notifications/", { as: s1, body: {} })).json.unread === 0 && (await call("GET", "notifications/", { as: s2 })).json.unread > 0);

	// ================= grading regression + images through the API =================
	const one = await call("POST", "live-sessions/", { as: teacher, body: form({ sessionType: "one_to_one", title: "Private", date: day(8), time: "10:00", studentIds: [s1.id] }) });
	check("one-to-one with one assigned student", one.status === 201 && one.json.session.capacity === 1);
	const oid2 = one.json.session.id;
	await db.query("UPDATE lc_classes SET start_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE), end_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 58 MINUTE) WHERE id = ?", [oid2]);
	check("another student cannot join the private session", (await call("POST", `live-sessions/${oid2}/join/`, { as: s2 })).status === 404);
	check("the instructor starts it", (await call("POST", `live-sessions/${oid2}/join/`, { as: teacher })).json.status === "live");
	const lq2 = (m, path, o) => call(m, `live-questions/${oid2}/${path}`, o);
	for (const bad of [undefined, null, "", false]) {
		check(`missing/blank answer key ${JSON.stringify(bad)} is refused`, (await lq2("POST", "questions/", { as: teacher, body: { text: "2 + 2 =", options: ["3", "4", "5", "6"], correctIndex: bad } })).status === 422);
	}
	const pub2 = await lq2("POST", "questions/", { as: teacher, body: { text: "2 + 2 =", options: ["3", "4", "5", "6"], correctIndex: 1, publish: true } });
	check("2 + 2 published with key 4", pub2.status === 201);
	const [[keyRow]] = await db.query("SELECT correct_option_id, options FROM live_questions WHERE id = ?", [pub2.json.question.id]);
	const opts = typeof keyRow.options === "string" ? JSON.parse(keyRow.options) : keyRow.options;
	check("stored key points at the option whose text is 4", opts.find((o) => o.id === keyRow.correct_option_id).text === "4");
	const four = opts.find((o) => o.text === "4").id;
	const five = opts.find((o) => o.text === "5").id;
	check("choosing 5 is graded incorrect", (await lq2("POST", `questions/${pub2.json.question.id}/answer/`, { as: s1, body: { optionId: five, isCorrect: true } })).status === 200);
	const [[g1]] = await db.query("SELECT is_correct FROM live_question_responses WHERE live_question_id = ? AND user_id = ?", [pub2.json.question.id, s1.id]);
	check("5 stored as incorrect even if the client claims otherwise", g1.is_correct === 0);
	await lq2("POST", `questions/${pub2.json.question.id}`, { as: teacher, body: { action: "reveal" } });
	const rv = (await lq2("GET", "state/", { as: s1 })).json.current;
	check("student sees 4 as the correct answer and their 5 as wrong", rv.correctOptionId === four && rv.myAnswer.optionId === five && rv.myAnswer.isCorrect === false);
	const tf = await lq2("POST", "questions/", { as: teacher, body: { kind: "true_false", text: "7 is prime.", correctIndex: 0, publish: true } });
	check("true/false question works", tf.status === 201 && tf.json.question.options.map((o) => o.text).join() === "True,False");

	const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]).toString("base64");
	const up = await lq2("POST", "images/", { as: teacher, body: { data: PNG } });
	check("instructor uploads an image", up.status === 201 && up.json.mime === "image/png");
	check("svg is refused", (await lq2("POST", "images/", { as: teacher, body: { data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>').toString("base64") } })).status === 415);
	check("oversized file is refused", (await lq2("POST", "images/", { as: teacher, body: { data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(1100000)]).toString("base64") } })).status === 413);
	check("students cannot upload", (await lq2("POST", "images/", { as: s1, body: { data: PNG } })).status === 403);
	check("anonymous cannot upload", (await lq2("POST", "images/", { body: { data: PNG } })).status === 401);
	const draftImg = await lq2("POST", "questions/", { as: teacher, body: { text: "Which animal?", imageId: up.json.imageId, options: ["Cat", "Dog"], correctIndex: 0 } });
	check("image question saved as a draft", draftImg.status === 201 && draftImg.json.question.imageId === up.json.imageId);
	const rawImg = (path, as) => fetch(`${BASE}/api/live-questions/${path}`, { headers: as ? { Authorization: token(as) } : {} });
	check("student cannot see a draft's image", (await rawImg(`${oid2}/images/${up.json.imageId}/`, s1)).status === 404);
	check("instructor can", (await rawImg(`${oid2}/images/${up.json.imageId}/`, teacher)).status === 200);
	await lq2("POST", `questions/${draftImg.json.question.id}`, { as: teacher, body: { action: "publish" } });
	const served = await rawImg(`${oid2}/images/${up.json.imageId}/`, s1);
	check("student gets the image once published, as a non-executable image type", served.status === 200 && served.headers.get("content-type") === "image/png" && served.headers.get("x-content-type-options") === "nosniff");
	check("the other session's participants cannot read it", (await rawImg(`${gid}/images/${up.json.imageId}/`, seated[0])).status === 404 && (await rawImg(`${oid2}/images/${up.json.imageId}/`, s2)).status === 404);
	check("anonymous cannot read it", (await rawImg(`${oid2}/images/${up.json.imageId}/`)).status === 401);
	const [[img]] = await db.query("SELECT class_id, uploader_id, size FROM live_question_images WHERE id = ?", [up.json.imageId]);
	check("image is bound to the session and uploader", img.class_id === oid2 && img.uploader_id === teacher.id);
	check("an image of one session cannot be used in another", (await call("POST", `live-questions/${gid}/questions/`, { as: teacher, body: { text: "x", imageId: up.json.imageId, options: ["a", "b"], correctIndex: 0 } })).status === 422);
	const imgQ = (await lq2("GET", "state/", { as: s1 })).json.current;
	const catId = imgQ.options.find((o) => o.text === "Cat").id;
	await lq2("POST", `questions/${draftImg.json.question.id}/answer/`, { as: s1, body: { optionId: catId } });
	await lq2("POST", `questions/${draftImg.json.question.id}`, { as: teacher, body: { action: "reveal" } });
	check("image question answered and graded", (await lq2("GET", "state/", { as: s1 })).json.current.myAnswer.isCorrect === true);

	// ================= instructor ends early: notifications follow the session =================
	const early = await call("POST", "live-sessions/", { as: teacher, body: form({ title: "Ends early", date: day(9), time: "10:00", capacity: 3, studentIds: [s1.id, s2.id] }) });
	const eid = early.json.session.id;
	// make "starting soon" apply now: starts in 3 h, lasts 2 h
	await db.query("UPDATE lc_classes SET start_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 3 HOUR), end_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 HOUR) WHERE id = ?", [eid]);
	const pre = (await call("GET", "notifications/", { as: s1 })).json.notifications.filter((n) => n.link === `/learning/live/${eid}/`);
	check("before: the student sees the assignment and a starting-soon reminder, both upcoming", pre.map((n) => n.type).sort().join() === "live_session_assigned,live_session_reminder" && pre.every((n) => n.state === "upcoming"));
	// it starts now and the instructor ends it about 2 hours before the planned end
	await db.query("UPDATE lc_classes SET start_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE), end_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 119 MINUTE) WHERE id = ?", [eid]);
	check("instructor starts", (await call("POST", `live-sessions/${eid}/join/`, { as: teacher })).json.status === "live");
	check("student joins", (await call("POST", `live-sessions/${eid}/join/`, { as: s1 })).status === 200);
	const endCall = await call("POST", `live-sessions/${eid}/`, { as: teacher, body: { action: "end" } });
	const endCall2 = await call("POST", `live-sessions/${eid}/`, { as: teacher, body: { action: "end" } });
	check("ending twice is safe", endCall.status === 200 && endCall2.status === 200 && endCall2.json.session.status === "completed");
	const [[endedRow]] = await db.query("SELECT status, ended_at, end_at FROM lc_classes WHERE id = ?", [eid]);
	check("database: completed with the actual end time, long before the scheduled end", endedRow.status === "completed" && !!endedRow.ended_at && new Date(endedRow.ended_at) < new Date(new Date(endedRow.end_at).getTime() - 3600000));
	const post = (await call("GET", "notifications/", { as: s1 })).json;
	const mine = post.notifications.filter((n) => n.link === `/learning/live/${eid}/`);
	check("after: no starting-soon notification for the finished session", !mine.some((n) => n.type === "live_session_reminder"));
	check("after: the assignment notice says completed, not that there is a live session", mine.length === 1 && mine[0].state === "completed" && /completed/i.test(mine[0].title) && !/You have a live session/.test(mine[0].title));
	const [[rowsKept]] = await db.query("SELECT COUNT(*) n FROM notifications WHERE ref_id = ? AND user_id = ?", [eid, s1.id]);
	check("history is kept in the database", rowsKept.n === 2);
	check("opening the old notification shows the session as completed", (await call("GET", `live-sessions/${eid}/`, { as: s1 })).json.session.status === "completed");
	check("a finished session cannot be joined", (await call("POST", `live-sessions/${eid}/join/`, { as: s2 })).status === 409);
	check("attendance survives", (await call("GET", `live-sessions/${eid}/attendance/`, { as: s1 })).json.mine.status === "present");
	check("the unread count only counts what is shown", post.unread === post.notifications.filter((n) => !n.read).length);

	console.log(`live-sessions e2e: ${passed} checks passed`);
} finally {
	await db.query("DELETE FROM notifications WHERE ref_id IN (SELECT id FROM lc_classes WHERE course_id IN (?, ?))", [courseId, otherCourse]); // no FK on ref_id
	await db.query("DELETE FROM lc_classes WHERE course_id IN (?, ?)", [courseId, otherCourse]); // cascades to seats, attendance, live questions
	await db.query("DELETE FROM courses WHERE id IN (?, ?)", [courseId, otherCourse]);
	if (tempCat) await db.query("DELETE FROM categories WHERE id = ?", [tempCat]);
	await db.end();
}
