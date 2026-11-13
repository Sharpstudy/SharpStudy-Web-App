// Sequelize implementation of the repository used by lib/followups/service.js (same semantics as tests/followups/memoryRepo.mjs).
// All queries are parameterised through Sequelize.
//
// Hard boundaries, kept deliberately:
//  - meeting_requests is READ ONLY here: this file never calls create / update / destroy on MeetingRequest, and the columns that must
//    not reach a telecaller (admin notes, the visitor's manage-link token hash, e-mail delivery state) are never selected.
//  - meeting_call_logs and meeting_followup_events are insert-only: there is no update or delete on them.
//  - every change to meeting_followups goes through applyFollowup(), ONE transaction: compare-and-set on (meeting, version[, owner]),
//    the history row(s) and the call log together.
import { Op, UniqueConstraintError } from "sequelize";
import connection from "@/database/connection";
import { MeetingRequest } from "@/database/models/meeting_request";
import { MeetingFollowup, MeetingCallLog, MeetingFollowupEvent } from "@/database/models/followup";
import { TelecallerProfile } from "@/database/models/telecaller";
import User from "@/database/models/user";
import telecallerRepo from "@/lib/telecallers/repo";
import sessionRepo from "@/lib/live-sessions/repo"; // the existing notifications repository
import { CLOSED_STATUSES, LIMITS } from "./rules.js";

const plain = (row) => (row ? row.get({ plain: true }) : null);
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const DAY = 86400000;

// Never selected by any telecaller query.
const MEETING_HIDDEN = ["manage_token_hash", "admin_notes", "submission_key", "processed_by", "processed_at", "admin_email_status", "visitor_email_status", "last_email_error", "proposed_start", "meeting_url"];
const MEETING_ATTRS = { exclude: MEETING_HIDDEN };
const FOLLOW = { model: MeetingFollowup, as: "followup", required: false };

// WHERE for a filter, over MeetingRequest LEFT JOIN meeting_followups (alias followup). Mirrors lib/followups/rules.js matchesFilter.
function whereFor(filter, mine, q, ctx) {
	const and = [];
	const statusCol = "$followup.follow_up_status$";
	const notClosed = { [Op.or]: [{ [statusCol]: null }, { [statusCol]: { [Op.notIn]: CLOSED_STATUSES } }] };
	const next = "$followup.next_follow_up_at$";
	switch (filter) {
		case "unclaimed":
			and.push(notClosed, { "$followup.owner_user_id$": null });
			break;
		case "mine":
			and.push(notClosed, { "$followup.owner_user_id$": ctx.userId });
			break;
		case "overdue":
			and.push(notClosed, { [next]: { [Op.lt]: ctx.now } });
			break;
		case "due_today":
			and.push(notClosed, { [next]: { [Op.gte]: ctx.now, [Op.lt]: ctx.dayEnd } });
			break;
		case "upcoming":
			and.push(notClosed, { [next]: { [Op.gte]: ctx.dayEnd, [Op.lt]: new Date(ctx.dayEnd.getTime() + LIMITS.upcomingDays * DAY) } });
			break;
		case "completed":
			and.push({ [statusCol]: "completed" });
			break;
		default:
	}
	if (mine && filter !== "mine") and.push({ "$followup.owner_user_id$": ctx.userId });
	if (q) {
		const like = `%${likeEscape(q)}%`;
		and.push({ [Op.or]: [{ name: { [Op.like]: like } }, { email: { [Op.like]: like } }, { phone: { [Op.like]: like } }, { reference: { [Op.like]: like } }, { organization: { [Op.like]: like } }] });
	}
	return and.length ? { [Op.and]: and } : {};
}

const orderFor = (filter) => (["overdue", "due_today", "upcoming"].includes(filter) ? [[{ model: MeetingFollowup, as: "followup" }, "next_follow_up_at", "ASC"], ["created_at", "DESC"]] : [["created_at", "DESC"]]);

const shapeRow = (r) => {
	const p = plain(r);
	const { followup, ...meeting } = p;
	return { meeting, followup: followup || null };
};

// Adds the meeting's reference / customer name to log rows (for the feeds).
async function withMeetingInfo(rows) {
	const ids = [...new Set(rows.map((r) => r.meeting_request_id))];
	const ms = ids.length ? await MeetingRequest.findAll({ where: { id: ids }, attributes: ["id", "reference", "name"] }) : [];
	const by = new Map(ms.map((m) => [m.id, m]));
	return rows.map((r) => ({ ...r, meeting_reference: by.get(r.meeting_request_id) ? by.get(r.meeting_request_id).reference : null, meeting_name: by.get(r.meeting_request_id) ? by.get(r.meeting_request_id).name : null }));
}

async function feedWhere(filters, userCols, dateCol) {
	const and = [];
	if (filters.meetingId) and.push({ meeting_request_id: filters.meetingId });
	if (filters.telecallerId) and.push({ [Op.or]: userCols.map((c) => ({ [c]: filters.telecallerId })) });
	if (filters.from) and.push({ [dateCol]: { [Op.gte]: filters.from } });
	if (filters.to) and.push({ [dateCol]: { [Op.lt]: filters.to } });
	if (filters.status) {
		const ids = (await MeetingFollowup.findAll({ where: { follow_up_status: filters.status }, attributes: ["meeting_request_id"], limit: 5000 })).map((r) => r.meeting_request_id);
		and.push({ meeting_request_id: { [Op.in]: ids } });
	}
	return and.length ? { [Op.and]: and } : {};
}

const repo = {
	// ---- identities (delegated to the Phase 2 repository, which never selects password hashes)
	getUser: (id) => telecallerRepo.getUser(id),
	getUsersByIds: (ids) => telecallerRepo.getUsersByIds(ids),
	isLearnerAccount: (id) => telecallerRepo.isLearnerAccount(id),
	getProfile: (id) => telecallerRepo.getProfile(id),
	insertNotification: (row) => sessionRepo.insertNotification(row),

	// ---- meetings (read only)
	async getMeeting(id) {
		return isUuid(id) ? plain(await MeetingRequest.findByPk(id, { attributes: MEETING_ATTRS })) : null;
	},
	async findMeetingByReference(reference) {
		return plain(await MeetingRequest.findOne({ where: { reference: String(reference) }, attributes: MEETING_ATTRS }));
	},
	async getFollowup(id) {
		return isUuid(id) ? plain(await MeetingFollowup.findByPk(id)) : null;
	},
	async listRows({ filter, mine, q, page, pageSize }, ctx) {
		const { rows, count } = await MeetingRequest.findAndCountAll({
			attributes: MEETING_ATTRS,
			include: [FOLLOW],
			where: whereFor(filter, mine, q, ctx),
			order: orderFor(filter),
			limit: pageSize,
			offset: (page - 1) * pageSize,
			subQuery: false,
			distinct: true,
		});
		return { rows: rows.map(shapeRow), total: count };
	},
	// Exact counts. "mine_*" are the caller's own.
	async counts(ctx) {
		const c = (filter, mine = false) => MeetingRequest.count({ include: [{ ...FOLLOW, attributes: [] }], where: whereFor(filter, mine, "", ctx), distinct: true });
		const [total, unclaimed, mineN, dueToday, overdue, upcoming, completed, mineDue, mineOver, mineUp] = await Promise.all([
			MeetingRequest.count(),
			c("unclaimed"),
			c("mine"),
			c("due_today"),
			c("overdue"),
			c("upcoming"),
			c("completed"),
			c("due_today", true),
			c("overdue", true),
			c("upcoming", true),
		]);
		return { total, unclaimed, mine: mineN, due_today: dueToday, overdue, upcoming, completed, mine_due_today: mineDue, mine_overdue: mineOver, mine_upcoming: mineUp };
	},

	// ---- call history / events (insert-only; reads)
	async lastCalls(meetingIds) {
		const ids = (meetingIds || []).filter(isUuid);
		if (!ids.length) return [];
		const rows = await MeetingCallLog.findAll({ where: { meeting_request_id: ids }, order: [["called_at", "DESC"], ["created_at", "DESC"]] });
		const seen = new Set();
		return rows.map(plain).filter((r) => (seen.has(r.meeting_request_id) ? false : seen.add(r.meeting_request_id)));
	},
	async recentCalls(limit) {
		return withMeetingInfo((await MeetingCallLog.findAll({ order: [["called_at", "DESC"], ["created_at", "DESC"]], limit })).map(plain));
	},
	async listCallLogs(meetingId) {
		return (await MeetingCallLog.findAll({ where: { meeting_request_id: meetingId }, order: [["called_at", "DESC"], ["created_at", "DESC"]] })).map(plain);
	},
	async listMeetingEvents(meetingId) {
		return (await MeetingFollowupEvent.findAll({ where: { meeting_request_id: meetingId }, order: [["created_at", "DESC"]] })).map(plain);
	},
	async listCallFeed(filters, limit) {
		const where = await feedWhere(filters, ["telecaller_user_id"], "called_at");
		const { rows, count } = await MeetingCallLog.findAndCountAll({ where, order: [["called_at", "DESC"], ["created_at", "DESC"]], limit });
		return { rows: await withMeetingInfo(rows.map(plain)), total: count };
	},
	async listEventFeed(filters, limit) {
		const where = await feedWhere(filters, ["actor_user_id", "from_user_id", "to_user_id"], "created_at");
		const { rows, count } = await MeetingFollowupEvent.findAndCountAll({ where, order: [["created_at", "DESC"]], limit });
		return { rows: await withMeetingInfo(rows.map(plain)), total: count };
	},

	// ---- telecallers (for the transfer / filter pickers)
	async listTelecallers() {
		const profiles = (await TelecallerProfile.findAll({ order: [["approved_at", "ASC"]] })).map(plain);
		const users = profiles.length ? await User.findAll({ where: { id: profiles.map((p) => p.user_id) }, attributes: ["id", "first_name", "last_name", "email"] }) : [];
		const by = new Map(users.map((u) => [u.id, u]));
		return profiles
			.map((p) => {
				const u = by.get(p.user_id);
				return { user_id: p.user_id, status: p.status, name: u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email : "Former telecaller" };
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	},

	// The ONLY write to meeting_followups. One transaction: compare-and-set, history row(s), call log.
	//   expectedVersion 0  -> the meeting must have no follow-up row yet (the primary key makes a second creator fail)
	//   expectedVersion n  -> UPDATE ... WHERE version = n [AND owner is ownerGuard]
	// Returns the new row, or null when it lost the race (nothing is written then).
	async applyFollowup({ meetingId, expectedVersion, ownerGuard, patch, events = [], callLog = null, now }) {
		return connection.transaction(async (transaction) => {
			if (expectedVersion === 0) {
				if (ownerGuard) return null; // a meeting with no follow-up row has no owner
				try {
					await MeetingFollowup.create({ follow_up_status: "not_contacted", ...patch, meeting_request_id: meetingId, version: 1, created_at: now, updated_at: now }, { transaction });
				} catch (e) {
					if (e instanceof UniqueConstraintError) return null;
					throw e;
				}
			} else {
				const where = { meeting_request_id: meetingId, version: expectedVersion };
				if (ownerGuard !== undefined) where.owner_user_id = ownerGuard; // null -> IS NULL
				const [n] = await MeetingFollowup.update({ ...patch, version: expectedVersion + 1, updated_at: now }, { where, transaction });
				if (!n) return null;
			}
			for (const e of events) await MeetingFollowupEvent.create(e, { transaction });
			if (callLog) await MeetingCallLog.create(callLog, { transaction });
			return plain(await MeetingFollowup.findByPk(meetingId, { transaction }));
		});
	},
};

export default repo;
