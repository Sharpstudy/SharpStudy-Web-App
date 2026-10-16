// The instructor's student directory: ONE row per person, built from three authorised sources.
//
//   account students  users with a PAID enrolment in a course the instructor owns
//                     (merged across courses, so a student in three courses is one row)
//   learner profiles  ml_learners the instructor owns or is linked to (see listLearners)
//   the bridge        ml_learners.student_user_id, an explicit link set by studentLinks.js
//
// Rows are never matched by display name or e-mail. A student with no linked profile is shown
// with "needs profile" and cannot be given a worksheet until an authorised link exists. The
// assignment counts come from assignmentModel (the same code every other view uses).

import { ServiceError, listLearners } from "./service.js";
import { assignmentsByLearner } from "./assignmentModel.js";
import { LEARNING_STATUS } from "./assignments.js";

export const PAGE_SIZE = 20;
export const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const DIRECTORY_STATUS = ["no_profile", ...LEARNING_STATUS];

const fail = (status, code, message) => {
	throw new ServiceError(status, code, message);
};

export function requireTeacher(actor) {
	if (!actor || actor.kind !== "account") fail(401, "unauthorized", "Sign in first");
	if (actor.role !== "instructor" && actor.role !== "admin") fail(403, "forbidden", "Only instructors can use the student directory");
}

const learningStatus = (c) => (c.assigned === 0 ? "no_work" : c.overdue > 0 ? "overdue" : c.inProgress > 0 ? "in_progress" : c.pending > 0 ? "not_started" : "all_done");
const fullName = (u) => `${u.first_name || ""} ${u.last_name || ""}`.trim() || "Former student";
const iso = (d) => (d ? new Date(d).toISOString() : null);

// The students the instructor teaches: [{ userId, courseId, enrolledAt }] over the instructor's own courses.
export async function teachingEnrolments(repo, actor) {
	const courses = await repo.listCoursesByOwner(actor.userId);
	const enrolments = await repo.listPaidEnrolments(courses.map((c) => c.id));
	return { courses, enrolments };
}

export async function studentDirectory(repo, actor, filters = {}, ctx = {}) {
	requireTeacher(actor);
	const now = ctx.now || Date.now();
	const { courses, enrolments } = await teachingEnrolments(repo, actor);
	const own = new Map(courses.map((c) => [c.id, c.title]));
	if (filters.courseId && !own.has(String(filters.courseId))) fail(403, "forbidden", "You do not teach this course.");

	const userIds = [...new Set(enrolments.map((e) => e.userId))];
	const users = new Map((await repo.getUsersByIds(userIds)).map((u) => [u.id, u]));
	const stats = await repo.lessonStats(courses.map((c) => c.id), userIds);

	// Learner profiles in the instructor's scope, plus the profile (if any) linked to each enrolled student.
	const scope = new Map((await listLearners(repo, actor)).map((l) => [l.id, l]));
	const linkedTo = new Map(); // student user id -> raw learner
	for (const id of userIds) {
		const [l] = await repo.listLearnersByStudent(id);
		if (l) linkedTo.set(id, l);
	}

	const learnerIdsInRows = new Set();
	const people = [];
	for (const id of userIds) {
		const u = users.get(id);
		const raw = linkedTo.get(id);
		const learner = raw ? scope.get(raw.id) : null;
		if (learner) learnerIdsInRows.add(learner.id);
		people.push({
			type: "account",
			key: `u:${id}`,
			userId: id,
			name: u ? fullName(u) : "Former student",
			email: u ? u.email : "",
			photo: u ? u.profile_photo || null : null,
			learner,
			profileState: learner ? "linked" : raw ? "managed_elsewhere" : "needs_profile",
			courses: enrolments
				.filter((e) => e.userId === id)
				.map((e) => ({ id: e.courseId, title: own.get(e.courseId), enrolledAt: iso(e.created_at), lessons: stats.totals[e.courseId] || 0, completed: stats.done[`${id}|${e.courseId}`] || 0 }))
				.sort((a, b) => a.title.localeCompare(b.title)),
		});
	}
	for (const l of scope.values()) {
		if (l.relation === "self" || learnerIdsInRows.has(l.id)) continue;
		people.push({ type: "profile", key: `l:${l.id}`, userId: null, name: l.displayName, email: "", photo: null, learner: l, profileState: "profile_only", courses: [] });
	}

	// Per-learner facts, with the same visibility rule as the Family dashboard: an instructor who is only
	// LINKED to a learner sees the assignments they gave; owners and parents see all.
	const learners = people.map((p) => p.learner).filter(Boolean);
	const limited = learners.filter((l) => l.relation === "instructor").map((l) => l.id);
	const full = learners.filter((l) => l.relation !== "instructor").map((l) => l.id);
	const work = new Map([...(await assignmentsByLearner(repo, full, now)), ...(await assignmentsByLearner(repo, limited, now, { createdBy: actor.userId }))]);

	const rows = [];
	for (const p of people) {
		const l = p.learner;
		let counts = { assigned: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 };
		let subjects = [];
		let last = null;
		let courseIdsWithWork = [];
		if (l) {
			subjects = (await repo.listEnrolments(l.id)).filter((e) => e.active).map((e) => e.subject);
			const w = work.get(l.id);
			counts = w.counts;
			courseIdsWithWork = w.items.map((i) => i.courseId).filter(Boolean);
			const st = await repo.attemptStats(l.id);
			last = st && st.lastCompletedAt ? iso(st.lastCompletedAt) : null;
		}
		rows.push({
			key: p.key,
			type: p.type,
			userId: p.userId,
			learnerId: l ? l.id : null,
			name: p.name,
			email: p.email,
			photo: p.photo,
			avatar: l ? l.avatar : null,
			grade: l ? l.grade : null,
			gradeLabel: l ? l.gradeLabel : null,
			age: l ? l.age : null,
			subjects,
			courses: p.courses,
			counts,
			status: l ? learningStatus(counts) : "no_profile",
			lastActivityAt: last,
			profileState: p.profileState,
			relation: l ? l.relation : null,
			// The server re-checks every id at assignment time; this only drives the buttons.
			canAssign: !!l && l.relation !== "self",
			_courseIdsWithWork: courseIdsWithWork,
		});
	}

	const summary = {
		total: rows.length,
		activeLearners: rows.filter((r) => r.lastActivityAt && now - new Date(r.lastActivityAt).getTime() <= ACTIVE_WINDOW_MS).length,
		openAssignments: rows.reduce((n, r) => n + r.counts.pending + r.counts.inProgress, 0),
		completedAssignments: rows.reduce((n, r) => n + r.counts.completed, 0),
		needProfile: rows.filter((r) => r.profileState === "needs_profile").length,
	};

	const q = String(filters.q || "").trim().toLowerCase();
	let out = rows.filter((r) => {
		if (q && !r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false;
		if (filters.courseId && !r.courses.some((c) => c.id === filters.courseId) && !r._courseIdsWithWork.includes(filters.courseId)) return false;
		if (filters.grade && r.grade !== filters.grade) return false;
		if (filters.subject && !r.subjects.includes(filters.subject)) return false;
		if (filters.status && r.status !== filters.status) return false;
		if (filters.state && r.profileState !== filters.state) return false;
		return true;
	});
	out.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
	const total = out.length;
	// all=1 (capped) is for pickers such as "link an existing profile"; the table is always paged.
	const size = filters.all ? Math.min(total || 1, 200) : PAGE_SIZE;
	const pages = Math.max(1, Math.ceil(total / size));
	const page = Math.min(Math.max(1, parseInt(filters.page, 10) || 1), pages);
	out = out.slice((page - 1) * size, page * size).map(({ _courseIdsWithWork, ...r }) => r);

	return { students: out, summary, courses: courses.map((c) => ({ id: c.id, title: c.title })), total, page, pages, pageSize: size, serverTime: new Date(now).toISOString() };
}
