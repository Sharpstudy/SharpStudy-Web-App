// Sequelize implementation of the repository used by service.js (same semantics
// as tests/meetings/memoryRepo.mjs). All queries are parameterised through Sequelize.
import { Op, UniqueConstraintError, fn, col, literal, QueryTypes } from "sequelize";
import connection from "@/database/connection";
import { MeetingRequest, MeetingRequestEvent } from "@/database/models/meeting_request";

const plain = (row) => (row ? row.get({ plain: true }) : null);
const likeEscape = (s) => s.replace(/[\%_]/g, (c) => `\${c}`);

// The lock row is created by the migration; this only guards against it being deleted. It runs
// OUTSIDE the locking transaction (an INSERT IGNORE inside it takes a shared lock that deadlocks
// with the other approvers waiting for the exclusive one).
let lockRowReady = null;
const ensureLockRow = () => (lockRowReady = lockRowReady || connection.query("INSERT IGNORE INTO meeting_schedule_lock (id) VALUES (1)").catch((e) => ((lockRowReady = null), Promise.reject(e))));

// Builds the repository; with a transaction `t`, every query runs inside it.
function build(t) {
	const tx = t ? { transaction: t } : {};
	return {
		async create(row) {
			try {
				return plain(await MeetingRequest.create(row, tx));
			} catch (e) {
				if (e instanceof UniqueConstraintError) {
					const err = new Error("duplicate");
					err.code = "duplicate";
					throw err;
				}
				throw e;
			}
		},
		async findBySubmissionKey(key) {
			return key ? plain(await MeetingRequest.findOne({ where: { submission_key: key }, ...tx })) : null;
		},
		async findOpenTwin(email, requestedAt) {
			return plain(await MeetingRequest.findOne({ where: { email, requested_at: requestedAt, status: "pending" }, ...tx }));
		},
		async countByEmailSince(email, since) {
			return MeetingRequest.count({ where: { email, created_at: { [Op.gte]: since } }, ...tx });
		},
		async findByReference(reference) {
			return plain(await MeetingRequest.findOne({ where: { reference }, ...tx }));
		},
		async findById(id) {
			if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
			return plain(await MeetingRequest.findByPk(id, tx));
		},
		async addEvent(row) {
			await MeetingRequestEvent.create(row, tx);
		},
		async listEvents(id) {
			return (await MeetingRequestEvent.findAll({ where: { meeting_request_id: id }, order: [["created_at", "ASC"]], ...tx })).map(plain);
		},
		async list({ q, status, page, pageSize }) {
			const where = {};
			if (status) where.status = status;
			if (q) {
				const like = `%${likeEscape(q)}%`;
				where[Op.or] = [{ name: { [Op.like]: like } }, { email: { [Op.like]: like } }, { reference: { [Op.like]: like } }, { organization: { [Op.like]: like } }];
			}
			const { rows, count } = await MeetingRequest.findAndCountAll({ where, order: [["created_at", "DESC"]], limit: pageSize, offset: (page - 1) * pageSize, ...tx });
			return { rows: rows.map(plain), total: count };
		},
		async countsByStatus() {
			const rows = await MeetingRequest.findAll({ attributes: ["status", [fn("COUNT", col("id")), "n"]], group: ["status"], raw: true, ...tx });
			return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
		},
		// Compare-and-set: succeeds only if the row still has this version AND one of these statuses.
		async updateIfCurrent(id, version, fromStatuses, patch) {
			const [n] = await MeetingRequest.update({ ...patch, version: literal("version + 1") }, { where: { id, version, status: { [Op.in]: fromStatuses } }, ...tx });
			return n ? plain(await MeetingRequest.findByPk(id, tx)) : null;
		},
		async setEmailState(id, patch) {
			await MeetingRequest.update(patch, { where: { id }, ...tx });
		},
		async setNotes(id, notes) {
			await MeetingRequest.update({ admin_notes: notes }, { where: { id }, ...tx });
			return plain(await MeetingRequest.findByPk(id, tx));
		},
		// Another approved meeting that overlaps [start, end). Inside the scheduling lock this is a
		// locking read, so it sees the latest committed approvals (not a stale snapshot).
		async findOverlap(start, end, excludeId) {
			return plain(
				await MeetingRequest.findOne({
					where: { status: "approved", id: { [Op.ne]: excludeId }, confirmed_start: { [Op.lt]: end }, confirmed_end: { [Op.gt]: start } },
					...(t ? { transaction: t, lock: t.LOCK.UPDATE } : {}),
				})
			);
		},
		// Serialise approvals: one transaction at a time holds the lock row, runs work(repo bound to
		// that transaction), then commits (releasing the lock). Throwing inside work rolls back.
		// Everything the work does is inside the transaction, so a deadlock retry is safe.
		async withScheduleLock(work) {
			await ensureLockRow();
			for (let attempt = 0; ; attempt++) {
				try {
					return await connection.transaction(async (trx) => {
						await connection.query("SELECT id FROM meeting_schedule_lock WHERE id = 1 FOR UPDATE", { transaction: trx, type: QueryTypes.SELECT });
						const inner = build(trx);
						delete inner.withScheduleLock; // no nesting
						return work(inner);
					});
				} catch (e) {
					const deadlock = e && e.parent && (e.parent.errno === 1213 || e.parent.errno === 1205); // deadlock / lock wait timeout
					if (!deadlock || attempt >= 3) throw e;
				}
			}
		},
	};
}

export const meetingRepo = build(null);
export default meetingRepo;
