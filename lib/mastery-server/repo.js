// Sequelize implementation of the Mastery Ladder repository used by
// lib/mastery/service.js. Must keep the same semantics as
// tests/mastery/memoryRepo.mjs (which the service tests run against).
import { Op, UniqueConstraintError, QueryTypes } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import connection from "@/database/connection";
import User from "@/database/models/user";
import Course from "@/database/models/course";
import { Enrolment, Video, Course_Progress } from "@/database/models";
import {
	ML_Learner,
	ML_Guardian,
	ML_Enrolment,
	ML_Progress,
	ML_Attempt,
	ML_DailyActivity,
	ML_HintEvent,
	ML_AuditLog,
	ML_Feedback,
	ML_Setting,
	ML_Role,
	ML_UserRole,
	ML_Presence,
	ML_Assignment,
	ML_AssignmentTarget,
} from "@/database/models/mastery";

const plain = (row) => (row ? row.get({ plain: true }) : null);
const plainAll = (rows) => rows.map(plain);
const SAFE_USER_ATTRS = ["id", "first_name", "last_name", "email", "role", "status", "created_at"];

const repo = {
	// ---- users ----
	async getUser(id) {
		return plain(await User.findByPk(id, { attributes: SAFE_USER_ATTRS }));
	},
	// Includes the password hash; only for re-authentication checks.
	async getUserWithPassword(id) {
		return plain(await User.unscoped().findByPk(id, { attributes: [...SAFE_USER_ATTRS, "password"] }));
	},
	async findUserByEmail(email) {
		return plain(await User.findOne({ where: { email }, attributes: SAFE_USER_ATTRS }));
	},
	async listUsers({ q = "", limit = 50, offset = 0 } = {}) {
		const where = q
			? { [Op.or]: [{ email: { [Op.like]: `%${q}%` } }, { first_name: { [Op.like]: `%${q}%` } }, { last_name: { [Op.like]: `%${q}%` } }] }
			: {};
		const { rows, count } = await User.findAndCountAll({
			where,
			attributes: SAFE_USER_ATTRS,
			order: [["created_at", "DESC"]],
			limit,
			offset,
		});
		return { rows: plainAll(rows), count };
	},
	async setUserRole(id, role) {
		await User.update({ role }, { where: { id } });
	},

	// ---- roles ----
	async listRoles() {
		return plainAll(await ML_Role.findAll({ order: [["name", "ASC"]] }));
	},
	async getRole(id) {
		return plain(await ML_Role.findByPk(id));
	},
	async createRole(r) {
		return plain(await ML_Role.create({ id: uuidv4(), ...r }));
	},
	async updateRole(id, patch) {
		await ML_Role.update(patch, { where: { id } });
		return plain(await ML_Role.findByPk(id));
	},
	async deleteRole(id) {
		await ML_UserRole.destroy({ where: { role_id: id } });
		await ML_Role.destroy({ where: { id } });
	},
	async getUserRoleIds(userId) {
		return (await ML_UserRole.findAll({ where: { user_id: userId } })).map((r) => r.role_id);
	},
	async setUserRoles(userId, roleIds) {
		await connection.transaction(async (transaction) => {
			await ML_UserRole.destroy({ where: { user_id: userId }, transaction });
			for (const role_id of roleIds) await ML_UserRole.create({ id: uuidv4(), user_id: userId, role_id }, { transaction });
		});
	},
	async permissionsForUser(userId) {
		const ids = await repo.getUserRoleIds(userId);
		if (!ids.length) return [];
		const roles = await ML_Role.findAll({ where: { id: ids } });
		return roles.flatMap((r) => (Array.isArray(r.permissions) ? r.permissions : []));
	},

	// ---- learners ----
	async getLearner(id) {
		return plain(await ML_Learner.findByPk(id));
	},
	async listLearnersByOwner(userId) {
		return plainAll(await ML_Learner.findAll({ where: { owner_user_id: userId }, order: [["created_at", "ASC"]] }));
	},
	async listLearnersByGuardian(userId) {
		const links = await ML_Guardian.findAll({ where: { user_id: userId } });
		if (!links.length) return [];
		const learners = await ML_Learner.findAll({ where: { id: links.map((l) => l.learner_id) } });
		return learners.map((l) => ({ ...plain(l), _relation: links.find((x) => x.learner_id === l.id).relation }));
	},
	async listAllLearners({ q = "", limit = 50, offset = 0 } = {}) {
		const where = q ? { display_name: { [Op.like]: `%${q}%` } } : {};
		const rows = plainAll(await ML_Learner.findAll({ where, order: [["created_at", "DESC"]], limit, offset }));
		const owners = await User.findAll({ where: { id: [...new Set(rows.map((r) => r.owner_user_id))] }, attributes: ["id", "email"] });
		return rows.map((r) => ({ ...r, _ownerEmail: (owners.find((o) => o.id === r.owner_user_id) || {}).email }));
	},
	async createLearner(row) {
		return plain(await ML_Learner.create(row));
	},
	async updateLearner(id, patch) {
		await ML_Learner.update(patch, { where: { id } });
		return plain(await ML_Learner.findByPk(id));
	},
	async deleteLearner(id) {
		// Child rows are removed by ON DELETE CASCADE foreign keys.
		await ML_Learner.destroy({ where: { id } });
	},

	// ---- guardians ----
	async getGuardian(learnerId, userId) {
		return plain(await ML_Guardian.findOne({ where: { learner_id: learnerId, user_id: userId } }));
	},
	async listGuardians(learnerId) {
		const links = await ML_Guardian.findAll({ where: { learner_id: learnerId } });
		const users = await User.findAll({ where: { id: links.map((l) => l.user_id) }, attributes: ["id", "email", "first_name", "last_name"] });
		return links.map((l) => {
			const u = users.find((x) => x.id === l.user_id);
			return { userId: l.user_id, relation: l.relation, email: u && u.email, name: u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : "" };
		});
	},
	async addGuardian(row) {
		try {
			await ML_Guardian.create({ id: uuidv4(), ...row });
		} catch (e) {
			if (!(e instanceof UniqueConstraintError)) throw e;
			await ML_Guardian.update({ relation: row.relation }, { where: { learner_id: row.learner_id, user_id: row.user_id } });
		}
	},
	async removeGuardian(learnerId, userId) {
		await ML_Guardian.destroy({ where: { learner_id: learnerId, user_id: userId } });
	},

	// ---- enrolments ----
	async listEnrolments(learnerId) {
		return plainAll(await ML_Enrolment.findAll({ where: { learner_id: learnerId } }));
	},
	async upsertEnrolment(learnerId, subject, active) {
		const [n] = await ML_Enrolment.update({ active }, { where: { learner_id: learnerId, subject } });
		if (n === 0) {
			try {
				await ML_Enrolment.create({ id: uuidv4(), learner_id: learnerId, subject, active });
			} catch (e) {
				if (!(e instanceof UniqueConstraintError)) throw e;
				await ML_Enrolment.update({ active }, { where: { learner_id: learnerId, subject } });
			}
		}
	},

	// ---- progress ----
	async getProgress(learnerId, subject) {
		return plain(await ML_Progress.findOne({ where: { learner_id: learnerId, subject } }));
	},
	// Compare-and-set on `version` unless force is true. Returns true if applied.
	async upsertProgress(learnerId, subject, pos, { expectedVersion, force, by } = {}) {
		const values = { level_id: pos.levelId, set_id: pos.setId, worksheet_no: pos.worksheetNo, updated_by: by || null };
		const where = { learner_id: learnerId, subject };
		if (!force) where.version = expectedVersion;
		const [n] = await ML_Progress.update(
			{ ...values, version: connection.literal("version + 1") },
			{ where }
		);
		if (n > 0) return true;
		if (!force) return false;
		try {
			await ML_Progress.create({ id: uuidv4(), learner_id: learnerId, subject, version: 1, ...values });
			return true;
		} catch (e) {
			if (!(e instanceof UniqueConstraintError)) throw e;
			await ML_Progress.update({ ...values, version: connection.literal("version + 1") }, { where: { learner_id: learnerId, subject } });
			return true;
		}
	},

	// ---- attempts ----
	async findAttemptByClientId(learnerId, clientAttemptId) {
		return plain(await ML_Attempt.findOne({ where: { learner_id: learnerId, client_attempt_id: clientAttemptId } }));
	},
	async countAttempts(learnerId, { subject, levelId, setId, worksheetNo }) {
		return ML_Attempt.count({
			where: { learner_id: learnerId, subject, level_id: levelId, set_id: setId, worksheet_no: worksheetNo },
		});
	},
	// Returns false when (learner_id, client_attempt_id) already exists.
	async createAttempt(row) {
		try {
			await ML_Attempt.create(row);
			return true;
		} catch (e) {
			if (e instanceof UniqueConstraintError) return false;
			throw e;
		}
	},
	// ---- instructor student directory (course students + their explicit learner link) ----
	async listLearnersByStudent(userId) {
		return plainAll(await ML_Learner.findAll({ where: { student_user_id: userId } }));
	},
	async listCoursesByOwner(userId, { all = false } = {}) {
		return plainAll(await Course.findAll({ where: all ? {} : { userId }, attributes: ["id", "title", "userId"], order: [["title", "ASC"]] }));
	},
	// Paid enrolments only (checkout creates them as "paid"); one row per (student, course).
	async listPaidEnrolments(courseIds) {
		if (!courseIds.length) return [];
		return plainAll(await Enrolment.findAll({ where: { courseId: { [Op.in]: courseIds }, status: "paid" }, attributes: ["userId", "courseId", "created_at"] }));
	},
	async getUsersByIds(ids) {
		if (!ids.length) return [];
		return plainAll(await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "first_name", "last_name", "email", "profile_photo"] }));
	},
	// { totals: { courseId: lessons }, done: { "userId|courseId": finishedLessons } }
	async lessonStats(courseIds, userIds) {
		const totals = {};
		const done = {};
		for (const id of courseIds) totals[id] = await Video.count({ where: { courseId: id } });
		if (userIds.length && courseIds.length) {
			const rows = await Course_Progress.findAll({ where: { courseId: { [Op.in]: courseIds }, userId: { [Op.in]: userIds }, finished: true }, attributes: ["userId", "courseId"] });
			for (const r of rows) done[`${r.userId}|${r.courseId}`] = (done[`${r.userId}|${r.courseId}`] || 0) + 1;
		}
		return { totals, done };
	},
	async getCourseOwner(courseId) {
		if (!/^[0-9a-f-]{36}$/i.test(String(courseId))) return null;
		return plain(await Course.findOne({ where: { id: courseId }, attributes: ["id", "userId"] }));
	},
	// ---- assignments (instructor -> learner worksheets) ----
	// The assignment and all of its targets are created together or not at all.
	async createAssignment(row, learnerIds) {
		return connection.transaction(async (transaction) => {
			const a = await ML_Assignment.create(row, { transaction });
			await ML_AssignmentTarget.bulkCreate(learnerIds.map((learner_id) => ({ id: uuidv4(), assignment_id: a.id, learner_id })), { transaction });
			return plain(a);
		});
	},
	async getAssignment(id) {
		if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
		return plain(await ML_Assignment.findByPk(id));
	},
	async updateAssignment(id, patch) {
		await ML_Assignment.update(patch, { where: { id } });
		return plain(await ML_Assignment.findByPk(id));
	},
	async getAssignmentTarget(assignmentId, learnerId) {
		return plain(await ML_AssignmentTarget.findOne({ where: { assignment_id: assignmentId, learner_id: learnerId } }));
	},
	async listAssignmentTargets(assignmentId) {
		return plainAll(await ML_AssignmentTarget.findAll({ where: { assignment_id: assignmentId } }));
	},
	// First start only; a repeat start changes nothing. Returns true when this call set it.
	async markAssignmentStarted(assignmentId, learnerId, at) {
		const [n] = await ML_AssignmentTarget.update({ started_at: at }, { where: { assignment_id: assignmentId, learner_id: learnerId, started_at: null } });
		return n > 0;
	},
	// Completion is set once, by the request that stored the graded attempt.
	async markAssignmentCompleted(assignmentId, learnerId, { attemptId, at }) {
		const [n] = await ML_AssignmentTarget.update({ attempt_id: attemptId, completed_at: at }, { where: { assignment_id: assignmentId, learner_id: learnerId, completed_at: null } });
		return n > 0;
	},
	// [{ assignment, target }] for these learners (optionally only those created by one instructor).
	async listAssignmentRows({ learnerIds, createdBy } = {}) {
		if (!learnerIds || !learnerIds.length) return [];
		const targets = plainAll(await ML_AssignmentTarget.findAll({ where: { learner_id: { [Op.in]: learnerIds } } }));
		if (!targets.length) return [];
		const where = { id: { [Op.in]: [...new Set(targets.map((t) => t.assignment_id))] } };
		if (createdBy) where.created_by = createdBy;
		const byId = new Map(plainAll(await ML_Assignment.findAll({ where })).map((a) => [a.id, a]));
		return targets.filter((t) => byId.has(t.assignment_id)).map((t) => ({ assignment: byId.get(t.assignment_id), target: t }));
	},
	async getAttemptsByIds(ids) {
		if (!ids.length) return [];
		return plainAll(await ML_Attempt.findAll({ where: { id: { [Op.in]: ids } }, attributes: { exclude: ["responses"] } }));
	},
	async updateAttempt(id, patch) {
		await ML_Attempt.update(patch, { where: { id } });
	},
	async listAttempts(learnerId, { limit = 25, subject } = {}) {
		const where = { learner_id: learnerId };
		if (subject) where.subject = subject;
		return plainAll(
			await ML_Attempt.findAll({
				where,
				attributes: { exclude: ["responses"] },
				order: [["completed_at", "DESC"]],
				limit,
			})
		);
	},
	async attemptStats(learnerId) {
		const [r] = await connection.query(
			`SELECT COUNT(*) AS count, COALESCE(SUM(accuracy), 0) AS accuracySum, COALESCE(SUM(duration_ms), 0) AS durationMsSum,
			        COALESCE(SUM(hints_used), 0) AS hintsSum, MAX(completed_at) AS lastCompletedAt
			   FROM ml_attempts WHERE learner_id = :learnerId`,
			{ replacements: { learnerId }, type: QueryTypes.SELECT }
		);
		return {
			count: Number(r.count),
			accuracySum: Number(r.accuracySum),
			durationMsSum: Number(r.durationMsSum),
			hintsSum: Number(r.hintsSum),
			lastCompletedAt: r.lastCompletedAt,
		};
	},
	async deleteAttempts(learnerId, subject) {
		const where = { learner_id: learnerId };
		if (subject) where.subject = subject;
		await ML_Attempt.destroy({ where });
	},

	// ---- daily activity ----
	async listActivity(learnerId, from, to) {
		return plainAll(
			await ML_DailyActivity.findAll({
				where: { learner_id: learnerId, local_date: { [Op.between]: [from, to] } },
				order: [["local_date", "ASC"]],
			})
		);
	},
	// Atomic increment keyed on (learner_id, local_date).
	async addActivity(learnerId, date, delta) {
		await connection.query(
			`INSERT INTO ml_daily_activity (id, learner_id, local_date, worksheets, stars, seconds, created_at, updated_at)
			 VALUES (:id, :learnerId, :date, :w, :s, :sec, UTC_TIMESTAMP(), UTC_TIMESTAMP())
			 ON DUPLICATE KEY UPDATE worksheets = worksheets + :w, stars = stars + :s, seconds = seconds + :sec, updated_at = UTC_TIMESTAMP()`,
			{
				replacements: { id: uuidv4(), learnerId, date, w: delta.worksheets || 0, s: delta.stars || 0, sec: delta.seconds || 0 },
				type: QueryTypes.INSERT,
			}
		);
	},
	async deleteActivity(learnerId) {
		await ML_DailyActivity.destroy({ where: { learner_id: learnerId } });
	},

	// ---- hints ----
	async addHintEvent(row) {
		await ML_HintEvent.create({ id: uuidv4(), ...row });
	},
	async countHints(sessionId) {
		return ML_HintEvent.count({ where: { session_id: sessionId } });
	},

	// ---- audit ----
	async addAudit(row) {
		await ML_AuditLog.create({ id: uuidv4(), ...row });
	},
	async listAudit({ action, learnerId, actorUserId, limit = 50, offset = 0 } = {}) {
		const where = {};
		if (action) where.action = action;
		if (learnerId) where.learner_id = learnerId;
		if (actorUserId) where.actor_user_id = actorUserId;
		const { rows, count } = await ML_AuditLog.findAndCountAll({ where, order: [["created_at", "DESC"]], limit, offset });
		return { rows: plainAll(rows), count };
	},

	// ---- settings ----
	async getSetting(key) {
		const row = await ML_Setting.findByPk(key);
		return row ? row.value : null;
	},
	async setSetting(key, value, userId) {
		await ML_Setting.upsert({ key, value, updated_by: userId || null });
	},

	// ---- feedback ----
	async createFeedback(row) {
		return plain(await ML_Feedback.create({ id: uuidv4(), ...row }));
	},
	async listFeedback({ status, limit = 50, offset = 0 } = {}) {
		const where = status ? { status } : {};
		const { rows, count } = await ML_Feedback.findAndCountAll({
			where,
			attributes: { exclude: ["screenshot"], include: [[connection.literal("screenshot IS NOT NULL"), "has_screenshot"]] },
			order: [["created_at", "DESC"]],
			limit,
			offset,
		});
		return { rows: plainAll(rows), count };
	},
	async getFeedback(id) {
		return plain(await ML_Feedback.findByPk(id));
	},
	async updateFeedback(id, patch) {
		await ML_Feedback.update(patch, { where: { id } });
	},

	// ---- presence ----
	async touchPresence(kind, subjectId, path) {
		await connection.query(
			`INSERT INTO ml_presence (id, kind, subject_id, path, last_seen_at, created_at, updated_at)
			 VALUES (:id, :kind, :subjectId, :path, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
			 ON DUPLICATE KEY UPDATE path = :path, last_seen_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()`,
			{ replacements: { id: uuidv4(), kind, subjectId, path: path || null }, type: QueryTypes.INSERT }
		);
	},
	async listPresence(since) {
		return plainAll(await ML_Presence.findAll({ where: { last_seen_at: { [Op.gte]: since } }, order: [["last_seen_at", "DESC"]], limit: 500 }));
	},

	// ---- global reset ----
	async globalReset(firstPositions) {
		return connection.transaction(async (transaction) => {
			const attempts = await ML_Attempt.count({ transaction });
			const activity = await ML_DailyActivity.count({ transaction });
			const progress = await ML_Progress.count({ transaction });
			await ML_Attempt.destroy({ where: {}, transaction });
			await ML_DailyActivity.destroy({ where: {}, transaction });
			await ML_HintEvent.destroy({ where: {}, transaction });
			for (const [subject, pos] of Object.entries(firstPositions)) {
				if (!pos) continue;
				await ML_Progress.update(
					{ level_id: pos.levelId, set_id: pos.setId, worksheet_no: pos.worksheetNo, version: connection.literal("version + 1"), updated_by: "global_reset" },
					{ where: { subject }, transaction }
				);
			}
			return { attempts, activity, progress };
		});
	},
};

export default repo;
