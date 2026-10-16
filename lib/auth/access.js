// Server-side resource access checks for the legacy course / quiz routes.
// Identity and role always come from the verified token + database
// (getAccountActor); ids supplied by the browser are only ever looked up.
import { Course, Enrolment, Video, Course_Asset, Quiz, Question, Answer_Option } from "@/database/models";
import { getAccountActor } from "@/lib/mastery-server/http";
import { requireRole } from "./requireRole";

export const ANY_ROLE = ["student", "instructor", "admin"];
export const TEACHER_ROLES = ["instructor", "admin"];

// 401 for missing/invalid tokens, 403 for roles outside `roles`. Returns the actor or null.
export const requireUser = (req, res, roles = ANY_ROLE) => requireRole(req, res, roles);

export const optionalActor = (req) => (req.headers.authorization ? getAccountActor(req) : null);

const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// -> { course, owner, admin, enrolled }  (course null when it does not exist)
export async function courseAccess(actor, courseId) {
	if (!isUuid(courseId)) return { course: null };
	const course = await Course.findOne({ where: { id: courseId }, attributes: ["id", "userId", "slug", "title", "approved"] });
	if (!course || !actor) return { course };
	const owner = course.userId === actor.userId;
	const admin = actor.role === "admin";
	const enrolled = owner || admin ? false : !!(await Enrolment.findOne({ where: { userId: actor.userId, courseId: course.id }, attributes: ["id"] }));
	return { course, owner, admin, enrolled };
}

// Writes `status` and returns false when the caller may not manage the course.
export async function requireCourseManager(res, actor, courseId) {
	const a = await courseAccess(actor, courseId);
	if (!a.course) {
		res.status(404).json({ message: "Course not found" });
		return null;
	}
	if (!(a.owner || a.admin)) {
		res.status(403).json({ message: "You do not manage this course" });
		return null;
	}
	return a.course;
}

// Resolve a row to its course and require management of that course (404 for missing rows).
async function manageViaRow(res, actor, row, courseIdOf, notFound) {
	if (!row) {
		res.status(404).json({ message: notFound });
		return null;
	}
	const course = await requireCourseManager(res, actor, await courseIdOf(row));
	return course ? row : null;
}

export const requireAssetManager = async (res, actor, assetId) =>
	manageViaRow(res, actor, isUuid(assetId) ? await Course_Asset.findOne({ where: { id: assetId } }) : null, (a) => a.courseId, "Asset not found");

export const requireVideoManager = async (res, actor, videoId) =>
	manageViaRow(res, actor, isUuid(videoId) ? await Video.findOne({ where: { id: videoId } }) : null, (v) => v.courseId, "Video not found");

export const requireQuizManager = async (res, actor, quizId) =>
	manageViaRow(res, actor, isUuid(quizId) ? await Quiz.findOne({ where: { id: quizId } }) : null, (q) => q.courseId, "Quiz not found");

// A quiz is managed by its creator or an admin (a quiz belongs to its creator, as before).
export async function requireQuizOwner(res, actor, quizId) {
	const quiz = isUuid(quizId) ? await Quiz.findOne({ where: { id: quizId } }) : null;
	if (!quiz) {
		res.status(404).json({ message: "Quiz not found" });
		return null;
	}
	if (quiz.userId !== actor.userId && actor.role !== "admin") {
		res.status(403).json({ message: "You do not manage this quiz" });
		return null;
	}
	return quiz;
}

export async function requireQuestionOwner(res, actor, questionId) {
	const question = isUuid(questionId) ? await Question.findOne({ where: { id: questionId } }) : null;
	if (!question) {
		res.status(404).json({ message: "Question not found" });
		return null;
	}
	return (await requireQuizOwner(res, actor, question.quizId)) ? question : null;
}

export async function requireAnswerOptionOwner(res, actor, optionId) {
	const option = isUuid(optionId) ? await Answer_Option.findOne({ where: { id: optionId } }) : null;
	if (!option) {
		res.status(404).json({ message: "Answer option not found" });
		return null;
	}
	return (await requireQuestionOwner(res, actor, option.questionId)) ? option : null;
}
