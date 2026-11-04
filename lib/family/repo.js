// Sequelize implementation of the repository used by lib/family/service.js. It extends the Mastery
// Ladder repository (learners, guardians, users, audit) with the family tables, and must keep the same
// semantics as tests/family/memoryRepo.mjs.
import { Op, UniqueConstraintError } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import connection from "@/database/connection";
import masteryRepo from "@/lib/mastery-server/repo";
import { ML_Learner, ML_Guardian } from "@/database/models/mastery";
import { FamPin, FamPairingCode, FamDevice, FamDeviceLearner, FamLinkCode } from "@/database/models/family";

const plain = (row) => (row ? row.get({ plain: true }) : null);
const plainAll = (rows) => rows.map(plain);

async function withLearners(devices) {
	if (!devices.length) return [];
	const links = await FamDeviceLearner.findAll({ where: { device_id: { [Op.in]: devices.map((d) => d.id) } }, order: [["created_at", "ASC"]] });
	return devices.map((d) => ({ ...d, learner_ids: links.filter((l) => l.device_id === d.id).map((l) => l.learner_id) }));
}

const familyRepo = {
	...masteryRepo,

	// ---- family PIN ----
	async getFamPin(userId) {
		return plain(await FamPin.findOne({ where: { user_id: userId } }));
	},
	async upsertFamPin(userId, patch) {
		const [n] = await FamPin.update(patch, { where: { user_id: userId } });
		if (!n && patch.pin_hash) {
			try {
				await FamPin.create({ id: uuidv4(), user_id: userId, ...patch });
			} catch (e) {
				if (!(e instanceof UniqueConstraintError)) throw e;
				await FamPin.update(patch, { where: { user_id: userId } });
			}
		}
		return plain(await FamPin.findOne({ where: { user_id: userId } }));
	},

	// ---- pairing codes ----
	async createPairingCode(row) {
		try {
			return plain(await FamPairingCode.create(row));
		} catch (e) {
			if (e instanceof UniqueConstraintError) {
				const err = new Error("duplicate_code");
				err.code = "duplicate_code";
				throw err;
			}
			throw e;
		}
	},
	async getPairingCode(id) {
		return plain(await FamPairingCode.findByPk(id));
	},
	// Cancels this parent's open codes that were created strictly before `createdAt` (never the new one, never a racing sibling).
	async cancelOlderOpenCodes(createdBy, createdAt, exceptId) {
		await FamPairingCode.update({ status: "cancelled" }, { where: { created_by: createdBy, status: "open", id: { [Op.ne]: exceptId }, created_at: { [Op.lt]: createdAt } } });
	},
	// Optional compare-and-set on status. Returns the row, or null when the status was not one of `whereStatus`.
	async updatePairingCode(id, patch, { whereStatus } = {}) {
		const where = { id };
		if (whereStatus) where.status = { [Op.in]: whereStatus };
		const [n] = await FamPairingCode.update(patch, { where });
		return n ? plain(await FamPairingCode.findByPk(id)) : null;
	},
	// Atomically: the code must exist, be open and unexpired; it becomes claimed and exactly one
	// pending device is created for it (unique pairing_code_id), carrying the code's children.
	// Returns { device } or null.
	async claimPairingCode({ codeHash, now, device }) {
		return connection.transaction(async (t) => {
			const code = await FamPairingCode.findOne({ where: { code_hash: codeHash }, transaction: t, lock: t.LOCK.UPDATE });
			if (!code || code.status !== "open" || new Date(code.expires_at).getTime() <= now.getTime()) return null;
			const [n] = await FamPairingCode.update({ status: "claimed", claimed_at: now }, { where: { id: code.id, status: "open" }, transaction: t });
			if (n !== 1) return null;
			const row = await FamDevice.create({ ...device, owner_user_id: code.owner_user_id, pairing_code_id: code.id }, { transaction: t });
			const learnerIds = code.learner_ids || [];
			for (const lid of learnerIds) await FamDeviceLearner.create({ id: uuidv4(), device_id: row.id, learner_id: lid }, { transaction: t });
			return { device: { ...plain(row), learner_ids: learnerIds } };
		});
	},

	// ---- parent link codes ----
	async createLinkCode(row) {
		try {
			return plain(await FamLinkCode.create(row));
		} catch (e) {
			if (e instanceof UniqueConstraintError) {
				const err = new Error("duplicate_code");
				err.code = "duplicate_code";
				throw err;
			}
			throw e;
		}
	},
	async cancelOlderLinkCodes(learnerId, createdAt, exceptId) {
		await FamLinkCode.update({ status: "cancelled" }, { where: { learner_id: learnerId, status: "open", id: { [Op.ne]: exceptId }, created_at: { [Op.lt]: createdAt } } });
	},
	// Cancels every open code of a learner. Returns how many were open.
	async cancelOpenLinkCodes(learnerId) {
		const [n] = await FamLinkCode.update({ status: "cancelled" }, { where: { learner_id: learnerId, status: "open" } });
		return n;
	},
	async findOpenLinkCode(learnerId, now) {
		return plain(await FamLinkCode.findOne({ where: { learner_id: learnerId, status: "open", expires_at: { [Op.gt]: now } }, order: [["created_at", "DESC"]] }));
	},
	async getLinkCode(id) {
		if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
		return plain(await FamLinkCode.findByPk(id));
	},
	async getLinkCodeByHash(codeHash) {
		return plain(await FamLinkCode.findOne({ where: { code_hash: codeHash } }));
	},
	// Codes the child's own account generated for this learner since `since` (daily cap).
	async countChildLinkCodesSince(learnerId, childUserId, since) {
		return FamLinkCode.count({ where: { learner_id: learnerId, issued_by: childUserId, created_at: { [Op.gte]: since } } });
	},
	async updateLinkCode(id, patch, { whereStatus } = {}) {
		const where = { id };
		if (whereStatus) where.status = { [Op.in]: whereStatus };
		const [n] = await FamLinkCode.update(patch, { where });
		return n ? plain(await FamLinkCode.findByPk(id)) : null;
	},
	// Redeems a link code in ONE transaction: the code row is locked, every rejection is decided BEFORE anything is
	// written, and consuming the code and adding the parent guardian commit together (or neither does).
	// Returns { outcome, learner?, code? } with outcome one of:
	//   ok        linked now (or already linked as a parent: nothing duplicated); the code is used
	//   invalid   unknown, expired, used or cancelled; the learner is gone; or the code was not issued by the learner's
	//             CURRENT student account (the association changed since it was made)
	//   own       the redeeming account is the learner's own student account
	//   owner     the redeeming account owns the learner (needs no link)
	//   conflict  the account already has a different kind of access (an instructor link is never turned into a parent link)
	// Nothing is consumed unless the outcome is "ok".
	async redeemLinkCode({ codeHash, now, userId }) {
		return connection.transaction(async (t) => {
			const code = await FamLinkCode.findOne({ where: { code_hash: codeHash }, transaction: t, lock: t.LOCK.UPDATE });
			if (!code || code.status !== "open" || new Date(code.expires_at).getTime() <= now.getTime()) return { outcome: "invalid" };
			const learner = await ML_Learner.findByPk(code.learner_id, { transaction: t, lock: t.LOCK.UPDATE });
			if (!learner || !learner.student_user_id || learner.student_user_id !== code.issued_by) return { outcome: "invalid" };
			if (learner.student_user_id === userId) return { outcome: "own" };
			if (learner.owner_user_id === userId) return { outcome: "owner" };
			const existing = await ML_Guardian.findOne({ where: { learner_id: learner.id, user_id: userId }, transaction: t, lock: t.LOCK.UPDATE });
			if (existing && existing.relation !== "parent") return { outcome: "conflict" };
			const [n] = await FamLinkCode.update({ status: "used", used_by: userId, used_at: now }, { where: { id: code.id, status: "open" }, transaction: t });
			if (n !== 1) return { outcome: "invalid" };
			if (!existing) await ML_Guardian.create({ id: uuidv4(), learner_id: learner.id, user_id: userId, relation: "parent", created_by: code.issued_by }, { transaction: t });
			return { outcome: "ok", code: plain(code), learner: plain(learner) };
		});
	},

	// ---- devices ----
	async getDevice(id) {
		if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
		const d = plain(await FamDevice.findByPk(id));
		return d ? (await withLearners([d]))[0] : null;
	},
	async getDeviceByCode(codeId) {
		const d = plain(await FamDevice.findOne({ where: { pairing_code_id: codeId } }));
		return d ? (await withLearners([d]))[0] : null;
	},
	async listDevicesForLearners(learnerIds) {
		const links = await FamDeviceLearner.findAll({ where: { learner_id: { [Op.in]: learnerIds } }, attributes: ["device_id"] });
		const ids = [...new Set(links.map((l) => l.device_id))];
		if (!ids.length) return [];
		return withLearners(plainAll(await FamDevice.findAll({ where: { id: { [Op.in]: ids } }, order: [["created_at", "ASC"]] })));
	},
	async updateDevice(id, patch, { whereStatus } = {}) {
		const where = { id };
		if (whereStatus) where.status = { [Op.in]: whereStatus };
		const [n] = await FamDevice.update(patch, { where });
		return n ? this.getDevice(id) : null;
	},
};

export default familyRepo;
