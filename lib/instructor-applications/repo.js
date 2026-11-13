// Sequelize implementation of the repository used by service.js (same semantics as
// tests/instructor/memoryRepo.mjs). All queries are parameterised through Sequelize.
import { Op, fn, col } from "sequelize";
import connection from "@/database/connection";
import User from "@/database/models/user";
import Category from "@/database/models/category";
import { InstructorApplication, InstructorApplicationEvent, InstructorProfile } from "@/database/models/instructor_application";

const plain = (row) => (row ? row.get({ plain: true }) : null);
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const USER_ATTRS = ["id", "email", "first_name", "last_name", "role", "email_confirmed", "status", "phone", "profile_photo"];
const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

const repo = {
	async getUser(id) {
		return isUuid(id) ? plain(await User.findByPk(id, { attributes: USER_ATTRS })) : null;
	},
	async findByUser(userId) {
		return plain(await InstructorApplication.findOne({ where: { user_id: userId } }));
	},
	async findById(id) {
		return isUuid(id) ? plain(await InstructorApplication.findByPk(id)) : null;
	},
	async listEvents(applicationId) {
		return (await InstructorApplicationEvent.findAll({ where: { application_id: applicationId }, order: [["created_at", "ASC"]] })).map(plain);
	},
	async listCategories() {
		return (await Category.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]] })).map(plain);
	},
	async findCategories(ids) {
		const ok = ids.filter(isUuid);
		return ok.length ? (await Category.findAll({ where: { id: ok }, attributes: ["id", "name"] })).map(plain) : [];
	},
	async createApplication(row, event) {
		return connection.transaction(async (transaction) => {
			const created = await InstructorApplication.create(row, { transaction });
			await InstructorApplicationEvent.create({ application_id: created.id, ...event }, { transaction });
			return plain(created);
		});
	},
	// Compare-and-set on (id, version, allowed current statuses). Returns the new row, or null when it lost the race.
	async updateIf(id, { version, statuses }, patch, event) {
		return connection.transaction(async (transaction) => {
			const [n] = await InstructorApplication.update({ ...patch, version: version + 1 }, { where: { id, version, status: statuses }, transaction });
			if (!n) return null;
			if (event) await InstructorApplicationEvent.create({ application_id: id, ...event }, { transaction });
			return plain(await InstructorApplication.findByPk(id, { transaction }));
		});
	},
	// A status change, its history row and (optionally) the user's role change, all in ONE transaction.
	async transition(id, guard, patch, event, userEffect) {
		return connection.transaction(async (transaction) => {
			const [n] = await InstructorApplication.update({ ...patch, version: guard.version + 1 }, { where: { id, version: guard.version, status: guard.statuses }, transaction });
			if (!n) return null;
			if (userEffect && userEffect.setRole) {
				const { from, to } = userEffect.setRole;
				// `where role = from` keeps admins (and anyone already in the target role) untouched.
				const legacy = to === "instructor" ? { instructor_request: true, instructor_request_confirmed: true, instructor_request_confirmed_at: new Date() } : { instructor_request_confirmed: false };
				await User.update({ role: to, ...legacy }, { where: { id: userEffect.userId, role: from }, transaction });
				if (userEffect.profile) {
					const [row, created] = await InstructorProfile.findOrCreate({ where: { user_id: userEffect.userId }, defaults: userEffect.profile, transaction });
					if (!created) {
						// keep anything the instructor already wrote themselves
						const keep = {};
						for (const k of Object.keys(userEffect.profile)) if (!row[k]) keep[k] = userEffect.profile[k];
						if (Object.keys(keep).length) await row.update(keep, { transaction });
					}
				}
			}
			await InstructorApplicationEvent.create({ application_id: id, ...event }, { transaction });
			return plain(await InstructorApplication.findByPk(id, { transaction }));
		});
	},
	async setNotify(id, patch) {
		await InstructorApplication.update(patch, { where: { id } });
	},
	async list({ q, status, page, pageSize }) {
		const where = status ? { status } : { status: { [Op.ne]: "draft" } };
		if (q) {
			const like = `%${likeEscape(q)}%`;
			const users = await User.findAll({ where: { [Op.or]: [{ email: { [Op.like]: like } }, { first_name: { [Op.like]: like } }, { last_name: { [Op.like]: like } }] }, attributes: ["id"], limit: 200 });
			where[Op.and] = [{ [Op.or]: [{ full_name: { [Op.like]: like } }, { user_id: users.map((u) => u.id) }] }];
		}
		const { rows, count } = await InstructorApplication.findAndCountAll({
			where,
			order: [[fn("COALESCE", col("submitted_at"), col("created_at")), "DESC"]],
			limit: pageSize,
			offset: (page - 1) * pageSize,
		});
		const apps = rows.map(plain);
		const owners = apps.length ? await User.findAll({ where: { id: apps.map((a) => a.user_id) }, attributes: USER_ATTRS }) : [];
		const byId = new Map(owners.map((u) => [u.id, u]));
		return {
			rows: apps.map((a) => {
				const u = byId.get(a.user_id);
				return { ...a, applicant_email: u ? u.email : "", applicant_name: u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : "" };
			}),
			count,
		};
	},
	async counts() {
		const rows = await InstructorApplication.findAll({ attributes: ["status", [fn("COUNT", col("id")), "n"]], group: ["status"], raw: true });
		return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
	},
};

export default repo;
