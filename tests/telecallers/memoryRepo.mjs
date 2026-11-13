// In-memory repository with the same semantics as lib/telecallers/repo.js: one application per user, compare-and-set
// transitions that write the status, its history row and the profile together or not at all, insert-only events and
// resume versions. No database is touched.
import { v4 as uuidv4 } from "uuid";

let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 1) + ++tick);
const clone = (o) => (o == null ? o : Array.isArray(o) ? o.map(clone) : Buffer.isBuffer(o) ? Buffer.from(o) : o instanceof Date ? new Date(o) : typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clone(v)])) : o);

export function memoryRepo() {
	const users = new Map();
	const apps = new Map();
	const events = [];
	const resumes = [];
	const profiles = new Map();
	const notifications = [];
	const learnerAccounts = new Set();
	const log = { notifications };

	const noData = (r) => {
		const { data, ...rest } = r;
		return clone(rest);
	};
	const fullName = (u) => (u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : "");

	const repo = {
		log,
		// ---- test helpers
		addUser(u) {
			const user = { id: uuidv4(), role: "student", email_confirmed: true, status: true, first_name: "Test", last_name: "Person", phone: "", ...u };
			user.email = user.email || `${user.id.slice(0, 8)}@example.com`;
			users.set(user.id, user);
			return user;
		},
		markLearner: (id) => learnerAccounts.add(id),
		users,
		apps,
		events,
		resumes,
		profiles,
		allResumeRows: () => resumes,

		// ---- repository interface
		async getUser(id) {
			return clone(users.get(id) || null);
		},
		async getUsersByIds(ids) {
			return ids.map((i) => users.get(i)).filter(Boolean).map(clone);
		},
		async isLearnerAccount(id) {
			return learnerAccounts.has(id);
		},
		async listAdminIds() {
			return [...users.values()].filter((u) => u.role === "admin" && u.status === true).map((u) => u.id);
		},
		async insertNotification(row) {
			if (notifications.some((n) => n.dedupe_key === row.dedupe_key)) return null;
			notifications.push(clone(row));
			return clone(row);
		},

		async findByUser(userId) {
			return clone([...apps.values()].find((a) => a.user_id === userId) || null);
		},
		async findById(id) {
			return clone(apps.get(id) || null);
		},
		async listEvents(applicationId) {
			return events.filter((e) => e.application_id === applicationId).map(clone);
		},
		async createApplication(row, event) {
			if ([...apps.values()].some((a) => a.user_id === row.user_id)) return null; // unique (user_id)
			const app = { id: uuidv4(), version: 0, attempt: 1, created_at: stamp(), updated_at: stamp(), ...clone(row) };
			apps.set(app.id, app);
			events.push({ id: uuidv4(), application_id: app.id, email_status: "none", created_at: stamp(), ...clone(event) });
			return clone(app);
		},
		async updateIf(id, { version, statuses }, patch, event) {
			const a = apps.get(id);
			if (!a || a.version !== version || !statuses.includes(a.status)) return null;
			Object.assign(a, clone(patch), { version: version + 1, updated_at: stamp() });
			if (event) events.push({ id: uuidv4(), application_id: id, email_status: "none", created_at: stamp(), ...clone(event) });
			return clone(a);
		},
		async transition(id, guard, patch, event, profile) {
			const a = apps.get(id);
			if (!a || a.version !== guard.version || !guard.statuses.includes(a.status)) return null;
			Object.assign(a, clone(patch), { version: guard.version + 1, updated_at: stamp() });
			events.push({ id: uuidv4(), application_id: id, email_status: "none", created_at: stamp(), ...clone(event) });
			if (profile && !profiles.has(profile.user_id)) profiles.set(profile.user_id, { ...clone(profile), version: 0, created_at: stamp(), updated_at: stamp() });
			return clone(a);
		},
		async setEventEmail(eventId, status) {
			const e = events.find((x) => x.id === eventId);
			if (e) e.email_status = status;
		},
		async list({ q, statuses, page, pageSize }) {
			let rows = [...apps.values()].filter((a) => statuses.includes(a.status));
			if (q) {
				const s = q.toLowerCase();
				rows = rows.filter((a) => (a.full_name || "").toLowerCase().includes(s) || (users.get(a.user_id).email || "").toLowerCase().includes(s) || fullName(users.get(a.user_id)).toLowerCase().includes(s));
			}
			rows.sort((x, y) => new Date(y.submitted_at || y.created_at) - new Date(x.submitted_at || x.created_at));
			const slice = rows.slice((page - 1) * pageSize, page * pageSize);
			return { rows: slice.map((a) => ({ ...clone(a), applicant_email: users.get(a.user_id).email, applicant_name: fullName(users.get(a.user_id)) })), count: rows.length };
		},
		async counts() {
			const out = {};
			for (const a of apps.values()) out[a.status] = (out[a.status] || 0) + 1;
			return out;
		},

		async listResumes(applicationId) {
			return resumes.filter((r) => r.application_id === applicationId).sort((a, b) => a.attempt - b.attempt || a.uploaded_at - b.uploaded_at).map(noData);
		},
		async countResumes(applicationId, attempt) {
			return resumes.filter((r) => r.application_id === applicationId && r.attempt === attempt).length;
		},
		async findResumeByHash(applicationId, attempt, sha256) {
			const r = resumes.find((x) => x.application_id === applicationId && x.attempt === attempt && x.sha256 === sha256);
			return r ? noData(r) : null;
		},
		async addResume(row) {
			if (resumes.some((r) => r.application_id === row.application_id && r.attempt === row.attempt && r.sha256 === row.sha256)) return null; // unique version key
			const r = { uploaded_at: stamp(), ...clone(row) };
			resumes.push(r);
			return noData(r);
		},
		async getResumeWithData(id) {
			return clone(resumes.find((r) => r.id === id) || null);
		},

		async getProfile(userId) {
			return clone(profiles.get(userId) || null);
		},
		async listProfiles({ q, status, page, pageSize }) {
			let rows = [...profiles.values()];
			if (status) rows = rows.filter((p) => p.status === status);
			if (q) rows = rows.filter((p) => `${fullName(users.get(p.user_id))} ${users.get(p.user_id).email}`.toLowerCase().includes(q.toLowerCase()));
			rows.sort((a, b) => b.approved_at - a.approved_at);
			const slice = rows.slice((page - 1) * pageSize, page * pageSize);
			return {
				rows: slice.map((p) => {
					const u = users.get(p.user_id);
					const a = apps.get(p.application_id) || {};
					return { ...clone(p), name: fullName(u), email: u.email, phone: a.phone || u.phone || "", city: a.city, state: a.state };
				}),
				count: rows.length,
			};
		},
		async profileCounts() {
			const out = {};
			for (const p of profiles.values()) out[p.status] = (out[p.status] || 0) + 1;
			return out;
		},
		async updateProfileIf(userId, { version }, patch) {
			const p = profiles.get(userId);
			if (!p || p.version !== version) return null;
			Object.assign(p, clone(patch), { version: version + 1, updated_at: stamp() });
			return clone(p);
		},
	};
	return repo;
}
