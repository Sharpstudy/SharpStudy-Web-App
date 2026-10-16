// In-memory implementation of the Mastery Ladder repository interface used by
// lib/mastery/service.js. Mirrors lib/mastery-server/repo.js semantics,
// including the unique (learner_id, client_attempt_id) constraint and
// optimistic progress versions.

let seq = 0;
const id = () => `id-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

export function createMemoryRepo() {
	const db = {
		users: [],
		learners: [],
		guardians: [],
		enrolments: [],
		progress: [],
		attempts: [],
		activity: [],
		hints: [],
		audit: [],
		settings: new Map(),
		feedback: [],
		roles: [],
		userRoles: [],
		presence: [],
		assignments: [],
		targets: [],
	};
	const repo = {
		_db: db,
		// users
		async getUserWithPassword(uid) {
			return clone(db.users.find((u) => u.id === uid)) || null;
		},
		async getUser(uid) {
			return clone(db.users.find((u) => u.id === uid)) || null;
		},
		async findUserByEmail(email) {
			return clone(db.users.find((u) => u.email === email)) || null;
		},
		async listUsers({ q = "" } = {}) {
			const rows = db.users.filter((u) => !q || u.email.includes(q)).map(clone);
			return { rows, count: rows.length };
		},
		async setUserRole(uid, role) {
			const u = db.users.find((x) => x.id === uid);
			if (u) u.role = role;
		},
		// roles
		async listRoles() {
			return db.roles.map(clone);
		},
		async getRole(rid) {
			return clone(db.roles.find((r) => r.id === rid)) || null;
		},
		async createRole(r) {
			const row = { id: id(), ...r };
			db.roles.push(row);
			return clone(row);
		},
		async updateRole(rid, patch) {
			const r = db.roles.find((x) => x.id === rid);
			Object.assign(r, patch);
			return clone(r);
		},
		async deleteRole(rid) {
			db.roles = db.roles.filter((r) => r.id !== rid);
			db.userRoles = db.userRoles.filter((ur) => ur.role_id !== rid);
		},
		async getUserRoleIds(uid) {
			return db.userRoles.filter((ur) => ur.user_id === uid).map((ur) => ur.role_id);
		},
		async setUserRoles(uid, roleIds) {
			db.userRoles = db.userRoles.filter((ur) => ur.user_id !== uid);
			for (const rid of roleIds) db.userRoles.push({ user_id: uid, role_id: rid });
		},
		async permissionsForUser(uid) {
			const ids = db.userRoles.filter((ur) => ur.user_id === uid).map((ur) => ur.role_id);
			return db.roles.filter((r) => ids.includes(r.id)).flatMap((r) => r.permissions || []);
		},
		// learners
		async getLearner(lid) {
			return clone(db.learners.find((l) => l.id === lid)) || null;
		},
		async listLearnersByOwner(uid) {
			return db.learners.filter((l) => l.owner_user_id === uid).map(clone);
		},
		async listLearnersByGuardian(uid) {
			const links = db.guardians.filter((g) => g.user_id === uid);
			return links
				.map((g) => {
					const l = db.learners.find((x) => x.id === g.learner_id);
					return l && { ...clone(l), _relation: g.relation };
				})
				.filter(Boolean);
		},
		async listAllLearners({ q = "" } = {}) {
			return db.learners.filter((l) => !q || l.display_name.includes(q)).map(clone);
		},
		async createLearner(row) {
			const l = { created_at: new Date().toISOString(), ...row };
			db.learners.push(l);
			return clone(l);
		},
		async updateLearner(lid, patch) {
			if (patch.student_user_id && db.learners.some((x) => x.id !== lid && x.student_user_id === patch.student_user_id)) {
				const e = new Error("duplicate_link");
				e.code = "duplicate_link";
				throw e;
			}
			const l = db.learners.find((x) => x.id === lid);
			Object.assign(l, clone(patch));
			return clone(l);
		},
		async deleteLearner(lid) {
			db.learners = db.learners.filter((l) => l.id !== lid);
			for (const k of ["guardians", "enrolments", "progress", "attempts", "activity", "hints", "targets"]) {
				db[k] = db[k].filter((r) => r.learner_id !== lid);
			}
		},
		// guardians
		async getGuardian(lid, uid) {
			return clone(db.guardians.find((g) => g.learner_id === lid && g.user_id === uid)) || null;
		},
		async listGuardians(lid) {
			return db.guardians.filter((g) => g.learner_id === lid).map((g) => {
				const u = db.users.find((x) => x.id === g.user_id);
				return { userId: g.user_id, relation: g.relation, email: u && u.email };
			});
		},
		async addGuardian(row) {
			if (!db.guardians.some((g) => g.learner_id === row.learner_id && g.user_id === row.user_id)) db.guardians.push({ ...row });
		},
		async removeGuardian(lid, uid) {
			db.guardians = db.guardians.filter((g) => !(g.learner_id === lid && g.user_id === uid));
		},
		// enrolments
		async listEnrolments(lid) {
			return db.enrolments.filter((e) => e.learner_id === lid).map(clone);
		},
		async upsertEnrolment(lid, subject, active) {
			const e = db.enrolments.find((x) => x.learner_id === lid && x.subject === subject);
			if (e) e.active = active;
			else db.enrolments.push({ learner_id: lid, subject, active });
		},
		// progress
		async getProgress(lid, subject) {
			return clone(db.progress.find((p) => p.learner_id === lid && p.subject === subject)) || null;
		},
		async upsertProgress(lid, subject, pos, { expectedVersion, force } = {}) {
			const p = db.progress.find((x) => x.learner_id === lid && x.subject === subject);
			if (!p) {
				db.progress.push({ learner_id: lid, subject, level_id: pos.levelId, set_id: pos.setId, worksheet_no: pos.worksheetNo, version: 1 });
				return true;
			}
			if (!force && p.version !== expectedVersion) return false;
			Object.assign(p, { level_id: pos.levelId, set_id: pos.setId, worksheet_no: pos.worksheetNo, version: p.version + 1 });
			return true;
		},
		// attempts
		async findAttemptByClientId(lid, cid) {
			return clone(db.attempts.find((a) => a.learner_id === lid && a.client_attempt_id === cid)) || null;
		},
		async countAttempts(lid, { subject, levelId, setId, worksheetNo }) {
			return db.attempts.filter(
				(a) => a.learner_id === lid && a.subject === subject && a.level_id === levelId && a.set_id === setId && a.worksheet_no === worksheetNo
			).length;
		},
		async createAttempt(row) {
			if (db.attempts.some((a) => a.learner_id === row.learner_id && a.client_attempt_id === row.client_attempt_id)) return false;
			db.attempts.push(clone(row));
			return true;
		},
		// instructor student directory
		async listLearnersByStudent(uid) {
			return db.learners.filter((l) => l.student_user_id === uid).map(clone);
		},
		async listCoursesByOwner(uid, { all = false } = {}) {
			return (db.courses || []).filter((c) => all || c.userId === uid).map(clone);
		},
		async listPaidEnrolments(courseIds) {
			return (db.courseEnrolments || []).filter((e) => courseIds.includes(e.courseId) && e.status === "paid").map(clone);
		},
		async getUsersByIds(ids) {
			return db.users.filter((u) => ids.includes(u.id)).map(clone);
		},
		async lessonStats(courseIds, userIds) {
			const totals = {};
			for (const c of courseIds) totals[c] = (db.lessons || {})[c] || 0;
			const done = {};
			for (const [k, v] of Object.entries(db.lessonsDone || {})) if (userIds.includes(k.split("|")[0])) done[k] = v;
			return { totals, done };
		},
		async getCourseOwner(cid) {
			return clone((db.courses || []).find((c) => c.id === cid)) || null;
		},
		// assignments
		async createAssignment(row, learnerIds) {
			db.assignments.push({ created_at: new Date().toISOString(), ...clone(row) });
			for (const learner_id of learnerIds) db.targets.push({ id: id(), assignment_id: row.id, learner_id, started_at: null, attempt_id: null, completed_at: null });
			return clone(db.assignments.at(-1));
		},
		async getAssignment(aid) {
			return clone(db.assignments.find((a) => a.id === aid)) || null;
		},
		async updateAssignment(aid, patch) {
			const a = db.assignments.find((x) => x.id === aid);
			Object.assign(a, clone(patch));
			return clone(a);
		},
		async getAssignmentTarget(aid, lid) {
			return clone(db.targets.find((t) => t.assignment_id === aid && t.learner_id === lid)) || null;
		},
		async listAssignmentTargets(aid) {
			return db.targets.filter((t) => t.assignment_id === aid).map(clone);
		},
		async markAssignmentStarted(aid, lid, at) {
			const t = db.targets.find((x) => x.assignment_id === aid && x.learner_id === lid);
			if (!t || t.started_at) return false;
			t.started_at = new Date(at).toISOString();
			return true;
		},
		async markAssignmentCompleted(aid, lid, { attemptId, at }) {
			const t = db.targets.find((x) => x.assignment_id === aid && x.learner_id === lid);
			if (!t || t.completed_at) return false;
			Object.assign(t, { attempt_id: attemptId, completed_at: new Date(at).toISOString() });
			return true;
		},
		async listAssignmentRows({ learnerIds, createdBy } = {}) {
			return db.targets
				.filter((t) => (learnerIds || []).includes(t.learner_id))
				.map((t) => ({ assignment: db.assignments.find((a) => a.id === t.assignment_id), target: t }))
				.filter((r) => r.assignment && (!createdBy || r.assignment.created_by === createdBy))
				.map(clone);
		},
		async getAttemptsByIds(ids) {
			return db.attempts.filter((a) => ids.includes(a.id)).map(clone);
		},
		async updateAttempt(aid, patch) {
			Object.assign(db.attempts.find((a) => a.id === aid), patch);
		},
		async listAttempts(lid, { limit = 25 } = {}) {
			return db.attempts
				.filter((a) => a.learner_id === lid)
				.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
				.slice(0, limit)
				.map(clone);
		},
		async attemptStats(lid) {
			const list = db.attempts.filter((a) => a.learner_id === lid);
			return {
				count: list.length,
				accuracySum: list.reduce((s, a) => s + Number(a.accuracy), 0),
				durationMsSum: list.reduce((s, a) => s + a.duration_ms, 0),
				hintsSum: list.reduce((s, a) => s + (a.hints_used || 0), 0),
				lastCompletedAt: list.length ? list.map((a) => a.completed_at).sort().at(-1) : null,
			};
		},
		async deleteAttempts(lid, subject) {
			db.attempts = db.attempts.filter((a) => !(a.learner_id === lid && (!subject || a.subject === subject)));
		},
		// activity
		async listActivity(lid, from, to) {
			return db.activity.filter((a) => a.learner_id === lid && a.local_date >= from && a.local_date <= to).map(clone);
		},
		async addActivity(lid, date, delta) {
			let a = db.activity.find((x) => x.learner_id === lid && x.local_date === date);
			if (!a) {
				a = { learner_id: lid, local_date: date, worksheets: 0, stars: 0, seconds: 0 };
				db.activity.push(a);
			}
			a.worksheets += delta.worksheets || 0;
			a.stars += delta.stars || 0;
			a.seconds += delta.seconds || 0;
		},
		async deleteActivity(lid) {
			db.activity = db.activity.filter((a) => a.learner_id !== lid);
		},
		// hints
		async addHintEvent(row) {
			db.hints.push({ ...row });
		},
		async countHints(sid) {
			return db.hints.filter((h) => h.session_id === sid).length;
		},
		// audit
		async addAudit(row) {
			db.audit.push({ id: id(), created_at: new Date().toISOString(), ...clone(row) });
		},
		async listAudit({ action, learnerId, limit = 50 } = {}) {
			const rows = db.audit.filter((a) => (!action || a.action === action) && (!learnerId || a.learner_id === learnerId));
			return { rows: rows.slice(-limit).reverse(), count: rows.length };
		},
		// settings
		async getSetting(key) {
			return db.settings.has(key) ? clone(db.settings.get(key)) : null;
		},
		async setSetting(key, value) {
			db.settings.set(key, clone(value));
		},
		// feedback
		async createFeedback(row) {
			const f = { id: id(), status: "new", created_at: new Date().toISOString(), ...row };
			db.feedback.push(f);
			return clone(f);
		},
		async listFeedback({ status } = {}) {
			const rows = db.feedback.filter((f) => !status || f.status === status).map(clone);
			return { rows, count: rows.length };
		},
		async getFeedback(fid) {
			return clone(db.feedback.find((f) => f.id === fid)) || null;
		},
		async updateFeedback(fid, patch) {
			Object.assign(db.feedback.find((f) => f.id === fid), patch);
		},
		// presence
		async touchPresence(kind, sid, path) {
			const p = db.presence.find((x) => x.kind === kind && x.subject_id === sid);
			if (p) Object.assign(p, { path, last_seen_at: new Date().toISOString() });
			else db.presence.push({ kind, subject_id: sid, path, last_seen_at: new Date().toISOString() });
		},
		async listPresence(since) {
			return db.presence.filter((p) => new Date(p.last_seen_at) >= since).map(clone);
		},
		// global
		async globalReset(firstPositions) {
			const counts = { attempts: db.attempts.length, activity: db.activity.length, progress: db.progress.length };
			db.attempts = [];
			db.activity = [];
			db.hints = [];
			for (const p of db.progress) {
				const f = firstPositions[p.subject];
				Object.assign(p, { level_id: f.levelId, set_id: f.setId, worksheet_no: f.worksheetNo, version: p.version + 1 });
			}
			return counts;
		},
	};
	return repo;
}
