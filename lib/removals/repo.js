// Sequelize implementation of the repo used by lib/removals/service.js.
//
// Until migration 20261026000000 has been applied the table does not exist: every call that needs it answers a clear
// 503 instead of crashing the page, and everything else in the app is unaffected.
import { v4 as uuidv4 } from "uuid";
import { UniqueConstraintError } from "sequelize";
import connection from "@/database/connection";
import User from "database/models/user";
import { ML_Learner, ML_Guardian, ML_AuditLog } from "database/models/mastery";
import { StudentRemovalRequest } from "database/models/student_removal";
import { ServiceError } from "@/lib/mastery/service";
import sessionRepo from "@/lib/live-sessions/repo"; // the existing notifications repository

const plain = (r) => (r ? r.get({ plain: true }) : null);
const NOT_READY = () => new ServiceError(503, "not_ready", "Student removal requests are not available yet: the database update has not been applied.");
const missingTable = (e) => e && ((e.parent && e.parent.code === "ER_NO_SUCH_TABLE") || e.code === "ER_NO_SUCH_TABLE" || (e.original && e.original.code === "ER_NO_SUCH_TABLE"));
const guard = async (fn) => {
	try {
		return await fn();
	} catch (e) {
		if (missingTable(e)) throw NOT_READY();
		throw e;
	}
};

// Inside a transaction every query carries `transaction: t`.
function txApi(t) {
	return {
		async insertRequest(row) {
			try {
				await StudentRemovalRequest.create(row, { transaction: t });
			} catch (e) {
				if (e instanceof UniqueConstraintError) throw new ServiceError(409, "duplicate_pending", "A removal request for this student is already waiting for approval.");
				throw e;
			}
		},
		async lockRequest(id) {
			return plain(await StudentRemovalRequest.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE }));
		},
		async getLearner(id) {
			return plain(await ML_Learner.findByPk(id, { transaction: t }));
		},
		// People who look after the learner and should hear about the change: owner, linked student account, parents.
		async recipientsFor(learner) {
			const parents = await ML_Guardian.findAll({ where: { learner_id: learner.id, relation: "parent" }, attributes: ["user_id"], transaction: t });
			return [learner.owner_user_id, learner.student_user_id, ...parents.map((g) => g.user_id)].filter(Boolean);
		},
		// THE data change of an approval: this instructor's own link to this learner, and nothing else.
		async deleteInstructorLink(learnerId, instructorId) {
			// limit 1 is belt and braces: (learner_id, user_id) is already a unique index, so at most one row can match anyway
			return ML_Guardian.destroy({ where: { learner_id: learnerId, user_id: instructorId, relation: "instructor" }, limit: 1, transaction: t });
		},
		// Only a request that is still pending can be decided (the guard also protects against a race).
		async decide(id, patch) {
			const [n] = await StudentRemovalRequest.update(patch, { where: { id, status: "pending" }, transaction: t });
			return n;
		},
		async audit(row) {
			await ML_AuditLog.create({ id: uuidv4(), ...row }, { transaction: t });
		},
	};
}

const removalRepo = {
	transaction: (fn) => guard(() => connection.transaction((t) => fn(txApi(t)))),

	async getLearner(id) {
		return plain(await ML_Learner.findByPk(id));
	},
	async getGuardian(learnerId, userId) {
		return plain(await ML_Guardian.findOne({ where: { learner_id: learnerId, user_id: userId } }));
	},
	findPending: (instructorId, learnerId) => guard(async () => plain(await StudentRemovalRequest.findOne({ where: { instructor_id: instructorId, learner_id: learnerId, status: "pending" } }))),
	getRequest: (id) => guard(async () => plain(await StudentRemovalRequest.findByPk(id))),
	listByInstructor: (instructorId) => guard(async () => (await StudentRemovalRequest.findAll({ where: { instructor_id: instructorId }, order: [["created_at", "DESC"]], limit: 200 })).map(plain)),
	listAll: (status) => guard(async () => (await StudentRemovalRequest.findAll({ where: status ? { status } : {}, order: [["created_at", "DESC"]], limit: 500 })).map(plain)),
	async getUsersByIds(ids) {
		if (!ids.length) return [];
		return (await User.findAll({ where: { id: ids }, attributes: ["id", "first_name", "last_name", "email"] })).map(plain);
	},
	// Active administrators (notified of new requests).
	async listAdminIds() {
		return (await User.findAll({ where: { role: "admin", status: true }, attributes: ["id"] })).map((u) => u.id);
	},
	// Notifications: the existing repository (a duplicate dedupe_key returns null).
	insertNotification: (row) => sessionRepo.insertNotification(row),
};

export default removalRepo;
