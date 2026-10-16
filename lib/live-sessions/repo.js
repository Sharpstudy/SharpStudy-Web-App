// Sequelize implementation of the repository used by service.js. Keep the
// semantics identical to tests/live-sessions/memoryRepo.mjs.
import { Op, Transaction, UniqueConstraintError } from "sequelize";
import connection from "@/database/connection";
import { Course, Enrolment } from "@/database/models";
import User from "@/database/models/user";
import { LiveSession, LiveSessionSeat, LiveSessionAttendance, Notification } from "@/database/models/live_session";

const plain = (row) => (row ? row.get({ plain: true }) : null);
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));
const ACTIVE = ["scheduled", "live"];

const duplicate = (code) => (e) => {
	if (e instanceof UniqueConstraintError) {
		const err = new Error(code);
		err.code = code;
		throw err;
	}
	throw e;
};

// `t` is the open transaction inside atomic(), undefined otherwise.
function makeRepo(t) {
	const tx = t ? { transaction: t } : {};
	return {
		// Run fn(repo) in a transaction after locking the row the key names, so
		// concurrent seat takes (session:<id>) or schedule changes (instructor:<id>)
		// are serialised. READ COMMITTED: reads after the lock see the winner's commit.
		// key: "session:<id>" | "instructor:<userId>" | "student:<userId>", or a list of them.
		// Locks are taken in sorted order so two callers can never deadlock each other.
		async atomic(keys, fn) {
			const list = [...new Set([].concat(keys))].sort();
			return connection.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (inner) => {
				for (const key of list) {
					const [kind, id] = String(key).split(":");
					if (!isUuid(id)) continue;
					if (kind === "session") await LiveSession.findByPk(id, { transaction: inner, lock: inner.LOCK.UPDATE });
					else await User.findByPk(id, { attributes: ["id"], transaction: inner, lock: inner.LOCK.UPDATE });
				}
				return fn(makeRepo(inner));
			});
		},

		// ---- existing tables ----
		async getCourses(ids) {
			const list = (ids || []).filter(isUuid);
			if (!list.length) return [];
			return (await Course.findAll({ where: { id: { [Op.in]: list } }, attributes: ["id", "title", "slug", "userId"], ...tx })).map(plain);
		},
		// Only a PAID enrolment grants live-session access.
		async hasPaidEnrolment(userId, courseId) {
			return !!(await Enrolment.findOne({ where: { userId, courseId, status: "paid" }, attributes: ["id"], ...tx }));
		},
		// Paid students of a course (optionally only these ids): { id, name, email, emailConfirmed }.
		async listEligibleStudents(courseId, { ids } = {}) {
			const where = { courseId, status: "paid" };
			if (ids) where.userId = { [Op.in]: ids.filter(isUuid) };
			const rows = await Enrolment.findAll({ where, include: [{ model: User, as: "user", attributes: ["id", "first_name", "last_name", "email", "status"] }], ...tx });
			const seen = new Set();
			const out = [];
			for (const e of rows) {
				const u = e.user;
				if (!u || u.status === false || seen.has(u.id)) continue;
				seen.add(u.id);
				out.push({ id: u.id, name: `${u.first_name || ""} ${u.last_name || ""}`.trim(), email: u.email });
			}
			return out.sort((a, b) => a.name.localeCompare(b.name));
		},
		async listPaidCourseIds(userId) {
			return (await Enrolment.findAll({ where: { userId, status: "paid" }, attributes: ["courseId"], ...tx })).map((e) => e.courseId);
		},

		// ---- sessions ----
		async getSession(id) {
			if (!isUuid(id)) return null;
			return plain(await LiveSession.findByPk(id, tx));
		},
		async insertSession(row) {
			return plain(await LiveSession.create(row, tx));
		},
		// Optional compare-and-set on status so concurrent actions cannot both win.
		async updateSession(id, patch, { whereStatus } = {}) {
			const where = { id };
			if (whereStatus) where.status = whereStatus;
			const [n] = await LiveSession.update(patch, { where, ...tx });
			const row = plain(await LiveSession.findByPk(id, tx));
			// MySQL reports 0 changed rows when the values are identical (e.g. a retried reschedule). That is
			// still a success as long as the row is in the status we expected; only a lost race returns null.
			if (!n && whereStatus && (!row || row.status !== whereStatus)) return null;
			return row;
		},
		async getSessionsByIds(ids) {
			const list = (ids || []).filter(isUuid);
			if (!list.length) return [];
			return (await LiveSession.findAll({ where: { id: { [Op.in]: list } }, ...tx })).map(plain);
		},
		async listActiveSessions(instructorId) {
			return (await LiveSession.findAll({ where: { instructor_id: instructorId, status: { [Op.in]: ACTIVE } }, ...tx })).map(plain);
		},
		async listInstructorSessions(instructorId) {
			return (await LiveSession.findAll({ where: { instructor_id: instructorId }, order: [["start_at", "ASC"]], limit: 500, ...tx })).map(plain);
		},
		async listAllSessions() {
			return (await LiveSession.findAll({ order: [["start_at", "ASC"]], limit: 500, ...tx })).map(plain);
		},
		async listSessionsForParticipant(key) {
			const seats = await LiveSessionSeat.findAll({ where: { participant_key: key }, attributes: ["class_id"], ...tx });
			if (!seats.length) return [];
			return (await LiveSession.findAll({ where: { id: { [Op.in]: seats.map((s) => s.class_id) } }, ...tx })).map(plain);
		},
		async listOpenSessionsForCourses(courseIds, now) {
			if (!courseIds.length) return [];
			return (await LiveSession.findAll({ where: { course_id: { [Op.in]: courseIds }, status: "scheduled", end_at: { [Op.gt]: now } }, limit: 500, ...tx })).map(plain);
		},

		// ---- seats ----
		async getSeat(classId, key) {
			return plain(await LiveSessionSeat.findOne({ where: { class_id: classId, participant_key: key }, ...tx }));
		},
		async countSeats(classId) {
			return LiveSessionSeat.count({ where: { class_id: classId }, ...tx });
		},
		async listSeats(classId) {
			return (await LiveSessionSeat.findAll({ where: { class_id: classId }, order: [["created_at", "ASC"]], ...tx })).map(plain);
		},
		async insertSeat(row) {
			return plain(await LiveSessionSeat.create(row, tx).catch(duplicate("duplicate_seat")));
		},
		async deleteSeat(classId, key) {
			await LiveSessionSeat.destroy({ where: { class_id: classId, participant_key: key }, ...tx });
		},

		// ---- attendance (one row per participant per session) ----
		async getAttendance(classId, key) {
			return plain(await LiveSessionAttendance.findOne({ where: { class_id: classId, participant_key: key }, ...tx }));
		},
		async listAttendance(classId) {
			return (await LiveSessionAttendance.findAll({ where: { class_id: classId }, ...tx })).map(plain);
		},
		async insertAttendance(row) {
			return plain(await LiveSessionAttendance.create(row, tx).catch(duplicate("duplicate_attendance")));
		},
		async updateAttendance(id, patch) {
			await LiveSessionAttendance.update(patch, { where: { id }, ...tx });
		},

		// ---- users / notifications ----
		async getUsers(ids) {
			const list = (ids || []).filter(isUuid);
			if (!list.length) return [];
			const rows = await User.findAll({ where: { id: { [Op.in]: list } }, attributes: ["id", "first_name", "last_name", "email", "email_confirmed"], ...tx });
			return rows.map((u) => ({ id: u.id, name: `${u.first_name || ""} ${u.last_name || ""}`.trim(), email: u.email, emailConfirmed: !!u.email_confirmed }));
		},
		// Returns the new row, or null when the dedupe_key already exists (a retry).
		async insertNotification(row) {
			try {
				return plain(await Notification.create(row, tx));
			} catch (e) {
				if (e instanceof UniqueConstraintError) return null;
				throw e;
			}
		},
		async updateNotification(id, patch) {
			await Notification.update(patch, { where: { id }, ...tx });
		},
		async listNotifications(userId, limit = 30) {
			return (await Notification.findAll({ where: { user_id: userId }, order: [["created_at", "DESC"]], limit, ...tx })).map(plain);
		},
		async countUnread(userId) {
			return Notification.count({ where: { user_id: userId, read_at: null }, ...tx });
		},
		async markRead(userId, ids, now) {
			const where = { user_id: userId, read_at: null };
			if (ids) where.id = { [Op.in]: ids.filter(isUuid) };
			await Notification.update({ read_at: now }, { where, ...tx });
		},
	};
}

export const sessionRepo = makeRepo();
export default sessionRepo;
