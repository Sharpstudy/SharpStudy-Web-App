// Sequelize implementation of the repository used by lib/telecallers/service.js (same semantics as
// tests/telecallers/memoryRepo.mjs). All queries are parameterised through Sequelize.
//
// Resume bytes: TelecallerResume's default scope excludes `data`, so no list / view query can load a file by accident;
// only getResumeWithData() reads it. Events and resumes are insert-only here (the single exception is the e-mail
// delivery bookkeeping column on an event, setEventEmail).
import { Op, UniqueConstraintError, fn, col } from "sequelize";
import connection from "@/database/connection";
import User from "@/database/models/user";
import { ML_Learner } from "@/database/models/mastery";
import { TelecallerApplication, TelecallerApplicationEvent, TelecallerResume, TelecallerProfile } from "@/database/models/telecaller";
import sessionRepo from "@/lib/live-sessions/repo"; // the existing notifications repository
import { createColumnProbe, eventAttributes, eventRow } from "./snapshotColumn";

// Whether telecaller_application_events.form_snapshot exists yet (migration 20261029000000). Until it does, events are read
// without it and written without it, so nothing breaks before the migration is applied.
const hasSnapshotColumn = createColumnProbe(() => connection.getQueryInterface().describeTable("telecaller_application_events"));

const plain = (row) => (row ? row.get({ plain: true }) : null);
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const USER_ATTRS = ["id", "email", "first_name", "last_name", "role", "email_confirmed", "status", "phone", "profile_photo"];
const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const fullName = (u) => (u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : "");

// Users whose name or e-mail matches (used by the admin search boxes).
async function usersLike(q) {
	const like = `%${likeEscape(q)}%`;
	return (await User.findAll({ where: { [Op.or]: [{ email: { [Op.like]: like } }, { first_name: { [Op.like]: like } }, { last_name: { [Op.like]: like } }] }, attributes: ["id"], limit: 200 })).map((u) => u.id);
}

const repo = {
	async getUser(id) {
		return isUuid(id) ? plain(await User.findByPk(id, { attributes: USER_ATTRS })) : null;
	},
	async getUsersByIds(ids) {
		const ok = (ids || []).filter(isUuid);
		return ok.length ? (await User.findAll({ where: { id: ok }, attributes: USER_ATTRS })).map(plain) : [];
	},
	// A child's learner login (a student account attached to a learner profile): never eligible to apply.
	async isLearnerAccount(userId) {
		return (await ML_Learner.count({ where: { student_user_id: userId } })) > 0;
	},
	async listAdminIds() {
		return (await User.findAll({ where: { role: "admin", status: true }, attributes: ["id"] })).map((u) => u.id);
	},
	insertNotification: (row) => sessionRepo.insertNotification(row),

	// ---- applications
	async findByUser(userId) {
		return plain(await TelecallerApplication.findOne({ where: { user_id: userId } }));
	},
	async findById(id) {
		return isUuid(id) ? plain(await TelecallerApplication.findByPk(id)) : null;
	},
	async listEvents(applicationId) {
		return (await TelecallerApplicationEvent.findAll({ where: { application_id: applicationId }, order: [["created_at", "ASC"]], attributes: eventAttributes(await hasSnapshotColumn()) })).map(plain);
	},
	// Returns null when this user already has an application (the database allows one per user): the caller loads it.
	async createApplication(row, event) {
		const has = await hasSnapshotColumn();
		try {
			return await connection.transaction(async (transaction) => {
				const created = await TelecallerApplication.create(row, { transaction });
				await TelecallerApplicationEvent.create(eventRow({ application_id: created.id, ...event }, has), { transaction });
				return plain(created);
			});
		} catch (e) {
			if (e instanceof UniqueConstraintError) return null;
			throw e;
		}
	},
	// Compare-and-set on (id, version, allowed current statuses). Returns the new row, or null when it lost the race.
	async updateIf(id, { version, statuses }, patch, event) {
		const has = await hasSnapshotColumn();
		return connection.transaction(async (transaction) => {
			const [n] = await TelecallerApplication.update({ ...patch, version: version + 1 }, { where: { id, version, status: statuses }, transaction });
			if (!n) return null;
			if (event) await TelecallerApplicationEvent.create(eventRow({ application_id: id, ...event }, has), { transaction });
			return plain(await TelecallerApplication.findByPk(id, { transaction }));
		});
	},
	// A status change, its history row and (on approval) the telecaller profile, all in ONE transaction. users.role is untouched.
	async transition(id, guard, patch, event, profile) {
		const has = await hasSnapshotColumn();
		return connection.transaction(async (transaction) => {
			const [n] = await TelecallerApplication.update({ ...patch, version: guard.version + 1 }, { where: { id, version: guard.version, status: guard.statuses }, transaction });
			if (!n) return null;
			await TelecallerApplicationEvent.create(eventRow({ application_id: id, ...event }, has), { transaction });
			if (profile) await TelecallerProfile.findOrCreate({ where: { user_id: profile.user_id }, defaults: profile, transaction });
			return plain(await TelecallerApplication.findByPk(id, { transaction }));
		});
	},
	// Delivery bookkeeping for the e-mail sent about an event (the only write to an event after it is inserted).
	async setEventEmail(eventId, status) {
		await TelecallerApplicationEvent.update({ email_status: status }, { where: { id: eventId } });
	},
	async list({ q, statuses, page, pageSize }) {
		const where = { status: { [Op.in]: statuses } };
		if (q) {
			const ids = await usersLike(q);
			where[Op.and] = [{ [Op.or]: [{ full_name: { [Op.like]: `%${likeEscape(q)}%` } }, { user_id: ids }] }];
		}
		const { rows, count } = await TelecallerApplication.findAndCountAll({
			where,
			order: [[fn("COALESCE", col("submitted_at"), col("created_at")), "DESC"]],
			limit: pageSize,
			offset: (page - 1) * pageSize,
		});
		const apps = rows.map(plain);
		const owners = apps.length ? await User.findAll({ where: { id: apps.map((a) => a.user_id) }, attributes: USER_ATTRS }) : [];
		const byId = new Map(owners.map((u) => [u.id, u]));
		return { rows: apps.map((a) => ({ ...a, applicant_email: byId.get(a.user_id) ? byId.get(a.user_id).email : "", applicant_name: fullName(byId.get(a.user_id)) })), count };
	},
	async counts() {
		const rows = await TelecallerApplication.findAll({ attributes: ["status", [fn("COUNT", col("id")), "n"]], group: ["status"], raw: true });
		return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
	},

	// ---- resumes (immutable versions)
	async listResumes(applicationId) {
		return (await TelecallerResume.findAll({ where: { application_id: applicationId }, order: [["attempt", "ASC"], ["uploaded_at", "ASC"]] })).map(plain);
	},
	async countResumes(applicationId, attempt) {
		return TelecallerResume.count({ where: { application_id: applicationId, attempt } });
	},
	async findResumeByHash(applicationId, attempt, sha256) {
		return plain(await TelecallerResume.findOne({ where: { application_id: applicationId, attempt, sha256 } }));
	},
	async addResume(row) {
		try {
			return plain(await TelecallerResume.create(row));
		} catch (e) {
			if (e instanceof UniqueConstraintError) return null; // the same file for the same attempt, uploaded twice at once
			throw e;
		}
	},
	// The only read of the file bytes: used by the admin-only download.
	async getResumeWithData(id) {
		return isUuid(id) ? plain(await TelecallerResume.unscoped().findByPk(id)) : null;
	},

	// ---- profiles (the approved telecallers)
	async getProfile(userId) {
		return isUuid(userId) ? plain(await TelecallerProfile.findByPk(userId)) : null;
	},
	async listProfiles({ q, status, page, pageSize }) {
		const where = {};
		if (status) where.status = status;
		if (q) where.user_id = await usersLike(q);
		const { rows, count } = await TelecallerProfile.findAndCountAll({ where, order: [["approved_at", "DESC"]], limit: pageSize, offset: (page - 1) * pageSize });
		const profiles = rows.map(plain);
		const users = profiles.length ? await User.findAll({ where: { id: profiles.map((p) => p.user_id) }, attributes: USER_ATTRS }) : [];
		const apps = profiles.length ? await TelecallerApplication.findAll({ where: { id: profiles.map((p) => p.application_id).filter(Boolean) }, attributes: ["id", "full_name", "phone", "city", "state"] }) : [];
		const uById = new Map(users.map((u) => [u.id, u]));
		const aById = new Map(apps.map((a) => [a.id, a]));
		return {
			rows: profiles.map((p) => {
				const u = uById.get(p.user_id);
				const a = aById.get(p.application_id);
				return { ...p, name: fullName(u) || (a && a.full_name) || "", email: u ? u.email : "", phone: (a && a.phone) || (u && u.phone) || "", city: a ? a.city : "", state: a ? a.state : "" };
			}),
			count,
		};
	},
	async profileCounts() {
		const rows = await TelecallerProfile.findAll({ attributes: ["status", [fn("COUNT", col("user_id")), "n"]], group: ["status"], raw: true });
		return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
	},
	// Compare-and-set on (user_id, version). Returns the new row, or null when it lost the race.
	async updateProfileIf(userId, { version }, patch) {
		return connection.transaction(async (transaction) => {
			const [n] = await TelecallerProfile.update({ ...patch, version: version + 1 }, { where: { user_id: userId, version }, transaction });
			return n ? plain(await TelecallerProfile.findByPk(userId, { transaction })) : null;
		});
	},
};

export default repo;
