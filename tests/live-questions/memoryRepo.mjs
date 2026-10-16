// In-memory repository with the same semantics as lib/live-questions/repo.js.
export function createLiveRepo() {
	const db = {
		courses: [],
		enrolments: [], // { userId, courseId }
		users: [], // { id, name }
		questions: [],
		responses: [],
		images: [],
		sessions: [], // lc_classes rows
		seats: [], // { class_id, participant_key, user_id, display_name }
		quizQuestions: [], // { id, quizTitle, instructorId, text, options: [{text,isCorrect}] }
	};
	const clone = (x) => (x ? structuredClone(x) : null);
	return {
		_db: db,
		async getCourseBySlug(slug) {
			return clone(db.courses.find((c) => c.slug === slug));
		},
		async getCourseById(id) {
			return clone(db.courses.find((c) => c.id === id));
		},
		async getSession(id) {
			return clone(db.sessions.find((s) => s.id === id));
		},
		async getSeat(classId, key) {
			return clone(db.seats.find((s) => s.class_id === classId && s.participant_key === key));
		},
		async hasPaidEnrolment(userId, courseId) {
			return db.enrolments.some((e) => e.userId === userId && e.courseId === courseId && (e.status || "paid") === "paid");
		},
		async listSessionParticipants(classId) {
			return db.seats.filter((s) => s.class_id === classId && s.user_id).map((s) => ({ id: s.user_id, name: s.display_name }));
		},
		async isEnrolled(userId, courseId) {
			return db.enrolments.some((e) => e.userId === userId && e.courseId === courseId);
		},
		async listEnrolledUsers(courseId) {
			const ids = [...new Set(db.enrolments.filter((e) => e.courseId === courseId).map((e) => e.userId))];
			return ids.map((id) => ({ id, name: (db.users.find((u) => u.id === id) || {}).name || "" }));
		},
		async getQuestion(id) {
			return clone(db.questions.find((q) => q.id === id));
		},
		async listQuestions(courseId, classId = null) {
			return db.questions.filter((q) => q.course_id === courseId && (q.class_id || null) === classId).sort((a, b) => a.seq - b.seq).map(clone);
		},
		async maxSeq(courseId, classId = null) {
			return Math.max(0, ...db.questions.filter((q) => q.course_id === courseId && (q.class_id || null) === classId).map((q) => q.seq));
		},
		async insertQuestion(row) {
			db.questions.push({ closed_at: null, opened_at: null, deadline_at: null, revealed_at: null, ...clone(row) });
			return clone(row);
		},
		async deleteQuestion(id) {
			db.questions = db.questions.filter((q) => q.id !== id);
		},
		async updateQuestion(id, patch, { whereStatus } = {}) {
			const q = db.questions.find((x) => x.id === id);
			if (!q || (whereStatus && q.status !== whereStatus)) return null;
			Object.assign(q, patch);
			return clone(q);
		},
		async closeOpenQuestions(courseId, exceptId, now, classId = null) {
			for (const q of db.questions) {
				if (q.course_id === courseId && (q.class_id || null) === classId && q.status === "open" && q.id !== exceptId) Object.assign(q, { status: "closed", closed_at: now });
			}
		},
		async getImage(id) {
			return clone(db.images.find((i) => i.id === id));
		},
		async insertImage(row) {
			db.images.push(clone(row));
			return { id: row.id };
		},
		async countImages(courseId, classId, uploaderId) {
			return db.images.filter((i) => i.course_id === courseId && (i.class_id || null) === classId && i.uploader_id === uploaderId).length;
		},
		async getResponse(qid, userId) {
			return clone(db.responses.find((r) => r.live_question_id === qid && r.user_id === userId));
		},
		async listResponses(qid) {
			return db.responses.filter((r) => r.live_question_id === qid).map(clone);
		},
		async insertResponse(row) {
			if (db.responses.some((r) => r.live_question_id === row.live_question_id && r.user_id === row.user_id)) {
				const e = new Error("duplicate response");
				e.code = "duplicate_response";
				throw e;
			}
			db.responses.push(clone(row));
			return clone(row);
		},
		async updateResponse(id, patch) {
			const r = db.responses.find((x) => x.id === id);
			Object.assign(r, patch);
			return clone(r);
		},
		async listQuizQuestions(instructorId) {
			return db.quizQuestions.filter((q) => q.instructorId === instructorId).map(clone);
		},
	};
}
