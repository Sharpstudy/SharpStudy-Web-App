// In-memory repository with the same semantics as lib/live-sessions/repo.js.
// atomic() serialises callers per key like the row lock does in MySQL, and yields
// to the event loop so tests can prove that concurrent callers cannot both win.
export function createSessionRepo() {
	const db = { courses: [], enrolments: [], users: [], sessions: [], seats: [], attendance: [], notifications: [] };
	const clone = (x) => (x ? structuredClone(x) : null);
	const locks = new Map();
	const tick = () => new Promise((r) => setImmediate(r));
	const repo = {
		_db: db,
		async atomic(keys, fn) {
			const list = [...new Set([].concat(keys))].sort();
			const releases = [];
			for (const key of list) {
				const prev = locks.get(key) || Promise.resolve();
				let release;
				const mine = new Promise((r) => (release = r));
				locks.set(key, prev.then(() => mine));
				await prev;
				releases.push(release);
			}
			try {
				await tick();
				return await fn(repo);
			} finally {
				releases.forEach((r) => r());
			}
		},
		async listEligibleStudents(courseId, { ids } = {}) {
			const seen = new Set();
			return db.enrolments
				.filter((e) => e.courseId === courseId && e.status === "paid" && (!ids || ids.includes(e.userId)))
				.filter((e) => (seen.has(e.userId) ? false : seen.add(e.userId)))
				.map((e) => {
					const u = db.users.find((x) => x.id === e.userId) || {};
					return { id: e.userId, name: u.name || e.userId, email: u.email || `${e.userId}@example.test` };
				});
		},
		async getUsers(ids) {
			return ids.map((id) => {
				const u = db.users.find((x) => x.id === id) || {};
				return { id, name: u.name || id, email: u.email || `${id}@example.test`, emailConfirmed: u.emailConfirmed !== false };
			});
		},
		async insertNotification(row) {
			if (db.notifications.some((n) => n.dedupe_key === row.dedupe_key)) return null;
			db.notifications.push({ read_at: null, email_status: "none", created_at: new Date(), ...structuredClone(row) });
			return clone(db.notifications.at(-1));
		},
		async updateNotification(id, patch) {
			Object.assign(db.notifications.find((n) => n.id === id), patch);
		},
		async listNotifications(userId, limit = 30) {
			return db.notifications.filter((n) => n.user_id === userId).slice().reverse().slice(0, limit).map(clone);
		},
		async countUnread(userId) {
			return db.notifications.filter((n) => n.user_id === userId && !n.read_at).length;
		},
		async markRead(userId, ids, now) {
			for (const n of db.notifications) if (n.user_id === userId && !n.read_at && (!ids || ids.includes(n.id))) n.read_at = now;
		},
		async getCourses(ids) {
			return db.courses.filter((c) => ids.includes(c.id)).map(clone);
		},
		async hasPaidEnrolment(userId, courseId) {
			return db.enrolments.some((e) => e.userId === userId && e.courseId === courseId && e.status === "paid");
		},
		async listPaidCourseIds(userId) {
			return db.enrolments.filter((e) => e.userId === userId && e.status === "paid").map((e) => e.courseId);
		},
		async getSession(id) {
			return clone(db.sessions.find((s) => s.id === id));
		},
		async insertSession(row) {
			await tick();
			db.sessions.push({ started_at: null, ended_at: null, cancelled_at: null, ...clone(row) });
			return clone(db.sessions.at(-1));
		},
		async updateSession(id, patch, { whereStatus } = {}) {
			const s = db.sessions.find((x) => x.id === id);
			if (!s || (whereStatus && s.status !== whereStatus)) return null;
			Object.assign(s, patch);
			return clone(s);
		},
		async getSessionsByIds(ids) {
			return db.sessions.filter((s) => ids.includes(s.id)).map(clone);
		},
		async listActiveSessions(instructorId) {
			return db.sessions.filter((s) => s.instructor_id === instructorId && ["scheduled", "live"].includes(s.status)).map(clone);
		},
		async listInstructorSessions(instructorId) {
			return db.sessions.filter((s) => s.instructor_id === instructorId).map(clone);
		},
		async listAllSessions() {
			return db.sessions.map(clone);
		},
		async listSessionsForParticipant(key) {
			const ids = db.seats.filter((s) => s.participant_key === key).map((s) => s.class_id);
			return db.sessions.filter((s) => ids.includes(s.id)).map(clone);
		},
		async listOpenSessionsForCourses(courseIds, now) {
			return db.sessions.filter((s) => courseIds.includes(s.course_id) && s.status === "scheduled" && new Date(s.end_at) > now).map(clone);
		},
		async getSeat(classId, key) {
			return clone(db.seats.find((s) => s.class_id === classId && s.participant_key === key));
		},
		async countSeats(classId) {
			return db.seats.filter((s) => s.class_id === classId).length;
		},
		async listSeats(classId) {
			return db.seats.filter((s) => s.class_id === classId).map(clone);
		},
		async insertSeat(row) {
			if (db.seats.some((s) => s.class_id === row.class_id && s.participant_key === row.participant_key)) {
				const e = new Error("duplicate_seat");
				e.code = "duplicate_seat";
				throw e;
			}
			db.seats.push({ created_at: new Date(), ...clone(row) });
			return clone(row);
		},
		async deleteSeat(classId, key) {
			db.seats = db.seats.filter((s) => !(s.class_id === classId && s.participant_key === key));
		},
		async getAttendance(classId, key) {
			return clone(db.attendance.find((a) => a.class_id === classId && a.participant_key === key));
		},
		async listAttendance(classId) {
			return db.attendance.filter((a) => a.class_id === classId).map(clone);
		},
		async insertAttendance(row) {
			if (db.attendance.some((a) => a.class_id === row.class_id && a.participant_key === row.participant_key)) {
				const e = new Error("duplicate_attendance");
				e.code = "duplicate_attendance";
				throw e;
			}
			db.attendance.push(clone(row));
			return clone(row);
		},
		async updateAttendance(id, patch) {
			Object.assign(db.attendance.find((a) => a.id === id), patch);
		},
	};
	return repo;
}
