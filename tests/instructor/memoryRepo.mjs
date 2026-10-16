// In-memory repository with the same semantics as lib/instructor-applications/repo.js.
import { randomUUID } from "node:crypto";

export function createApplicationRepo({ users = [], categories = [] } = {}) {
	const db = { users: users.map((u) => ({ status: true, email_confirmed: true, role: "student", phone: "", profile_photo: "", ...u })), categories: [...categories], apps: [], events: [], profiles: [] };
	const clone = (x) => (x ? structuredClone(x) : null);
	const stamp = () => new Date();
	const repo = {
		_db: db,
		async getUser(id) {
			return clone(db.users.find((u) => u.id === id));
		},
		async findByUser(userId) {
			return clone(db.apps.find((a) => a.user_id === userId));
		},
		async findById(id) {
			return clone(db.apps.find((a) => a.id === id));
		},
		async listEvents(id) {
			return db.events.filter((e) => e.application_id === id).map(clone);
		},
		async listCategories() {
			return clone(db.categories);
		},
		async findCategories(ids) {
			return clone(db.categories.filter((c) => ids.includes(c.id)));
		},
		async createApplication(row, event) {
			if (db.apps.some((a) => a.user_id === row.user_id)) throw new Error("duplicate user");
			const a = { id: randomUUID(), attempt: 1, version: 0, admin_notes: null, rubric: null, applicant_feedback: null, submitted_at: null, reviewed_by: null, reviewed_at: null, decided_at: null, reapply_after: null, notify_kind: null, notify_status: "none", notify_error: null, agreed_policies: false, consented_privacy: false, created_at: stamp(), ...clone(row) };
			db.apps.push(a);
			db.events.push({ id: randomUUID(), application_id: a.id, created_at: stamp(), ...clone(event) });
			return clone(a);
		},
		async updateIf(id, { version, statuses }, patch, event) {
			const a = db.apps.find((x) => x.id === id);
			if (!a || a.version !== version || !statuses.includes(a.status)) return null;
			Object.assign(a, clone(patch), { version: version + 1, updated_at: stamp() });
			if (event) db.events.push({ id: randomUUID(), application_id: id, created_at: stamp(), ...clone(event) });
			return clone(a);
		},
		async transition(id, guard, patch, event, userEffect) {
			const a = db.apps.find((x) => x.id === id);
			if (!a || a.version !== guard.version || !guard.statuses.includes(a.status)) return null;
			if (repo._failNextTransition) {
				repo._failNextTransition = false;
				throw new Error("simulated database failure"); // nothing has been written yet = rolled back
			}
			Object.assign(a, clone(patch), { version: guard.version + 1, updated_at: stamp() });
			if (userEffect && userEffect.setRole) {
				const u = db.users.find((x) => x.id === userEffect.userId);
				if (u && u.role === userEffect.setRole.from) u.role = userEffect.setRole.to;
				if (userEffect.profile) {
					const p = db.profiles.find((x) => x.user_id === userEffect.userId);
					if (p) for (const k of Object.keys(userEffect.profile)) p[k] = p[k] || userEffect.profile[k];
					else db.profiles.push({ user_id: userEffect.userId, ...clone(userEffect.profile) });
				}
			}
			db.events.push({ id: randomUUID(), application_id: id, created_at: stamp(), ...clone(event) });
			return clone(a);
		},
		async setNotify(id, patch) {
			Object.assign(db.apps.find((x) => x.id === id), patch);
		},
		async list({ q, status, page, pageSize }) {
			let rows = db.apps.filter((a) => (status ? a.status === status : a.status !== "draft"));
			const owner = (a) => db.users.find((u) => u.id === a.user_id) || {};
			if (q) {
				const n = q.toLowerCase();
				rows = rows.filter((a) => [a.full_name, owner(a).email, owner(a).first_name, owner(a).last_name].some((s) => String(s || "").toLowerCase().includes(n)));
			}
			rows.sort((a, b) => +new Date(b.submitted_at || b.created_at) - +new Date(a.submitted_at || a.created_at));
			const slice = rows.slice((page - 1) * pageSize, page * pageSize).map((a) => ({ ...clone(a), applicant_email: owner(a).email || "", applicant_name: `${owner(a).first_name || ""} ${owner(a).last_name || ""}`.trim() }));
			return { rows: slice, count: rows.length };
		},
		async counts() {
			const out = {};
			for (const a of db.apps) out[a.status] = (out[a.status] || 0) + 1;
			return out;
		},
	};
	return repo;
}
