// Linking an account student to a learner profile, safely.
//
// Why: worksheets, grading, stars and PIN sessions exist only for learner profiles (ml_learners),
// while course students are accounts (users). The two are different identities and are never
// matched by name or e-mail. A link (ml_learners.student_user_id) is created ONLY by one of
// these explicit actions, and only by an instructor who actually teaches the student:
//
//   createStudentProfile  make a NEW profile for the student (owned by the instructor)
//   linkStudentProfile    attach a profile the instructor already manages, after an explicit confirmation
//   unlinkStudentProfile  remove a link made by mistake (the profile and its progress stay)
//
// "Teaches" = the student has a PAID enrolment in a course the instructor owns. Nothing is linked
// automatically, no progress is copied or moved, and one student can have at most one profile
// (unique index). Linking an existing profile gives the student view-only access to THAT profile's
// own progress, which is why it needs the confirmation.

import { createLearner, loadLearner, publicLearner, ServiceError } from "./service.js";
import { requireTeacher, teachingEnrolments } from "./directory.js";

const fail = (status, code, message) => {
	throw new ServiceError(status, code, message);
};

async function requireTaughtStudent(repo, actor, studentUserId) {
	requireTeacher(actor);
	const { enrolments } = await teachingEnrolments(repo, actor);
	// A student you do not teach is indistinguishable from one that does not exist.
	if (!studentUserId || !enrolments.some((e) => e.userId === String(studentUserId))) fail(404, "not_found", "Student not found");
	const [user] = await repo.getUsersByIds([String(studentUserId)]);
	if (!user) fail(404, "not_found", "Student not found");
	return user;
}

const isUnique = (e) => e && (e.name === "SequelizeUniqueConstraintError" || e.code === "ER_DUP_ENTRY" || e.code === "duplicate_link");

async function setLink(repo, learnerId, studentUserId) {
	try {
		await repo.updateLearner(learnerId, { student_user_id: studentUserId });
	} catch (e) {
		if (isUnique(e)) fail(409, "already_linked", "This student already has a learner profile");
		throw e;
	}
}

export async function createStudentProfile(repo, actor, input, ctx = {}) {
	const user = await requireTaughtStudent(repo, actor, input && input.studentUserId);
	if ((await repo.listLearnersByStudent(user.id)).length) fail(409, "already_linked", "This student already has a learner profile");
	const name = String((input.displayName || `${user.first_name || ""} ${user.last_name || ""}`).trim()).slice(0, 40);
	const learner = await createLearner(repo, actor, { ...input, displayName: name }, ctx); // validates the PIN, grade, age, limits and permission
	try {
		await setLink(repo, learner.id, user.id);
	} catch (e) {
		await repo.deleteLearner(learner.id); // never leave an orphan profile behind
		throw e;
	}
	return { learnerId: learner.id, learner: { ...learner } };
}

export async function linkStudentProfile(repo, actor, input, ctx = {}) {
	const user = await requireTaughtStudent(repo, actor, input && input.studentUserId);
	if (input.confirm !== true) fail(422, "confirm_required", "Confirm that this student should get access to this learner profile");
	const { learner } = await loadLearner(repo, actor, String(input.learnerId || ""), "place");
	if (learner.student_user_id) fail(409, "already_linked", "This learner profile is already linked to a student");
	if ((await repo.listLearnersByStudent(user.id)).length) fail(409, "already_linked", "This student already has a learner profile");
	await setLink(repo, learner.id, user.id);
	return { learnerId: learner.id, learner: publicLearner({ ...learner, student_user_id: user.id }) };
}

export async function unlinkStudentProfile(repo, actor, input) {
	requireTeacher(actor);
	const { learner } = await loadLearner(repo, actor, String((input && input.learnerId) || ""), "place");
	if (!learner.student_user_id) return { learnerId: learner.id, unlinked: false };
	await repo.updateLearner(learner.id, { student_user_id: null });
	return { learnerId: learner.id, unlinked: true };
}
