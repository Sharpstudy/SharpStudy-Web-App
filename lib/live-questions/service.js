// Live questions inside an existing Jitsi class. A "class" is a course (the
// Jitsi room is the course slug). The server is authoritative for who may do
// what, for deadlines, for correctness and for what each role may see.
//
// Pure with respect to storage: every function takes a `repo` (see
// repo.js; tests use an in-memory one) and an explicit `now` (Date).
//
// Lifecycle: draft -> open -> closed -> revealed.
//   open      students can answer (until the server-side deadline, if any)
//   closed    submissions rejected; instructor still sees live results
//   revealed  correct answer + explanation visible to students
// `results_published` (distribution) is a separate switch the instructor sets.

import { v4 as uuidv4 } from "uuid";
import { ServiceError } from "../mastery/service.js";

const fail = (status, code, message) => {
	throw new ServiceError(status, code, message);
};

export const LIMITS = {
	textMax: 500,
	optionMin: 2,
	optionMax: 6,
	optionTextMax: 200,
	explanationMax: 1000,
	durationMin: 5,
	durationMax: 3600,
};

const iso = (d) => (d ? new Date(d).toISOString() : null);
const ms = (d) => (d ? new Date(d).getTime() : null);

// ---------------------------------------------------------------- access

// Resolve the caller's role in this class.
//   instructor: the course owner, or an administrator
//   student:    anyone enrolled in the course
// Everything else is refused; unknown classes are 404.
// `key` is either a scheduled live session id (questions belong to THAT session only:
// instructor = its instructor or an admin, student = a seat holder with a paid
// enrolment in its course) or, as before, a course slug (questions with no session).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getAccess(repo, actor, key) {
	if (!actor || !actor.userId) fail(401, "unauthorized", "Sign in first");
	const k = String(key || "");
	if (UUID.test(k)) {
		const session = await repo.getSession(k);
		const course = session ? await repo.getCourseById(session.course_id) : null;
		if (!session || !course) fail(404, "not_found", "Class not found");
		if (session.instructor_id === actor.userId || actor.role === "admin") return { course, session, classId: session.id, role: "instructor" };
		if ((await repo.getSeat(session.id, `u:${actor.userId}`)) && (await repo.hasPaidEnrolment(actor.userId, course.id))) {
			return { course, session, classId: session.id, role: "student" };
		}
		// A session you are not part of is indistinguishable from a missing one.
		return fail(404, "not_found", "Class not found");
	}
	const course = await repo.getCourseBySlug(k);
	if (!course) fail(404, "not_found", "Class not found");
	if (course.userId === actor.userId || actor.role === "admin") return { course, session: null, classId: null, role: "instructor" };
	if (await repo.isEnrolled(actor.userId, course.id)) return { course, session: null, classId: null, role: "student" };
	return fail(403, "forbidden", "You are not part of this class");
}

const requireInstructor = async (repo, actor, slug) => {
	const access = await getAccess(repo, actor, slug);
	if (access.role !== "instructor") fail(403, "forbidden", "Only the instructor can do this");
	return access;
};

async function loadQuestion(repo, course, id, classId = null) {
	const q = await repo.getQuestion(String(id || ""));
	// A question from another course or session is indistinguishable from a missing one.
	if (!q || q.course_id !== course.id || (q.class_id || null) !== classId) fail(404, "not_found", "Question not found");
	return q;
}

// Questions are published and answered only while their session is live
// (course-level classes have no session and no such restriction).
const requireLive = (session) => {
	if (session && session.status !== "live") fail(409, "not_live", session.status === "scheduled" ? "The session has not started yet" : "This session is no longer live");
};

// Persist the deadline-driven close the first time anyone looks after expiry.
async function settle(repo, q, now) {
	if (q.status === "open" && q.deadline_at && ms(q.deadline_at) <= now.getTime()) {
		return (await repo.updateQuestion(q.id, { status: "closed", closed_at: q.deadline_at }, { whereStatus: "open" })) || { ...q, status: "closed", closed_at: q.deadline_at };
	}
	return q;
}

// ----------------------------------------------------------- validation

export const KINDS = ["single", "true_false"];
const TF_OPTIONS = ["True", "False"];

// The answer key must be an explicit choice. Number(null), Number("") and
// Number(false) are all 0, which used to turn a missing key into "the first option".
function parseCorrectIndex(v, count) {
	const ok = (typeof v === "number" && Number.isInteger(v)) || (typeof v === "string" && /^\d{1,2}$/.test(v.trim()));
	const n = ok ? Number(v) : NaN;
	if (!Number.isInteger(n) || n < 0 || n >= count) fail(422, "invalid", "Choose the correct answer");
	return n;
}

// Images are looked up, never trusted: each must exist, belong to this course and
// session, and have been uploaded by the person managing it.
async function checkImage(repo, scope, id) {
	if (!id) return null;
	const img = await repo.getImage(String(id));
	if (!img || img.course_id !== scope.course.id || (img.class_id || null) !== scope.classId || img.uploader_id !== scope.ownerId) {
		fail(422, "invalid", "That image is not available for this session. Upload it again.");
	}
	return img.id;
}

async function validateInput(repo, input, scope) {
	input = input || {};
	const kind = input.kind === undefined || input.kind === null || input.kind === "" ? "single" : String(input.kind);
	if (!KINDS.includes(kind)) fail(422, "invalid", "Unknown question type");
	const imageId = await checkImage(repo, scope, input.imageId);
	const text = String(input.text || "").trim();
	if (text.length > LIMITS.textMax || (!text && !imageId)) fail(422, "invalid", `Question needs 1–${LIMITS.textMax} characters of text or an image`);

	let options;
	if (kind === "true_false") {
		options = TF_OPTIONS.map((t) => ({ text: t, imageId: null }));
	} else {
		const raw = Array.isArray(input.options) ? input.options : [];
		options = [];
		for (const o of raw) {
			const t = String(typeof o === "string" ? o : (o && o.text) || "").trim();
			const img = await checkImage(repo, scope, o && typeof o === "object" ? o.imageId : null);
			if ((!t && !img) || t.length > LIMITS.optionTextMax) fail(422, "invalid", `Each option needs 1–${LIMITS.optionTextMax} characters of text or an image`);
			options.push({ text: t, imageId: img });
		}
		if (options.length < LIMITS.optionMin || options.length > LIMITS.optionMax) fail(422, "invalid", `Provide ${LIMITS.optionMin}–${LIMITS.optionMax} answer options`);
		const keys = options.map((o) => (o.imageId ? `i:${o.imageId}` : `t:${o.text.toLowerCase()}`));
		if (new Set(keys).size !== keys.length) fail(422, "invalid", "Answer options must be different from each other");
		const texted = options.filter((o) => o.text).map((o) => o.text.toLowerCase());
		if (new Set(texted).size !== texted.length) fail(422, "invalid", "Answer options must be different from each other");
	}
	const correct = parseCorrectIndex(input.correctIndex, options.length);
	const explanation = String(input.explanation || "").trim();
	if (explanation.length > LIMITS.explanationMax) fail(422, "invalid", `Explanation must be at most ${LIMITS.explanationMax} characters`);
	let durationSec = null;
	if (input.durationSec !== undefined && input.durationSec !== null && input.durationSec !== "") {
		durationSec = Number(input.durationSec);
		if (!Number.isInteger(durationSec) || durationSec < LIMITS.durationMin || durationSec > LIMITS.durationMax) {
			fail(422, "invalid", `Countdown must be ${LIMITS.durationMin}–${LIMITS.durationMax} seconds`);
		}
	}
	const sourceQuestionId = input.sourceQuestionId ? String(input.sourceQuestionId).slice(0, 36) : null;
	// Stable ids are assigned once, here; the key is stored as that id, never as a position.
	const stored = options.map((o, i) => ({ id: `o${i + 1}`, text: o.text, ...(o.imageId ? { imageId: o.imageId } : {}) }));
	return {
		question_type: kind,
		question_text: text,
		image_id: imageId,
		options: stored,
		correct_option_id: stored[correct].id,
		explanation: explanation || null,
		duration_sec: durationSec,
		allow_change: !!input.allowChange,
		source_question_id: sourceQuestionId,
	};
}

// ---------------------------------------------------------------- views

const distribution = (q, responses) => {
	const counts = Object.fromEntries(q.options.map((o) => [o.id, 0]));
	for (const r of responses) if (r.option_id in counts) counts[r.option_id]++;
	return q.options.map((o) => ({ optionId: o.id, count: counts[o.id] }));
};

// Instructor view: everything, including the private correct answer.
async function instructorView(repo, q, course, now) {
	const responses = await repo.listResponses(q.id);
	const enrolled = q.class_id ? await repo.listSessionParticipants(q.class_id) : await repo.listEnrolledUsers(course.id);
	const byUser = new Map(responses.map((r) => [r.user_id, r]));
	const nameOf = (u) => u.name || "Student";
	return {
		id: q.id,
		seq: q.seq,
		type: q.question_type,
		text: q.question_text,
		imageId: q.image_id || null,
		options: q.options,
		correctOptionId: q.correct_option_id,
		explanation: q.explanation || "",
		status: q.status,
		durationSec: q.duration_sec,
		allowChange: !!q.allow_change,
		resultsPublished: !!q.results_published,
		deadlineAt: iso(q.deadline_at),
		openedAt: iso(q.opened_at),
		closedAt: iso(q.closed_at),
		revealedAt: iso(q.revealed_at),
		totals: { enrolled: enrolled.length, answered: responses.length, correct: responses.filter((r) => r.option_id === q.correct_option_id).length },
		distribution: distribution(q, responses),
		answered: enrolled.filter((u) => byUser.has(u.id)).map((u) => ({ userId: u.id, name: nameOf(u), optionId: byUser.get(u.id).option_id, isCorrect: byUser.get(u.id).option_id === q.correct_option_id, submittedAt: iso(byUser.get(u.id).submitted_at) })),
		pending: enrolled.filter((u) => !byUser.has(u.id)).map((u) => ({ userId: u.id, name: nameOf(u) })),
	};
}

// Student view: never contains the correct answer until it is revealed, never
// contains other students' answers, and distribution only once published.
async function studentView(repo, q, userId) {
	const mine = await repo.getResponse(q.id, userId);
	const revealed = q.status === "revealed";
	const view = {
		id: q.id,
		seq: q.seq,
		type: q.question_type,
		text: q.question_text,
		imageId: q.image_id || null,
		options: q.options,
		status: q.status,
		allowChange: !!q.allow_change,
		deadlineAt: iso(q.deadline_at),
		myAnswer: mine ? { optionId: mine.option_id, submittedAt: iso(mine.submitted_at) } : null,
		revealed,
	};
	if (revealed) {
		view.correctOptionId = q.correct_option_id;
		view.explanation = q.explanation || "";
		if (mine) view.myAnswer.isCorrect = mine.option_id === q.correct_option_id;
	}
	if (q.results_published && (q.status === "closed" || revealed)) {
		const responses = await repo.listResponses(q.id);
		view.results = { total: responses.length, distribution: distribution(q, responses) };
	}
	return view;
}

// ------------------------------------------------------------ instructor

export async function createQuestion(repo, actor, slug, input, now = new Date()) {
	const { course, classId, session } = await requireInstructor(repo, actor, slug);
	const fields = await validateInput(repo, input, { course, classId, ownerId: actor.userId });
	if (input && input.publish) requireLive(session);
	const q = await repo.insertQuestion({
		id: uuidv4(),
		course_id: course.id,
		class_id: classId,
		instructor_id: session ? session.instructor_id : actor.userId,
		seq: (await repo.maxSeq(course.id, classId)) + 1,
		status: "draft",
		results_published: false,
		...fields,
	});
	const out = input && input.publish ? await publishQuestion(repo, actor, slug, q.id, now) : await instructorView(repo, q, course, now);
	return out;
}

// Edit an unpublished question. The saved key is replaced by the explicit one in the request.
export async function updateDraft(repo, actor, slug, id, input) {
	const { course, classId } = await requireInstructor(repo, actor, slug);
	const q = await loadQuestion(repo, course, id, classId);
	if (q.status !== "draft") fail(409, "conflict", "Only unpublished questions can be edited");
	const fields = await validateInput(repo, input, { course, classId, ownerId: actor.userId });
	const updated = await repo.updateQuestion(q.id, fields, { whereStatus: "draft" });
	if (!updated) fail(409, "conflict", "This question has already been published");
	return instructorView(repo, updated, course, new Date());
}

// Correct a wrong saved key on ONE question, explicitly chosen by the instructor.
// Nothing else changes; every grade is derived from the key, so views follow at once.
export async function setCorrectOption(repo, actor, slug, id, optionId, now = new Date()) {
	const { course, classId } = await requireInstructor(repo, actor, slug);
	const q = await loadQuestion(repo, course, id, classId);
	const opt = q.options.find((o) => o.id === String(optionId || ""));
	if (!opt) fail(422, "invalid", "Choose one of the listed answers");
	const updated = await repo.updateQuestion(q.id, { correct_option_id: opt.id });
	for (const r of await repo.listResponses(q.id)) {
		const is_correct = r.option_id === opt.id;
		if (!!r.is_correct !== is_correct) await repo.updateResponse(r.id, { is_correct });
	}
	return instructorView(repo, updated, course, now);
}

// ----------------------------------------------------------------- images

export const IMAGE_LIMITS = { maxBytes: 1024 * 1024, perSession: 40 };

// File type is decided by the bytes, never by the name or the declared type. SVG is
// refused on purpose (it can carry script).
export function sniffImage(buf) {
	if (buf.length > 12 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
	if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
	if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
	if (buf.length > 6 && (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a")) return "image/gif";
	return null;
}

export async function uploadImage(repo, actor, slug, base64) {
	const { course, classId } = await requireInstructor(repo, actor, slug);
	const raw = String(base64 || "").replace(/^data:[^,]*,/, "");
	if (!raw || !/^[A-Za-z0-9+/=s]+$/.test(raw)) fail(422, "invalid", "Choose an image file");
	const buf = Buffer.from(raw, "base64");
	if (!buf.length) fail(422, "invalid", "Choose an image file");
	if (buf.length > IMAGE_LIMITS.maxBytes) fail(413, "too_large", "Images must be 1 MB or smaller");
	const mime = sniffImage(buf);
	if (!mime) fail(415, "unsupported", "Use a PNG, JPEG, WebP or GIF image");
	if ((await repo.countImages(course.id, classId, actor.userId)) >= IMAGE_LIMITS.perSession) fail(429, "limit", "Too many images for this session");
	const img = await repo.insertImage({ id: uuidv4(), course_id: course.id, class_id: classId, uploader_id: actor.userId, mime, size: buf.length, data: buf });
	return { imageId: img.id, mime, size: buf.length };
}

// Instructor: any image of their class. Student: only images of a question that has
// been published in THEIR session (drafts and other sessions stay private).
export async function getImageForViewer(repo, actor, slug, imageId) {
	const { course, classId, role } = await getAccess(repo, actor, slug);
	const img = await repo.getImage(String(imageId || ""));
	if (!img || img.course_id !== course.id || (img.class_id || null) !== classId) fail(404, "not_found", "Image not found");
	if (role !== "instructor") {
		const used = (await repo.listQuestions(course.id, classId)).some(
			(q) => q.status !== "draft" && (q.image_id === img.id || q.options.some((o) => o.imageId === img.id))
		);
		if (!used) fail(404, "not_found", "Image not found");
	}
	return { mime: img.mime, data: img.data };
}

export async function deleteDraft(repo, actor, slug, id) {
	const { course, classId } = await requireInstructor(repo, actor, slug);
	const q = await loadQuestion(repo, course, id, classId);
	if (q.status !== "draft") fail(409, "conflict", "Only unpublished questions can be deleted");
	await repo.deleteQuestion(q.id);
	return { deleted: true };
}

// Publishing closes any other open question in this class first, so the next
// question can be launched without ending the Jitsi session.
export async function publishQuestion(repo, actor, slug, id, now = new Date()) {
	const { course, classId, session } = await requireInstructor(repo, actor, slug);
	requireLive(session);
	const q = await loadQuestion(repo, course, id, classId);
	if (q.status !== "draft") fail(409, "conflict", "This question has already been published");
	await repo.closeOpenQuestions(course.id, q.id, now, classId);
	const updated = await repo.updateQuestion(
		q.id,
		{
			status: "open",
			opened_at: now,
			closed_at: null,
			deadline_at: q.duration_sec ? new Date(now.getTime() + q.duration_sec * 1000) : null,
		},
		{ whereStatus: "draft" }
	);
	if (!updated) fail(409, "conflict", "This question has already been published");
	return instructorView(repo, updated, course, now);
}

export async function closeQuestion(repo, actor, slug, id, now = new Date()) {
	const { course, classId } = await requireInstructor(repo, actor, slug);
	let q = await settle(repo, await loadQuestion(repo, course, id, classId), now);
	if (q.status === "draft") fail(409, "conflict", "Publish the question first");
	if (q.status === "open") q =(await repo.updateQuestion(q.id, { status: "closed", closed_at: now }, { whereStatus: "open" })) || (await repo.getQuestion(q.id));
	return instructorView(repo, q, course, now);
}

// Reveal the correct answer + explanation. Revealing implies closing.
export async function revealQuestion(repo, actor, slug, id, now = new Date()) {
	const { course, classId } = await requireInstructor(repo, actor, slug);
	let q = await settle(repo, await loadQuestion(repo, course, id, classId), now);
	if (q.status === "draft") fail(409, "conflict", "Publish the question first");
	if (q.status !== "revealed") {
		q = await repo.updateQuestion(q.id, { status: "revealed", closed_at: q.closed_at || now, revealed_at: now });
	}
	return instructorView(repo, q, course, now);
}

// Release the answer distribution to students. Implies closing submissions.
export async function publishResults(repo, actor, slug, id, now = new Date()) {
	const { course, classId } = await requireInstructor(repo, actor, slug);
	let q = await settle(repo, await loadQuestion(repo, course, id, classId), now);
	if (q.status === "draft") fail(409, "conflict", "Publish the question first");
	const patch = { results_published: true };
	if (q.status === "open") Object.assign(patch, { status: "closed", closed_at: now });
	q = await repo.updateQuestion(q.id, patch);
	return instructorView(repo, q, course, now);
}

// ---------------------------------------------------------------- student

export async function submitAnswer(repo, actor, slug, id, optionId, now = new Date()) {
	const { course, role, classId, session } = await getAccess(repo, actor, slug);
	if (role !== "student") fail(403, "forbidden", "Only enrolled students answer questions");
	let q = await loadQuestion(repo, course, id, classId);
	if (q.status === "draft") fail(404, "not_found", "Question not found");
	q = await settle(repo, q, now);
	if (session && session.status !== "live") fail(409, "closed", "This session is no longer live");
	if (q.status !== "open") fail(409, "closed", "This question is no longer accepting answers");
	// Server clock decides; the client countdown is only a display.
	if (q.deadline_at && ms(q.deadline_at) < now.getTime()) fail(409, "closed", "Time is up for this question");
	const option = q.options.find((o) => o.id === String(optionId || ""));
	if (!option) fail(422, "invalid", "Choose one of the listed answers");

	const existing = await repo.getResponse(q.id, actor.userId);
	if (existing) {
		if (existing.option_id === option.id) return receipt(existing, true);
		if (!q.allow_change) fail(409, "already_answered", "You have already answered this question");
		const updated = await repo.updateResponse(existing.id, { option_id: option.id, is_correct: option.id === q.correct_option_id, submitted_at: now });
		return receipt(updated, false);
	}
	try {
		const row = await repo.insertResponse({
			id: uuidv4(),
			live_question_id: q.id,
			user_id: actor.userId,
			option_id: option.id,
			is_correct: option.id === q.correct_option_id,
			submitted_at: now,
		});
		return receipt(row, false);
	} catch (e) {
		// Lost a race with this same student's other tab/retry: the unique index
		// guarantees one row. Treat an identical answer as a duplicate success.
		if (e && e.code === "duplicate_response") {
			const again = await repo.getResponse(q.id, actor.userId);
			if (again && again.option_id === option.id) return receipt(again, true);
			fail(409, "already_answered", "You have already answered this question");
		}
		throw e;
	}
}

// Confirmation only: correctness is not disclosed until the instructor reveals.
const receipt = (r, duplicate) => ({ received: true, duplicate, optionId: r.option_id, submittedAt: iso(r.submitted_at) });

// ------------------------------------------------------------------ state

// Poll target. Idempotent and safe to call after any disconnection: it simply
// returns the current state for the caller's role.
export async function getState(repo, actor, slug, now = new Date()) {
	const { course, role, classId, session } = await getAccess(repo, actor, slug);
	const base = {
		role,
		serverTime: now.toISOString(),
		course: { id: course.id, slug: course.slug, title: course.title },
		session: session ? { id: session.id, status: session.status } : null,
	};
	const rows = await repo.listQuestions(course.id, classId);
	if (role === "instructor") {
		const settled = [];
		for (const q of rows) settled.push(await settle(repo, q, now));
		const published = settled.filter((q) => q.status !== "draft");
		const current = published.length ? published[published.length - 1] : null;
		const drafts = settled.filter((q) => q.status === "draft");
		return {
			...base,
			current: current ? await instructorView(repo, current, course, now) : null,
			drafts: drafts.map((q) => ({
				id: q.id,
				seq: q.seq,
				kind: q.question_type,
				text: q.question_text,
				imageId: q.image_id || null,
				options: q.options,
				correctIndex: q.options.findIndex((o) => o.id === q.correct_option_id),
				explanation: q.explanation || "",
				durationSec: q.duration_sec,
				allowChange: !!q.allow_change,
			})),
			history: published.map((q) => ({ id: q.id, seq: q.seq, text: q.question_text, status: q.status })),
		};
	}
	const published = rows.filter((q) => q.status !== "draft");
	const last = published.length ? await settle(repo, published[published.length - 1], now) : null;
	return { ...base, current: last ? await studentView(repo, last, actor.userId) : null };
}

// Post-class review for the instructor: every question with full results.
export async function listResults(repo, actor, slug, now = new Date()) {
	const { course, classId } = await requireInstructor(repo, actor, slug);
	const rows = (await repo.listQuestions(course.id, classId)).filter((q) => q.status !== "draft");
	const questions = [];
	for (const q of rows) questions.push(await instructorView(repo, await settle(repo, q, now), course, now));
	return { questions };
}

// A student's own results: only questions whose answers have been revealed.
export async function myResults(repo, actor, slug) {
	const { course, role, classId } = await getAccess(repo, actor, slug);
	if (role !== "student") fail(403, "forbidden", "Only students have personal results");
	const rows = (await repo.listQuestions(course.id, classId)).filter((q) => q.status === "revealed");
	const out = [];
	for (const q of rows) out.push(await studentView(repo, q, actor.userId));
	return { questions: out, correct: out.filter((q) => q.myAnswer && q.myAnswer.isCorrect).length, total: out.length };
}

// Existing SharpStudy quiz questions the instructor can copy into a live question.
export async function importableQuestions(repo, actor, slug) {
	await requireInstructor(repo, actor, slug);
	const list = await repo.listQuizQuestions(actor.userId);
	return {
		questions: list
			.filter((q) => q.options.length >= LIMITS.optionMin && q.options.length <= LIMITS.optionMax && q.options.filter((o) => o.isCorrect).length === 1)
			.map((q) => ({
				id: q.id,
				quizTitle: q.quizTitle,
				text: q.text,
				options: q.options.map((o) => o.text),
				correctIndex: q.options.findIndex((o) => o.isCorrect),
			})),
	};
}
