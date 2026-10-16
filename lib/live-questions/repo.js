// Sequelize implementation of the repository used by service.js. Keep the
// semantics identical to tests/live-questions/memoryRepo.mjs.
import { Op, UniqueConstraintError } from "sequelize";
import { Course, Enrolment, User, Quiz, Question, Answer_Option } from "@/database/models";
import { LiveQuestion, LiveQuestionResponse } from "@/database/models/live_question";
import { LiveSession, LiveSessionSeat, LiveQuestionImage } from "@/database/models/live_session";

const plain = (row) => (row ? row.get({ plain: true }) : null);

export const liveRepo = {
	// ---- class / membership (existing tables) ----
	async getCourseBySlug(slug) {
		return plain(await Course.findOne({ where: { slug }, attributes: ["id", "slug", "title", "userId"] }));
	},
	async getCourseById(id) {
		if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
		return plain(await Course.findOne({ where: { id }, attributes: ["id", "slug", "title", "userId"] }));
	},
	async isEnrolled(userId, courseId) {
		return !!(await Enrolment.findOne({ where: { userId, courseId }, attributes: ["id"] }));
	},
	// ---- scheduled sessions (lc_classes / lc_enrolments) ----
	async getSession(id) {
		return plain(await LiveSession.findByPk(id));
	},
	async getSeat(classId, key) {
		return plain(await LiveSessionSeat.findOne({ where: { class_id: classId, participant_key: key } }));
	},
	// Only a PAID enrolment counts for session access.
	async hasPaidEnrolment(userId, courseId) {
		return !!(await Enrolment.findOne({ where: { userId, courseId, status: "paid" }, attributes: ["id"] }));
	},
	async listSessionParticipants(classId) {
		const seats = await LiveSessionSeat.findAll({ where: { class_id: classId }, order: [["created_at", "ASC"]] });
		return seats.filter((s) => s.user_id).map((s) => ({ id: s.user_id, name: s.display_name }));
	},

	async listEnrolledUsers(courseId) {
		const rows = await Enrolment.findAll({
			where: { courseId },
			include: [{ model: User, as: "user", attributes: ["id", "first_name", "last_name"] }],
		});
		const seen = new Set();
		const out = [];
		for (const e of rows) {
			const u = e.user;
			if (!u || seen.has(u.id)) continue;
			seen.add(u.id);
			out.push({ id: u.id, name: `${u.first_name || ""} ${u.last_name || ""}`.trim() });
		}
		return out;
	},

	// ---- questions ----
	async getQuestion(id) {
		if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
		return plain(await LiveQuestion.findByPk(id));
	},
	// classId null = the course-level class (questions that belong to no session).
	async listQuestions(courseId, classId = null) {
		return (await LiveQuestion.findAll({ where: { course_id: courseId, class_id: classId }, order: [["seq", "ASC"]] })).map(plain);
	},
	async maxSeq(courseId, classId = null) {
		return (await LiveQuestion.max("seq", { where: { course_id: courseId, class_id: classId } })) || 0;
	},
	async insertQuestion(row) {
		return plain(await LiveQuestion.create(row));
	},
	async deleteQuestion(id) {
		await LiveQuestion.destroy({ where: { id } });
	},
	// Optional compare-and-set on status so concurrent actions cannot both win.
	async updateQuestion(id, patch, { whereStatus } = {}) {
		const where = { id };
		if (whereStatus) where.status = whereStatus;
		const [n] = await LiveQuestion.update(patch, { where });
		const row = plain(await LiveQuestion.findByPk(id));
		// 0 changed rows with identical values is not a lost race: only a status mismatch is.
		if (!n && whereStatus && (!row || row.status !== whereStatus)) return null;
		return row;
	},
	async closeOpenQuestions(courseId, exceptId, now, classId = null) {
		await LiveQuestion.update({ status: "closed", closed_at: now }, { where: { course_id: courseId, class_id: classId, status: "open", id: { [Op.ne]: exceptId } } });
	},

	// ---- images ----
	async getImage(id) {
		if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
		return plain(await LiveQuestionImage.findByPk(id));
	},
	async insertImage(row) {
		const r = plain(await LiveQuestionImage.create(row));
		return { id: r.id };
	},
	async countImages(courseId, classId, uploaderId) {
		return LiveQuestionImage.count({ where: { course_id: courseId, class_id: classId, uploader_id: uploaderId } });
	},

	// ---- responses ----
	async getResponse(questionId, userId) {
		return plain(await LiveQuestionResponse.findOne({ where: { live_question_id: questionId, user_id: userId } }));
	},
	async listResponses(questionId) {
		return (await LiveQuestionResponse.findAll({ where: { live_question_id: questionId } })).map(plain);
	},
	async insertResponse(row) {
		try {
			return plain(await LiveQuestionResponse.create(row));
		} catch (e) {
			if (e instanceof UniqueConstraintError) {
				const err = new Error("duplicate response");
				err.code = "duplicate_response";
				throw err;
			}
			throw e;
		}
	},
	async updateResponse(id, patch) {
		await LiveQuestionResponse.update(patch, { where: { id } });
		return plain(await LiveQuestionResponse.findByPk(id));
	},

	// ---- existing quiz questions an instructor can copy ----
	async listQuizQuestions(instructorId) {
		const quizzes = await Quiz.findAll({ where: { userId: instructorId }, attributes: ["id", "title"] });
		if (!quizzes.length) return [];
		const titles = new Map(quizzes.map((q) => [q.id, q.title]));
		const qs = await Question.findAll({
			where: { quizId: { [Op.in]: [...titles.keys()] } },
			include: [{ model: Answer_Option, as: "answer_options" }],
			limit: 500,
		});
		return qs.map((q) => ({
			id: q.id,
			quizTitle: titles.get(q.quizId),
			text: q.question_text,
			options: (q.answer_options || []).map((o) => ({ text: o.option_text, isCorrect: !!o.is_correct })),
		}));
	},
};

export default liveRepo;
