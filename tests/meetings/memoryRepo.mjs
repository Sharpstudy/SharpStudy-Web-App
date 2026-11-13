// In-memory repository with the same semantics as lib/meetings/repo.js.
import { randomUUID } from "node:crypto";

// opts.overlapDelayMs widens the gap between "check for overlap" and "write approved" to expose races;
// opts.noLock removes withScheduleLock (a repository without the lock) for the control test.
export function createMeetingRepo(opts = {}) {
	const db = { requests: [], events: [] };
	const clone = (x) => (x ? structuredClone(x) : null);
	const stamp = () => new Date();
	const repo = {
		_db: db,
		async create(row) {
			if (db.requests.some((r) => r.reference === row.reference || (row.submission_key && r.submission_key === row.submission_key))) {
				const e = new Error("duplicate");
				e.code = "duplicate";
				throw e;
			}
			const r = { id: randomUUID(), submission_key: null, organization: null, message: null, confirmed_start: null, confirmed_end: null, proposed_start: null, meeting_url: null, admin_notes: null, processed_by: null, processed_at: null, version: 0, admin_email_status: "pending", visitor_email_status: "pending", last_email_error: null, created_at: stamp(), updated_at: stamp(), ...clone(row) };
			db.requests.push(r);
			return clone(r);
		},
		async findBySubmissionKey(k) {
			return k ? clone(db.requests.find((r) => r.submission_key === k)) : null;
		},
		async findOpenTwin(email, at) {
			return clone(db.requests.find((r) => r.email === email && +r.requested_at === +at && r.status === "pending"));
		},
		async countByEmailSince(email, since) {
			return db.requests.filter((r) => r.email === email && r.created_at >= since).length;
		},
		async findByReference(ref) {
			return clone(db.requests.find((r) => r.reference === ref));
		},
		async findById(id) {
			return clone(db.requests.find((r) => r.id === id));
		},
		async addEvent(e) {
			db.events.push({ id: randomUUID(), created_at: stamp(), ...clone(e) });
		},
		async listEvents(id) {
			return db.events.filter((e) => e.meeting_request_id === id).map(clone);
		},
		async list({ q, status, page, pageSize }) {
			let rows = db.requests.filter((r) => (!status || r.status === status) && (!q || [r.name, r.email, r.reference, r.organization || ""].some((v) => v.toLowerCase().includes(q.toLowerCase()))));
			rows = rows.sort((a, b) => b.created_at - a.created_at);
			return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total: rows.length };
		},
		async countsByStatus() {
			const out = {};
			for (const r of db.requests) out[r.status] = (out[r.status] || 0) + 1;
			return out;
		},
		async updateIfCurrent(id, version, from, patch) {
			const r = db.requests.find((x) => x.id === id);
			if (!r || r.version !== version || !from.includes(r.status)) return null;
			Object.assign(r, patch, { version: r.version + 1, updated_at: stamp() });
			return clone(r);
		},
		async setEmailState(id, patch) {
			Object.assign(db.requests.find((x) => x.id === id), patch);
		},
		async setNotes(id, notes) {
			const r = db.requests.find((x) => x.id === id);
			r.admin_notes = notes;
			return clone(r);
		},
		async findOverlap(start, end, excludeId) {
			const found = clone(db.requests.find((r) => r.status === "approved" && r.id !== excludeId && r.confirmed_start < end && r.confirmed_end > start));
			// Delay AFTER reading: the caller acts on a possibly stale answer, like two interleaved database sessions.
			if (opts.overlapDelayMs) await new Promise((r) => setTimeout(r, opts.overlapDelayMs));
			return found;
		},
	};
	if (!opts.noLock) {
		// Mutex: one scheduling critical section at a time (the SQL version uses a row lock in a transaction).
		let tail = Promise.resolve();
		repo.withScheduleLock = (work) => {
			const run = tail.then(() => work(repo));
			tail = run.catch(() => {});
			return run;
		};
	}
	return repo;
}
