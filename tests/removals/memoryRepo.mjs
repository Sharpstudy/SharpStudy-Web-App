// In-memory stand-in for lib/removals/repo.js. Same interface and semantics where it matters:
//  - transaction(fn) rolls EVERYTHING back if fn throws (tables are snapshotted and restored);
//  - pending_key is unique among non-null values (like the database index);
//  - deleteInstructorLink removes only rows with relation = 'instructor' for that exact learner + user;
//  - decide() only changes a request that is still pending.
// `protectedTables` are the records an approval must never touch.
import { ServiceError } from "../../lib/mastery/service.js";

export const PROTECTED = ["users", "learners", "enrolments", "assignments", "attempts", "progress", "certificates", "attendance", "courseEnrolments"];
const MUTABLE = ["guardians", "requests", "audit", "notifications"];
const clone = (x) => structuredClone(x);

export function createRemovalRepo(seed = {}) {
	const db = { users: [], learners: [], guardians: [], requests: [], audit: [], notifications: [], enrolments: [], assignments: [], attempts: [], progress: [], certificates: [], attendance: [], courseEnrolments: [], ...seed };
	const hooks = { failAudit: false, failNotification: false, loseRace: false };
	const find = (t, f) => db[t].find(f);

	const txApi = {
		async insertRequest(row) {
			if (row.pending_key && db.requests.some((r) => r.pending_key === row.pending_key)) throw new ServiceError(409, "duplicate_pending", "A removal request for this student is already waiting for approval.");
			db.requests.push(clone(row));
		},
		async lockRequest(id) {
			const r = find("requests", (x) => x.id === id);
			return r ? clone(r) : null;
		},
		async getLearner(id) {
			const l = find("learners", (x) => x.id === id);
			return l ? clone(l) : null;
		},
		async recipientsFor(learner) {
			return [learner.owner_user_id, learner.student_user_id, ...db.guardians.filter((g) => g.learner_id === learner.id && g.relation === "parent").map((g) => g.user_id)].filter(Boolean);
		},
		async deleteInstructorLink(learnerId, instructorId) {
			const before = db.guardians.length;
			db.guardians = db.guardians.filter((g) => !(g.learner_id === learnerId && g.user_id === instructorId && g.relation === "instructor"));
			return before - db.guardians.length;
		},
		async decide(id, patch) {
			if (hooks.loseRace) return 0;
			const r = find("requests", (x) => x.id === id && x.status === "pending");
			if (!r) return 0;
			Object.assign(r, patch);
			return 1;
		},
		async audit(row) {
			if (hooks.failAudit) throw new Error("audit table unavailable");
			db.audit.push(clone(row));
		},
	};

	const repo = {
		db,
		hooks,
		async transaction(fn) {
			const snap = Object.fromEntries(MUTABLE.map((t) => [t, clone(db[t])]));
			try {
				return await fn(txApi);
			} catch (e) {
				for (const t of MUTABLE) db[t] = snap[t];
				throw e;
			}
		},
		async getLearner(id) {
			const l = find("learners", (x) => x.id === id);
			return l ? clone(l) : null;
		},
		async getGuardian(learnerId, userId) {
			const g = find("guardians", (x) => x.learner_id === learnerId && x.user_id === userId);
			return g ? clone(g) : null;
		},
		async findPending(instructorId, learnerId) {
			const r = find("requests", (x) => x.instructor_id === instructorId && x.learner_id === learnerId && x.status === "pending");
			return r ? clone(r) : null;
		},
		async getRequest(id) {
			const r = find("requests", (x) => x.id === id);
			return r ? clone(r) : null;
		},
		async listByInstructor(instructorId) {
			return clone(db.requests.filter((r) => r.instructor_id === instructorId)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
		},
		async listAll(status) {
			return clone(db.requests.filter((r) => !status || r.status === status)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
		},
		async getUsersByIds(ids) {
			return clone(db.users.filter((u) => ids.includes(u.id)));
		},
		async listAdminIds() {
			return db.users.filter((u) => u.role === "admin" && u.status === true).map((u) => u.id);
		},
		async insertNotification(row) {
			if (hooks.failNotification) throw new Error("notifications unavailable");
			if (db.notifications.some((n) => n.dedupe_key === row.dedupe_key)) return null; // unique dedupe_key
			db.notifications.push(clone(row));
			return clone(row);
		},
	};
	return repo;
}

// A small, realistic world.
export const ID = {
	admin: "a0000000-0000-4000-8000-000000000001",
	admin2: "a0000000-0000-4000-8000-000000000002",
	instA: "10000000-0000-4000-8000-00000000000a",
	instB: "10000000-0000-4000-8000-00000000000b",
	parent: "20000000-0000-4000-8000-000000000001",
	parent2: "20000000-0000-4000-8000-000000000002",
	owner: "30000000-0000-4000-8000-000000000001", // the family account that owns the profile
	studentAcct: "40000000-0000-4000-8000-000000000001", // a student account linked to the profile
	student2: "40000000-0000-4000-8000-000000000002",
	L1: "50000000-0000-4000-8000-000000000001", // owned by `owner`; instructors A and B linked; a parent linked
	L2: "50000000-0000-4000-8000-000000000002", // owned by `owner`; instructor A linked
	L3: "50000000-0000-4000-8000-000000000003", // owned by instructor A
	L4: "50000000-0000-4000-8000-000000000004", // owned by `owner`; only instructor B linked
};
const u = (id, role, first, extra = {}) => ({ id, role, first_name: first, last_name: "Test", email: `${first.toLowerCase()}@example.com`, status: true, ...extra });

export function world() {
	const g = (learner, user, relation) => ({ id: `g-${learner.slice(0, 2)}-${user.slice(0, 2)}-${relation}`, learner_id: learner, user_id: user, relation });
	return createRemovalRepo({
		users: [u(ID.admin, "admin", "Admin"), u(ID.admin2, "admin", "Admintwo"), u(ID.instA, "instructor", "Ann"), u(ID.instB, "instructor", "Ben"), u(ID.parent, "student", "Parent"), u(ID.parent2, "student", "Parenttwo"), u(ID.owner, "student", "Owner"), u(ID.studentAcct, "student", "Stu"), u(ID.student2, "student", "Stutwo")],
		learners: [
			{ id: ID.L1, owner_user_id: ID.owner, display_name: "Kid One", student_user_id: ID.studentAcct },
			{ id: ID.L2, owner_user_id: ID.owner, display_name: "Kid Two", student_user_id: null },
			{ id: ID.L3, owner_user_id: ID.instA, display_name: "Own Profile", student_user_id: null },
			{ id: ID.L4, owner_user_id: ID.owner, display_name: "Kid Four", student_user_id: null },
		],
		guardians: [g(ID.L1, ID.instA, "instructor"), g(ID.L1, ID.instB, "instructor"), g(ID.L1, ID.parent, "parent"), g(ID.L1, ID.parent2, "parent"), g(ID.L2, ID.instA, "instructor"), g(ID.L4, ID.instB, "instructor"), g(ID.L3, ID.parent, "parent")],
		// Records an approval must never touch:
		enrolments: [{ userId: ID.studentAcct, courseId: "c1", status: "paid" }, { userId: ID.student2, courseId: "c1", status: "paid" }],
		courseEnrolments: [{ id: "ce1", userId: ID.studentAcct, courseId: "c1", status: "paid", amount: 4900 }],
		assignments: [{ id: "as1", created_by: ID.instA, learner_id: ID.L1, title: "Fractions" }, { id: "as2", created_by: ID.instB, learner_id: ID.L1, title: "Decimals" }],
		attempts: [{ id: "at1", learner_id: ID.L1, score: 9 }, { id: "at2", learner_id: ID.L2, score: 7 }],
		progress: [{ learner_id: ID.L1, subject: "math", level: "3A", stars: 12 }],
		certificates: [{ id: "ce", learner_id: ID.L1, title: "Level 2" }],
		attendance: [{ id: "att1", class_id: "k1", participant_key: `u:${ID.studentAcct}`, status: "present" }],
	});
}

export const actor = (userId, role, extra = {}) => ({ kind: "account", userId, role, name: `${role}-${userId.slice(0, 2)}`, ...extra });
export const snapshotProtected = (repo) => JSON.stringify(Object.fromEntries(PROTECTED.map((t) => [t, repo.db[t]])));
