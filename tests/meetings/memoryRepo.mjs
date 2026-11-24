// In-memory repository with the same semantics as lib/meetings/repo.js.
import { samePhone, phoneMatchesSearch } from "../../lib/freeDemo/phoneKey.js";
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
		async findOpenDemoTwin(phone, childName, program) {
			return clone(db.requests.find((r) => r.kind === "free_demo" && samePhone(r.phone, phone) && r.program === program && r.status === "pending" && String(r.child_name).toLowerCase() === String(childName).toLowerCase()));
		},
		async countByPhoneSince(phone, since) {
			return db.requests.filter((r) => r.kind === "free_demo" && samePhone(r.phone, phone) && r.created_at >= since).length;
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
		async list({ q, status, page, pageSize, kind, program, source }) {
			let rows = db.requests.filter((r) => (!kind || (r.kind || "meeting") === kind) && (!program || r.program === program) && (!source || r.source === source) && (!status || r.status === status) && (!q || [r.name, r.email, r.reference, r.organization, r.phone, r.child_name].some((v) => String(v || "").toLowerCase().includes(q.toLowerCase())) || phoneMatchesSearch(r.phone, q)));
			rows = rows.sort((a, b) => b.created_at - a.created_at);
			return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total: rows.length };
		},
		async countsByStatus(kind) {
			const out = {};
			for (const r of db.requests) if (!kind || (r.kind || "meeting") === kind) out[r.status] = (out[r.status] || 0) + 1;
			return out;
		},
		async demoStats() {
			const demo = db.requests.filter((r) => r.kind === "free_demo");
			const group = (k) => demo.reduce((o, r) => ((o[r[k] || "unknown"] = (o[r[k] || "unknown"] || 0) + 1), o), {});
			return { total: demo.length, last7Days: demo.filter((r) => r.created_at >= new Date(Date.now() - 7 * 86400000)).length, unassigned: demo.filter((r) => !["rejected", "cancelled"].includes(r.status)).length, byStatus: group("status"), byProgram: group("program"), bySource: group("source") };
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
