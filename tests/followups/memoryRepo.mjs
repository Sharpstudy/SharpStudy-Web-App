// In-memory repository with the same semantics as lib/followups/repo.js (the service is tested against this; no database is touched).
// applyFollowup() has no `await` between its check and its write, so it is atomic exactly like the real compare-and-set transaction:
// two concurrent callers that read the same version cannot both succeed.
import { matchesFilter, effectiveStatus } from "../../lib/followups/rules.js";

const clone = (o) => (o === null || o === undefined ? o : structuredClone(o));

export function memoryRepo({ users = [], profiles = [], meetings = [], learners = [] } = {}) {
	const s = {
		users: new Map(users.map((u) => [u.id, { ...u }])),
		profiles: new Map(profiles.map((p) => [p.user_id, { ...p }])),
		meetings: new Map(meetings.map((m) => [m.id, { ...m }])),
		learners: new Set(learners),
		followups: new Map(),
		calls: [],
		events: [],
		notifications: [],
		writesToMeetings: 0, // must stay 0: nothing here may write meeting_requests
	};
	const matchQ = (m, q) => !q || [m.name, m.email, m.phone, m.reference, m.organization].some((v) => String(v || "").toLowerCase().includes(q.toLowerCase()));
	const sortDesc = (rows, key) => [...rows].sort((a, b) => (new Date(b[key]) - new Date(a[key])) || (a.id < b.id ? 1 : -1));
	const info = (r) => {
		const m = s.meetings.get(r.meeting_request_id);
		return { ...clone(r), meeting_reference: m ? m.reference : null, meeting_name: m ? m.name : null };
	};
	const feedFilter = (rows, f, userKeys, dateKey) =>
		rows.filter((r) => {
			if (f.meetingId && r.meeting_request_id !== f.meetingId) return false;
			if (f.telecallerId && !userKeys.some((k) => r[k] === f.telecallerId)) return false;
			if (f.from && new Date(r[dateKey]) < f.from) return false;
			if (f.to && new Date(r[dateKey]) >= f.to) return false;
			if (f.status) {
				const fu = s.followups.get(r.meeting_request_id);
				if (!fu || fu.follow_up_status !== f.status) return false;
			}
			return true;
		});

	const repo = {
		state: s,
		async getUser(id) { const u = s.users.get(id); return u ? clone(u) : null; },
		async getUsersByIds(ids) { return ids.map((i) => s.users.get(i)).filter(Boolean).map(clone); },
		async isLearnerAccount(id) { return s.learners.has(id); },
		async getProfile(id) { const p = s.profiles.get(id); return p ? clone(p) : null; },
		async insertNotification(row) {
			if (s.notifications.some((n) => n.dedupe_key === row.dedupe_key)) return null;
			s.notifications.push(clone(row));
			return clone(row);
		},
		async getMeeting(id) { const m = s.meetings.get(id); return m ? clone(m) : null; }, // full row, like the DB: the SERVICE view must strip admin fields
		async findMeetingByReference(ref) { const m = [...s.meetings.values()].find((x) => x.reference === ref); return m ? clone(m) : null; },
		async getFollowup(id) { const f = s.followups.get(id); return f ? clone(f) : null; },
		async listRows({ filter, mine, q, page, pageSize }, ctx) {
			let rows = [...s.meetings.values()]
				.map((m) => ({ meeting: m, followup: s.followups.get(m.id) || null }))
				.filter((r) => matchesFilter(r, filter, ctx))
				.filter((r) => !mine || (r.followup && r.followup.owner_user_id === ctx.userId))
				.filter((r) => matchQ(r.meeting, q));
			if (["overdue", "due_today", "upcoming"].includes(filter)) rows.sort((a, b) => new Date(a.followup.next_follow_up_at) - new Date(b.followup.next_follow_up_at));
			else rows.sort((a, b) => new Date(b.meeting.created_at) - new Date(a.meeting.created_at));
			const total = rows.length;
			rows = rows.slice((page - 1) * pageSize, page * pageSize);
			return { rows: clone(rows), total };
		},
		async counts(ctx) {
			const all = [...s.meetings.values()].map((m) => ({ meeting: m, followup: s.followups.get(m.id) || null }));
			const n = (f, mine = false) => all.filter((r) => matchesFilter(r, f, ctx)).filter((r) => !mine || (r.followup && r.followup.owner_user_id === ctx.userId)).length;
			return { total: all.length, unclaimed: n("unclaimed"), mine: n("mine"), due_today: n("due_today"), overdue: n("overdue"), upcoming: n("upcoming"), completed: n("completed"), mine_due_today: n("due_today", true), mine_overdue: n("overdue", true), mine_upcoming: n("upcoming", true) };
		},
		async lastCalls(ids) {
			const out = [];
			for (const id of ids) {
				const c = sortDesc(s.calls.filter((x) => x.meeting_request_id === id), "called_at")[0];
				if (c) out.push(clone(c));
			}
			return out;
		},
		async recentCalls(limit) { return sortDesc(s.calls, "called_at").slice(0, limit).map(info); },
		async listCallLogs(id) { return sortDesc(s.calls.filter((c) => c.meeting_request_id === id), "called_at").map(clone); },
		async listMeetingEvents(id) { return sortDesc(s.events.filter((e) => e.meeting_request_id === id), "created_at").map(clone); },
		async listCallFeed(f, limit) { const rows = sortDesc(feedFilter(s.calls, f, ["telecaller_user_id"], "called_at"), "called_at"); return { rows: rows.slice(0, limit).map(info), total: rows.length }; },
		async listEventFeed(f, limit) { const rows = sortDesc(feedFilter(s.events, f, ["actor_user_id", "from_user_id", "to_user_id"], "created_at"), "created_at"); return { rows: rows.slice(0, limit).map(info), total: rows.length }; },
		async listTelecallers() {
			return [...s.profiles.values()].map((p) => { const u = s.users.get(p.user_id); return { user_id: p.user_id, status: p.status, name: u ? `${u.first_name} ${u.last_name}`.trim() : "Former telecaller" }; }).sort((a, b) => a.name.localeCompare(b.name));
		},
		async applyFollowup({ meetingId, expectedVersion, ownerGuard, patch, events = [], callLog = null, now }) {
			// ---- everything below is synchronous: it is the atomic compare-and-set
			const cur = s.followups.get(meetingId);
			if (expectedVersion === 0) {
				if (cur || ownerGuard) return null;
				s.followups.set(meetingId, { meeting_request_id: meetingId, follow_up_status: "not_contacted", owner_user_id: null, owned_at: null, last_contacted_at: null, next_follow_up_at: null, completed_at: null, completed_by: null, completion_note: null, ...patch, version: 1, created_at: now, updated_at: now });
			} else {
				if (!cur || cur.version !== expectedVersion) return null;
				if (ownerGuard !== undefined && (cur.owner_user_id || null) !== ownerGuard) return null;
				s.followups.set(meetingId, { ...cur, ...patch, version: expectedVersion + 1, updated_at: now });
			}
			for (const e of events) s.events.push(clone(e));
			if (callLog) s.calls.push(clone(callLog));
			return clone(s.followups.get(meetingId));
		},
	};
	return repo;
}

export const U = (n, extra = {}) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, first_name: `User${n}`, last_name: "Test", email: `u${n}@example.test`, role: "student", status: true, email_confirmed: true, ...extra });
export const M = (n, extra = {}) => ({
	id: `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`,
	reference: `MR-${String(n).padStart(4, "0")}`,
	name: `Customer ${n}`,
	email: `customer${n}@example.test`,
	phone: `+1555000${String(n).padStart(4, "0")}`,
	organization: "Acme",
	purpose: "product_demo",
	message: "Please call me",
	requested_date: "2026-11-10",
	requested_time: "10:00",
	time_zone: "Asia/Kolkata",
	requested_at: new Date("2026-11-10T04:30:00Z"),
	duration_minutes: 30,
	status: "pending",
	confirmed_start: null,
	confirmed_end: null,
	created_at: new Date(Date.UTC(2026, 9, n)),
	// fields that must NEVER reach a telecaller:
	admin_notes: "SECRET admin note",
	manage_token_hash: "deadbeef".repeat(8),
	processed_by: "22222222-0000-4000-8000-000000000001",
	admin_email_status: "sent",
	visitor_email_status: "sent",
	...extra,
});
export const profile = (userId, extra = {}) => ({ user_id: userId, status: "active", approved_at: new Date("2026-10-01T00:00:00Z"), ...extra });
