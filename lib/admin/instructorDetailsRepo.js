// Read-only Sequelize queries for Admin > Instructors > one instructor. Every query is keyed by the selected
// instructor's user id (lc_classes.instructor_id / courses.userId); nothing here counts globally.
import { fn, col } from "sequelize";
import { User, Course, Category, Enrolment } from "database/models";
import { InstructorApplication, InstructorProfile } from "database/models/instructor_application";
import { LiveSession, LiveSessionSeat, LiveSessionAttendance } from "database/models/live_session";

const plain = (rows) => rows.map((r) => (r.get ? r.get({ plain: true }) : r));
// An optional source (e.g. a table not migrated yet) must not take the whole screen down.
const safely = async (p, fallback = []) => {
	try {
		return await p;
	} catch (e) {
		return fallback;
	}
};

const USER_ATTRS = ["id", "first_name", "last_name", "email", "role", "status", "created_at", "phone", "bio", "instructor_subject", "instructor_description"];

const instructorDetailsRepo = {
	async getInstructor(id) {
		const u = await User.findOne({ where: { id, role: "instructor" }, attributes: USER_ATTRS });
		return u ? u.get({ plain: true }) : null;
	},
	async getProfile(id) {
		return (await safely(InstructorProfile.findOne({ where: { user_id: id }, attributes: ["subjects"], raw: true }), null)) || null;
	},
	async getApplicationPhone(id) {
		const rows = await safely(InstructorApplication.findAll({ where: { user_id: id }, attributes: ["phone", "created_at"], order: [["created_at", "DESC"]], raw: true }));
		return rows.find((r) => r.phone) || null;
	},
	// Only this instructor's sessions. Meeting links, room names and descriptions are deliberately not selected.
	async listSessions(instructorId) {
		return plain(
			await LiveSession.findAll({
				where: { instructor_id: instructorId },
				attributes: ["id", "title", "subject", "course_id", "start_at", "end_at", "time_zone", "status", "started_at", "ended_at", "cancelled_at", "session_type", "capacity"],
				order: [["start_at", "DESC"]],
			})
		);
	},
	async listSeats(classIds) {
		if (!classIds.length) return [];
		return plain(await LiveSessionSeat.findAll({ where: { class_id: classIds }, attributes: ["class_id", "participant_key", "user_id"] }));
	},
	async listAttendance(classIds) {
		if (!classIds.length) return [];
		return plain(await LiveSessionAttendance.findAll({ where: { class_id: classIds }, attributes: ["class_id", "participant_key", "display_name", "status", "total_seconds"] }));
	},
	async listCourses(instructorId) {
		const rows = plain(await Course.findAll({ where: { userId: instructorId }, attributes: ["id", "title", "approved", "created_at"], include: [{ model: Category, as: "category", attributes: ["name"] }] }));
		return rows.map((c) => ({ ...c, category: c.category ? c.category.name : null }));
	},
	async courseTitles(ids) {
		if (!ids.length) return new Map();
		return new Map(plain(await Course.findAll({ where: { id: ids }, attributes: ["id", "title"] })).map((c) => [c.id, c.title]));
	},
	// Paid course enrolments per course. This is NOT live-class attendance and is never combined with it.
	async enrolmentCounts(courseIds) {
		if (!courseIds.length) return new Map();
		const rows = await Enrolment.findAll({ where: { courseId: courseIds, status: "paid" }, attributes: ["courseId", [fn("COUNT", col("id")), "n"]], group: ["courseId"], raw: true });
		return new Map(rows.map((r) => [r.courseId, Number(r.n)]));
	},
	// Name + email only (what the admin Students page already shows); no phone, bio or credentials.
	async studentUsers(userIds) {
		if (!userIds.length) return new Map();
		return new Map(plain(await User.findAll({ where: { id: userIds }, attributes: ["id", "first_name", "last_name", "email"] })).map((u) => [u.id, u]));
	},
};

export default instructorDetailsRepo;
