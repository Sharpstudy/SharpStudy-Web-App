// Sequelize implementation of the repository used by service.js (same semantics
// as tests/meetings/memoryRepo.mjs). All queries are parameterised through Sequelize.
import { Op, UniqueConstraintError, fn, col, literal, QueryTypes } from "sequelize";
import connection from "@/database/connection";
import { MeetingRequest, MeetingRequestEvent } from "@/database/models/meeting_request";
import { likeOp, ciEquals, isLockRetryError } from "@/lib/db/dialect";
import { ensureScheduleLockRowSql } from "@/lib/db/statements";
import { phoneIs as phoneIsSql, phoneSearch } from "@/lib/freeDemo/phoneSql";

const LIKE = likeOp(connection);
const phoneIs = (phone) => phoneIsSql(connection, phone);

const plain = (row) => (row ? row.get({ plain: true }) : null);
const likeEscape = (s) => s.replace(/[\%_]/g, (c) => `\${c}`);

// The lock row is created by the migration; this only guards against it being deleted. It runs
// OUTSIDE the locking transaction (an INSERT IGNORE inside it takes a shared lock that deadlocks
// with the other approvers waiting for the exclusive one).
let lockRowReady = null;
const ensureLockRow = () => (lockRowReady = lockRowReady || connection.query(ensureScheduleLockRowSql(connection.getDialect())).catch((e) => ((lockRowReady = null), Promise.reject(e))));

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
			return plain(await MeetingRequest.findOne({ where: { [Op.and]: [ciEquals(connection, "email", email), { requested_at: requestedAt, status: "pending" }] }, ...tx }));
		},
		async countByEmailSince(email, since) {
			return MeetingRequest.count({ where: { [Op.and]: [ciEquals(connection, "email", email), { created_at: { [Op.gte]: since } }] }, ...tx });
		},
		// Free demo: a still-open request from the same parent phone for the same child and program is the same request.
		async findOpenDemoTwin(phone, childName, program) {
			return plain(await MeetingRequest.findOne({ where: { [Op.and]: [{ kind: "free_demo", program, status: "pending" }, phoneIs(phone), ciEquals(connection, "child_name", childName)] }, ...tx }));
		},
		async countByPhoneSince(phone, since) {
			return MeetingRequest.count({ where: { [Op.and]: [{ kind: "free_demo", created_at: { [Op.gte]: since } }, phoneIs(phone)] }, ...tx });
		},
		async findByReference(reference) {
			return plain(await MeetingRequest.findOne({ where: ciEquals(connection, "reference", reference), ...tx }));
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
		async list({ q, status, page, pageSize, kind, program, source }) {
			const where = {};
			if (status) where.status = status;
			if (kind) where.kind = kind;
			if (program) where.program = program;
			if (source) where.source = source;
			if (q) {
				const like = `%${likeEscape(q)}%`;
				where[Op.or] = [{ name: { [LIKE]: like } }, { email: { [LIKE]: like } }, { reference: { [LIKE]: like } }, { organization: { [LIKE]: like } }, { phone: { [LIKE]: like } }, { child_name: { [LIKE]: like } }, ...(phoneSearch(connection, LIKE, q) ? [phoneSearch(connection, LIKE, q)] : [])];
			}
			const { rows, count } = await MeetingRequest.findAndCountAll({ where, order: [["created_at", "DESC"]], limit: pageSize, offset: (page - 1) * pageSize, ...tx });
			return { rows: rows.map(plain), total: count };
		},
		async countsByStatus(kind) {
			const rows = await MeetingRequest.findAll({ attributes: ["status", [fn("COUNT", col("id")), "n"]], where: kind ? { kind } : {}, group: ["status"], raw: true, ...tx });
			return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
		},
		// Counts over free-demo requests, straight from the database.
		async demoStats() {
			const group = async (column) => {
				const rows = await MeetingRequest.findAll({ attributes: [column, [fn("COUNT", col("id")), "n"]], where: { kind: "free_demo" }, group: [column], raw: true, ...tx });
				return Object.fromEntries(rows.map((r) => [r[column] || "unknown", Number(r.n)]));
			};
			const total = await MeetingRequest.count({ where: { kind: "free_demo" }, ...tx });
			const last7Days = await MeetingRequest.count({ where: { kind: "free_demo", created_at: { [Op.gte]: new Date(Date.now() - 7 * 86400000) } }, ...tx });
			// Not yet owned by anyone (no follow-up row, or a follow-up without an owner) and not closed.
			const [[u]] = await connection.query(
				`SELECT COUNT(*) AS n FROM meeting_requests m LEFT JOIN meeting_followups f ON f.meeting_request_id = m.id WHERE m.kind = 'free_demo' AND f.owner_user_id IS NULL AND m.status NOT IN ('rejected', 'cancelled')`,
				t ? { transaction: t } : {}
			);
			return { total, last7Days, unassigned: Number(u.n), byStatus: await group("status"), byProgram: await group("program"), bySource: await group("source") };
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
					const deadlock = isLockRetryError(e); // deadlock / lock wait timeout (MySQL 1213 / 1205, PostgreSQL 40P01 / 55P03 / 40001)
					if (!deadlock || attempt >= 3) throw e;
				}
			}
		},
	};
}

export const meetingRepo = build(null);
export default meetingRepo;
