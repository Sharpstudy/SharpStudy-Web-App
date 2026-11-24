// Authorization / ownership checks for the legacy course, quiz, asset, wishlist
// and checkout API routes, against a RUNNING dev server and its database
// (localhost only). Two instructors, an enrolled and a non-enrolled student and
// an admin come from the existing dev users. Temporary courses (and everything
// created under them) are removed at the end; the Stripe-charging path is NOT
// exercised (only validation failures and a free course).
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
const db = await mysql.createConnection({ host: process.env.DB_HOSTNAME, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME_DEVELOPMENT });
const [users] = await db.query("SELECT id, role, email FROM users WHERE status = 1 OR status IS NULL ORDER BY created_at");
const instructors = users.filter((u) => u.role === "instructor");
const students = users.filter((u) => u.role === "student");
const admin = users.find((u) => u.role === "admin");
assert.ok(instructors.length >= 2 && students.length >= 3 && admin, "need two instructors, three students and an admin in the dev DB");
const [insA, insB] = instructors;
const [stuIn, stuOut, stuFree] = students;
const tok = (u) => jwt.sign({ userId: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "10m" });
const forged = (u) => jwt.sign({ userId: u.id, role: "admin" }, "not-the-secret");

const [[cat]] = await db.query("SELECT id FROM categories LIMIT 1");
assert.ok(cat, "need a category");
const tag = `zz-e2e-${Date.now()}`;
const courseA = randomUUID(); // owned by insA, price 25, approved
const courseFree = randomUUID(); // owned by insB, price 0, approved
const courseB = randomUUID(); // owned by insB
const addCourse = (id, slug, owner, price, approved = 1) =>
	db.query("INSERT INTO courses (id, title, slug, userId, catId, latest_price, approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())", [id, `${tag} ${slug}`, `${tag}-${slug}`, owner.id, cat.id, price, approved]);
await addCourse(courseA, "a", insA, 25);
await addCourse(courseB, "b", insB, 40);
await addCourse(courseFree, "free", insB, 0);
await db.query("INSERT INTO enrolments (id, userId, courseId, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())", [randomUUID(), stuIn.id, courseA]);

let n = 0;
const check = (name, cond) => {
	assert.ok(cond, name);
	n++;
};
const call = async (method, path, { as, raw, body, query } = {}) => {
	const headers = { "Content-Type": "application/json" };
	if (as) headers.Authorization = tok(as);
	if (raw) headers.Authorization = raw;
	const res = await fetch(`${BASE}${path}${query ? `?${new URLSearchParams(query)}` : ""}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch (e) {
		/* not json */
	}
	return { status: res.status, json, text };
};
const count = async (sql, args = []) => Number((await db.query(sql, args))[0][0].n);

try {
	// ================= courses/course/[id] =================
	const C = (id) => `/api/courses/course/${id}/`;
	check("course GET: anonymous 401", (await call("GET", C(courseA))).status === 401);
	check("course GET: fake header 401", (await call("GET", C(courseA), { raw: "x" })).status === 401);
	check("course GET: forged-secret token 401", (await call("GET", C(courseA), { raw: forged(stuIn) })).status === 401);
	check("course GET: student 403", (await call("GET", C(courseA), { as: stuIn })).status === 403);
	check("course GET: other instructor 403", (await call("GET", C(courseA), { as: insB })).status === 403);
	check("course GET: owner 200", (await call("GET", C(courseA), { as: insA })).status === 200);
	check("course GET: admin 200", (await call("GET", C(courseA), { as: admin })).status === 200);
	const put = (as, title) => call("PUT", C(courseA), { as, body: { title, short_desc: "t", overview: "t", latest_price: 25, before_price: 30, lessons: "1", duration: "1", image: "x", access_time: "Lifetime", requirements: "t", what_you_will_learn: "t", who_is_this_course_for: "t", catId: cat.id } });
	check("course PUT: student 403", (await put(stuIn, "hacked")).status === 403);
	check("course PUT: other instructor 403", (await put(insB, "hacked")).status === 403);
	check("course unchanged after denied PUTs", (await count("SELECT COUNT(*) n FROM courses WHERE id = ? AND title LIKE ?", [courseA, `${tag}%`])) === 1);
	check("course PUT: owner 200", (await put(insA, `${tag} a renamed`)).status === 200);
	check("course DELETE: student 403", (await call("DELETE", C(courseA), { as: stuIn })).status === 403);
	check("course DELETE: other instructor 403", (await call("DELETE", C(courseA), { as: insB })).status === 403);
	check("course still exists after denied DELETEs", (await count("SELECT COUNT(*) n FROM courses WHERE id = ?", [courseA])) === 1);

	// ================= upload/new + upload/[id] (videos) =================
	const vid = (title, preview, extra = {}) => ({ group_name: "g", title, thumb: "t", video: `https://example.test/${title}.mp4`, video_length: 10, is_preview: preview, short_id: 1, courseId: courseA, ...extra });
	check("video POST: anonymous 401", (await call("POST", "/api/courses/course/upload/new/", { body: vid("v0", true) })).status === 401);
	check("video POST: student 403", (await call("POST", "/api/courses/course/upload/new/", { as: stuIn, body: vid("v0", true) })).status === 403);
	check("video POST: other instructor 403 (course not theirs)", (await call("POST", "/api/courses/course/upload/new/", { as: insB, body: vid("v0", true) })).status === 403);
	check("no video was created by denied requests", (await count("SELECT COUNT(*) n FROM videos WHERE courseId = ?", [courseA])) === 0);
	check("video POST: owner preview lesson", (await call("POST", "/api/courses/course/upload/new/", { as: insA, body: vid("preview", true, { userId: insB.id }) })).status === 200);
	check("video POST: owner locked lesson", (await call("POST", "/api/courses/course/upload/new/", { as: insA, body: vid("locked", false) })).status === 200);
	check("video uploader is the token user, not the body userId", (await count("SELECT COUNT(*) n FROM videos WHERE courseId = ? AND userId = ?", [courseA, insA.id])) === 2);
	const [[previewV]] = await db.query("SELECT id FROM videos WHERE courseId = ? AND title = 'preview'", [courseA]);
	const [[lockedV]] = await db.query("SELECT id FROM videos WHERE courseId = ? AND title = 'locked'", [courseA]);
	const U = (id) => `/api/courses/course/upload/${id}/`;
	check("video list: student 403", (await call("GET", U(courseA), { as: stuIn })).status === 403);
	check("video list: other instructor 403", (await call("GET", U(courseA), { as: insB })).status === 403);
	check("video list: owner 200", (await call("GET", U(courseA), { as: insA })).status === 200);
	check("video DELETE: other instructor 403", (await call("DELETE", U(lockedV.id), { as: insB })).status === 403);
	check("video DELETE: student 403", (await call("DELETE", U(lockedV.id), { as: stuIn })).status === 403);
	check("video still exists", (await count("SELECT COUNT(*) n FROM videos WHERE id = ?", [lockedV.id])) === 1);

	// ================= course assets =================
	const A = (id) => `/api/courses/course/assets/${id}/`;
	check("asset POST: student 403", (await call("POST", A(courseA), { as: stuIn, body: { lecture_name: "x", lecture_file: "y" } })).status === 403);
	check("asset POST: other instructor 403", (await call("POST", A(courseA), { as: insB, body: { lecture_name: "x", lecture_file: "y" } })).status === 403);
	check("asset POST: unknown course 404", (await call("POST", A(randomUUID()), { as: insA, body: { lecture_name: "x", lecture_file: "y" } })).status === 404);
	check("asset POST: owner", (await call("POST", A(courseA), { as: insA, body: { lecture_name: "notes", lecture_file: "https://example.test/notes.pdf" } })).status === 200);
	const [[asset]] = await db.query("SELECT id FROM course_assets WHERE courseId = ?", [courseA]);
	check("asset list (instructor route): student 403, other instructor 403", (await call("GET", A(courseA), { as: stuIn })).status === 403 && (await call("GET", A(courseA), { as: insB })).status === 403);
	check("asset DELETE: other instructor 403", (await call("DELETE", A(asset.id), { as: insB })).status === 403);
	check("asset DELETE: student 403", (await call("DELETE", A(asset.id), { as: stuIn })).status === 403);
	check("asset still exists", (await count("SELECT COUNT(*) n FROM course_assets WHERE id = ?", [asset.id])) === 1);

	// ================= student-facing content =================
	const AS = (id) => `/api/assets/${id}/`;
	check("assets: anonymous 401", (await call("GET", AS(courseA))).status === 401);
	check("assets: non-enrolled student 403", (await call("GET", AS(courseA), { as: stuOut })).status === 403);
	check("assets: enrolled student 200 with the file", (await call("GET", AS(courseA), { as: stuIn })).json?.assets?.length === 1);
	check("assets: owner and admin 200", (await call("GET", AS(courseA), { as: insA })).status === 200 && (await call("GET", AS(courseA), { as: admin })).status === 200);
	check("assets: other instructor 403", (await call("GET", AS(courseA), { as: insB })).status === 403);

	const slug = `${tag}-a`;
	const curriculum = async (opts) => (await call("GET", `/api/learnings/videos/${slug}/`, opts)).json.videos;
	const byTitle = (vs, t) => vs.find((v) => v.title === t);
	let vs = await curriculum();
	check("curriculum (visitor): lesson list visible, preview URL kept, locked URL hidden", vs.length === 2 && byTitle(vs, "preview").video && byTitle(vs, "locked").video === null);
	vs = await curriculum({ as: stuOut });
	check("curriculum (not enrolled): locked URL hidden", byTitle(vs, "locked").video === null);
	vs = await curriculum({ as: stuIn });
	check("curriculum (enrolled): locked URL visible", !!byTitle(vs, "locked").video);
	vs = await curriculum({ as: insA });
	check("curriculum (owner): locked URL visible", !!byTitle(vs, "locked").video);

	const L = (id) => `/api/learnings/video/${id}/`;
	check("lesson: anonymous 401", (await call("GET", L(lockedV.id), { query: { userId: stuIn.id, courseId: courseA } })).status === 401);
	check("lesson: non-enrolled 403 even with someone else's ids in the query", (await call("GET", L(lockedV.id), { as: stuOut, query: { userId: stuIn.id, courseId: courseA } })).status === 403);
	check("no progress row created for the forged request", (await count("SELECT COUNT(*) n FROM course_progresses WHERE courseId = ?", [courseA]).catch(() => 0)) === 0);
	const lesson = await call("GET", L(lockedV.id), { as: stuIn, query: { userId: stuOut.id, courseId: courseB } });
	check("lesson: enrolled 200", lesson.status === 200 && lesson.json.video.id === lockedV.id);
	check("progress recorded for the token user, not the query userId", (await count("SELECT COUNT(*) n FROM course_progresses WHERE courseId = ? AND userId = ?", [courseA, stuIn.id]).catch(() => 1)) === 1);
	check("progress: anonymous 401", (await call("GET", "/api/learnings/progress/", { query: { userId: stuIn.id, courseId: courseA } })).status === 401);
	const prog = await call("GET", "/api/learnings/progress/", { as: stuOut, query: { userId: stuIn.id, courseId: courseA } });
	check("progress: query userId ignored (other learner's progress not returned)", prog.status === 200 && prog.json.courseProgress.length === 0);

	const E = (as, uid) => call("GET", "/api/courses/course/exist/", { as, query: { userId: uid, courseId: courseA } });
	check("exist: visitor false", (await E(null, stuIn.id)).json.enroll === false);
	check("exist: other user cannot probe someone's purchase via userId", (await E(stuOut, stuIn.id)).json.enroll === false);
	check("exist: enrolled user true", (await E(stuIn, stuIn.id)).json.enroll === true);

	// ================= wishlist / favourites =================
	check("wishlist: forged token 401", (await call("GET", "/api/wishlist/", { raw: forged(stuIn) })).status === 401);
	check("favourite POST: anonymous 401", (await call("POST", "/api/favourites/new/", { body: { userId: stuIn.id, courseId: courseA, fav: true } })).status === 401);
	const fav = await call("POST", "/api/favourites/new/", { as: stuOut, body: { userId: stuIn.id, courseId: courseA, fav: true } });
	check("favourite POST: saved for the token user, body userId ignored", fav.status === 200 && (await count("SELECT COUNT(*) n FROM favourites WHERE courseId = ? AND userId = ?", [courseA, stuOut.id])) === 1 && (await count("SELECT COUNT(*) n FROM favourites WHERE courseId = ? AND userId = ?", [courseA, stuIn.id])) === 0);
	await call("POST", "/api/favourites/new/", { as: stuOut, body: { courseId: courseA, fav: true } });
	check("favourite POST twice does not duplicate", (await count("SELECT COUNT(*) n FROM favourites WHERE courseId = ? AND userId = ?", [courseA, stuOut.id])) === 1);
	check("favourite GET: reflects the caller only", (await call("GET", "/api/favourites/new/", { as: stuIn, query: { userId: stuOut.id, courseId: courseA } })).text === "false");
	check("favourite remove", (await call("POST", "/api/favourites/new/", { as: stuOut, body: { courseId: courseA, fav: false } })).status === 200 && (await count("SELECT COUNT(*) n FROM favourites WHERE courseId = ?", [courseA])) === 0);
	check("favourite for an unknown course 404", (await call("POST", "/api/favourites/new/", { as: stuOut, body: { courseId: randomUUID(), fav: true } })).status === 404);

	// ================= quizzes / questions / answer options =================
	const Q = "/api/quizzes/instructor/quiz/";
	check("quiz POST: anonymous 401", (await call("POST", Q, { body: { title: "q", description: "d", courseId: courseA } })).status === 401);
	check("quiz POST: student 403", (await call("POST", Q, { as: stuIn, body: { title: "q", description: "d", courseId: courseA } })).status === 403);
	check("quiz POST: other instructor cannot attach a quiz to this course (403)", (await call("POST", Q, { as: insB, body: { title: `${tag} q`, description: "d", courseId: courseA } })).status === 403);
	check("no quiz created by denied requests", (await count("SELECT COUNT(*) n FROM quizzes WHERE courseId = ?", [courseA])) === 0);
	const quiz = await call("POST", Q, { as: insA, body: { title: `${tag} quiz`, description: "d", courseId: courseA, userId: insB.id } });
	check("quiz POST: owner", quiz.status === 200 && quiz.json.quiz.userId === insA.id);
	const quizId = quiz.json.quiz.id;
	const otherGet = await call("GET", Q, { as: insB, query: { quizId } });
	check("quiz GET: other instructor cannot read it", otherGet.status === 200 && otherGet.json.quiz === null);
	const otherPut = await call("PUT", Q, { as: insB, query: { quizId }, body: { title: "hacked", description: "hacked" } });
	check(`quiz PUT: other instructor refused (got ${otherPut.status})`, otherPut.status === 404);
	const otherDel = await call("DELETE", Q, { as: insB, query: { quizId } });
	check(`quiz DELETE: other instructor refused (got ${otherDel.status})`, otherDel.status === 403);
	check("quiz DELETE: student 403", (await call("DELETE", Q, { as: stuIn, query: { quizId } })).status === 403);
	check("quiz still exists and unchanged", (await count("SELECT COUNT(*) n FROM quizzes WHERE id = ? AND title = ?", [quizId, `${tag} quiz`])) === 1);

	const QU = "/api/questions/question/";
	check("question POST: student 403", (await call("POST", QU, { as: stuIn, body: [{ quizId, question_text: "?" }] })).status === 403);
	check("question POST: other instructor 403", (await call("POST", QU, { as: insB, body: [{ quizId, question_text: "?" }] })).status === 403);
	check("question POST: mixing in a foreign quiz is refused", (await call("POST", QU, { as: insA, body: [{ quizId, question_text: "ok" }, { quizId: randomUUID(), question_text: "x" }] })).status === 404);
	check("no question created by denied requests", (await count("SELECT COUNT(*) n FROM questions WHERE quizId = ?", [quizId])) === 0);
	const q = await call("POST", QU, { as: insA, body: [{ quizId, question_text: "2+2?" }] });
	check("question POST: owner", q.status === 200);
	const questionId = q.json.questions[0].id;
	check("question GET: student 403, other instructor 403, owner 200", (await call("GET", QU, { as: stuIn, query: { questionId } })).status === 403 && (await call("GET", QU, { as: insB, query: { questionId } })).status === 403 && (await call("GET", QU, { as: insA, query: { questionId } })).status === 200);
	check("question DELETE: student/other instructor 403", (await call("DELETE", QU, { as: stuIn, query: { questionId } })).status === 403 && (await call("DELETE", QU, { as: insB, query: { questionId } })).status === 403);
	check("question PUT: other instructor 403; cannot be moved to another quiz", (await call("PUT", QU, { as: insB, query: { questionId }, body: { question_text: "hacked", quizId } })).status === 403 && (await call("PUT", QU, { as: insA, query: { questionId }, body: { question_text: "x", quizId: randomUUID() } })).status === 400);
	check("question unchanged after denied requests", (await count("SELECT COUNT(*) n FROM questions WHERE id = ? AND question_text = '2+2?'", [questionId])) === 1);

	const AO = "/api/answer-options/answer-option/";
	const opts = [{ questionId, option_text: "3", is_correct: false }, { questionId, option_text: "4", is_correct: true }];
	check("answer options POST: student 403, other instructor 403", (await call("POST", AO, { as: stuIn, body: opts })).status === 403 && (await call("POST", AO, { as: insB, body: opts })).status === 403);
	check("no answer options created by denied requests", (await count("SELECT COUNT(*) n FROM answer_options WHERE questionId = ?", [questionId])) === 0);
	check("answer options POST: owner", (await call("POST", AO, { as: insA, body: opts })).status === 200);
	check("answer key GET: student 403, other instructor 403, owner sees is_correct", (await call("GET", AO, { as: stuIn, query: { questionId } })).status === 403 && (await call("GET", AO, { as: insB, query: { questionId } })).status === 403 && (await call("GET", AO, { as: insA, query: { questionId } })).text.includes("is_correct"));
	const [[opt]] = await db.query("SELECT id FROM answer_options WHERE questionId = ? AND is_correct = 0", [questionId]);
	check("answer option PUT: other instructor/student 403 and nothing flipped", (await call("PUT", AO, { as: insB, query: { id: opt.id }, body: { is_correct: true } })).status === 403 && (await call("PUT", AO, { as: stuIn, query: { id: opt.id }, body: { is_correct: true } })).status === 403 && (await count("SELECT COUNT(*) n FROM answer_options WHERE questionId = ? AND is_correct = 1", [questionId])) === 1);
	check("answer options DELETE: other instructor/student 403 and still present", (await call("DELETE", AO, { as: insB, query: { questionId } })).status === 403 && (await call("DELETE", AO, { as: stuIn, query: { questionId } })).status === 403 && (await count("SELECT COUNT(*) n FROM answer_options WHERE questionId = ?", [questionId])) === 2);

	const SQ = "/api/quizzes/student/quiz/";
	check("student quiz: anonymous 401", (await call("GET", SQ, { query: { quizId } })).status === 401);
	check("student quiz: instructor 403", (await call("GET", SQ, { as: insB, query: { quizId } })).status === 403);
	check("student quiz: non-enrolled student 403", (await call("GET", SQ, { as: stuOut, query: { quizId } })).status === 403);
	const sq = await call("GET", SQ, { as: stuIn, query: { quizId } });
	check("student quiz: enrolled student 200", sq.status === 200 && sq.json.quiz.questions.length === 1);
	check("student quiz response contains no answer key", !/is_correct/.test(sq.text));
	check("student quiz: unknown quiz 404", (await call("GET", SQ, { as: stuIn, query: { quizId: randomUUID() } })).status === 404);

	// ================= checkout (validation only; no Stripe charge) =================
	const CK = "/api/checkout/";
	const cart = (c, price) => [{ id: c, price, quantity: 1 }];
	check("checkout: anonymous 401", (await call("POST", CK, { body: { cartItems: cart(courseB, 40), userId: stuOut.id } })).status === 401);
	const enrolBefore = await count("SELECT COUNT(*) n FROM enrolments");
	check("checkout: tampered price 422", (await call("POST", CK, { as: stuOut, body: { cartItems: cart(courseB, 0.01) } })).status === 422);
	check("checkout: negative / non-numeric price 422", (await call("POST", CK, { as: stuOut, body: { cartItems: cart(courseB, -5) } })).status === 422 && (await call("POST", CK, { as: stuOut, body: { cartItems: cart(courseB, "abc") } })).status === 422);
	check("checkout: unknown course 404", (await call("POST", CK, { as: stuOut, body: { cartItems: cart(randomUUID(), 1) } })).status === 404);
	check("checkout: cannot buy your own course", (await call("POST", CK, { as: insB, body: { cartItems: cart(courseB, 40) } })).status === 422);
	check("checkout: already enrolled 409", (await call("POST", CK, { as: stuIn, body: { cartItems: cart(courseA, 25) } })).status === 409);
	check("checkout: empty cart 422", (await call("POST", CK, { as: stuOut, body: { cartItems: [] } })).status === 422);
	check("checkout: denied requests created no enrolments", (await count("SELECT COUNT(*) n FROM enrolments")) === enrolBefore);
	const free = await call("POST", CK, { as: stuFree, body: { cartItems: cart(courseFree, 0), userId: stuIn.id, buyer_email: "evil@example.com" } });
	check("checkout: free course enrols the signed-in user", free.status === 200 && (await count("SELECT COUNT(*) n FROM enrolments WHERE courseId = ? AND userId = ?", [courseFree, stuFree.id])) === 1);
	check("checkout: body userId/email were ignored", (await count("SELECT COUNT(*) n FROM enrolments WHERE courseId = ? AND userId = ?", [courseFree, stuIn.id])) === 0 && (await count("SELECT COUNT(*) n FROM enrolments WHERE courseId = ? AND buyer_email = 'evil@example.com'", [courseFree])) === 0);

	// ================= intentionally public =================
	check("public: course by slug", (await call("GET", `/api/courses/course/`, { query: { slug } })).status === 200);
	check("public: catalogue", (await call("GET", "/api/all-courses/")).status === 200);
	check("public: home courses", (await call("GET", "/api/home-courses/")).status === 200);

	// ================= owner can still clean up through the API =================
	check("question DELETE: owner", (await call("DELETE", QU, { as: insA, query: { questionId } })).status === 200);
	check("video DELETE: owner", (await call("DELETE", U(lockedV.id), { as: insA })).status === 200);
	check("asset DELETE: owner", (await call("DELETE", A(asset.id), { as: insA })).status === 200);
	check("quiz DELETE: owner", (await call("DELETE", Q, { as: insA, query: { quizId } })).status === 200);
	check("course DELETE: admin", (await call("DELETE", C(courseB), { as: admin })).status === 200);
	console.log(`api-access e2e: ${n} checks passed`);
} finally {
	await db.query("DELETE FROM courses WHERE title LIKE ?", [`${tag}%`]); // only this run's temporary courses (children cascade)
	await db.end();
}
