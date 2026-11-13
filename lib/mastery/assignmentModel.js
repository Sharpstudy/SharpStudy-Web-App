// The ONE place that turns assignment rows into what instructors, learners and the Family
// dashboard see. Every view calls learnerAssignments(), so a worksheet is counted once and
// the numbers cannot differ between views.
//
// Records
//   ml_assignments          what was assigned (existing worksheet coordinates, due date, notes)
//   ml_assignment_targets   per learner: started_at, and completed_at + attempt_id which are set
//                           ONLY by the request that stored a graded submission (submitAttempt)
//   ml_attempts             the authoritative score; it is read here, never copied
//
// Status of one target (assignment cancelled -> "cancelled")
//   pending      not started
//   in_progress  the learner opened the worksheet (started_at) but has not submitted it
//   completed    a graded submission is stored (completed_at / attempt_id)
//   overdue      NOT a separate lifecycle state: any non-completed target whose due date has passed
//                is reported with overdue = true (and status "overdue" for display/filtering).
// Counts: assigned = not cancelled; pending / inProgress / completed by lifecycle; overdue is the
// number of non-completed targets past their due date (a subset of pending + inProgress).

import { getSet, getSubject } from "./curriculum.js";
import { nextActionLabel } from "./rules.js";

const iso = (d) => (d ? new Date(d).toISOString() : null);

export function targetStatus(assignment, target, now = Date.now()) {
	if (assignment.status === "cancelled") return { status: "cancelled", overdue: false };
	if (target.completed_at) return { status: "completed", overdue: false };
	const overdue = !!assignment.due_at && new Date(assignment.due_at).getTime() < now;
	const lifecycle = target.started_at ? "in_progress" : "pending";
	return { status: overdue ? "overdue" : lifecycle, lifecycle, overdue };
}

export function buildItems(rows, attempts, names, now = Date.now()) {
	const byAttempt = new Map(attempts.map((a) => [a.id, a]));
	return rows
		.map(({ assignment: a, target: t }) => {
			const st = targetStatus(a, t, now);
			const set = getSet(a.level_id, a.set_id);
			const att = t.attempt_id ? byAttempt.get(t.attempt_id) : null;
			return {
				id: a.id,
				learnerId: t.learner_id,
				title: a.title,
				subject: a.subject,
				subjectName: (getSubject(a.subject) || {}).name || a.subject,
				levelId: a.level_id,
				setId: a.set_id,
				setTitle: set ? set.title : a.set_id,
				worksheetNo: a.worksheet_no,
				grade: a.grade || null,
				courseId: a.course_id || null,
				groupLabel: a.group_label || null,
				instructions: a.instructions || "",
				dueAt: iso(a.due_at),
				assignedAt: iso(a.created_at),
				instructorName: names.get(a.created_by) || "Your instructor",
				cancelled: a.status === "cancelled",
				status: st.status,
				overdue: st.overdue,
				startedAt: iso(t.started_at),
				completedAt: iso(t.completed_at),
				result: att
					? {
							attemptId: att.id,
							correctFirst: att.correct_first,
							total: att.total,
							accuracy: Number(att.accuracy),
							stars: att.stars,
							status: att.status,
							durationMs: att.duration_ms,
							feedback: nextActionLabel(att.outcome),
							completedAt: iso(att.completed_at),
					  }
					: null,
			};
		})
		.sort((x, y) => {
			// work to do first (soonest due), then completed (most recent first)
			const doneX = x.status === "completed" || x.cancelled ? 1 : 0;
			const doneY = y.status === "completed" || y.cancelled ? 1 : 0;
			if (doneX !== doneY) return doneX - doneY;
			if (doneX) return new Date(y.completedAt || y.assignedAt) - new Date(x.completedAt || x.assignedAt);
			return new Date(x.dueAt || "9999-01-01") - new Date(y.dueAt || "9999-01-01") || new Date(y.assignedAt) - new Date(x.assignedAt);
		});
}

export function countItems(items) {
	const live = items.filter((i) => !i.cancelled);
	return {
		assigned: live.length,
		pending: live.filter((i) => !i.completedAt && !i.startedAt).length,
		inProgress: live.filter((i) => !i.completedAt && i.startedAt).length,
		completed: live.filter((i) => !!i.completedAt).length,
		overdue: live.filter((i) => i.overdue).length,
	};
}

// { items, counts, lastUpdateAt } for one learner. `createdBy` limits to one instructor's assignments.
export async function learnerAssignments(repo, learnerId, now = Date.now(), { createdBy } = {}) {
	const rows = await repo.listAssignmentRows({ learnerIds: [learnerId], createdBy });
	return assemble(repo, rows, now);
}

// Several learners at once: Map(learnerId -> { items, counts, lastUpdateAt }).
export async function assignmentsByLearner(repo, learnerIds, now = Date.now(), { createdBy } = {}) {
	const rows = await repo.listAssignmentRows({ learnerIds, createdBy });
	const out = new Map(learnerIds.map((id) => [id, null]));
	const attempts = await repo.getAttemptsByIds(rows.map((r) => r.target.attempt_id).filter(Boolean));
	const names = await nameMap(repo, rows);
	for (const id of learnerIds) out.set(id, summarize(buildItems(rows.filter((r) => r.target.learner_id === id), attempts, names, now)));
	return out;
}

async function nameMap(repo, rows) {
	const ids = [...new Set(rows.map((r) => r.assignment.created_by))];
	const names = new Map();
	for (const id of ids) {
		const u = await repo.getUser(id);
		if (u) names.set(id, `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email || "Your instructor");
	}
	return names;
}

const summarize = (items) => {
	// The last PROGRESS update: a start or a completion. Being assigned is not progress.
	const stamps = items.flatMap((i) => [i.completedAt, i.startedAt]).filter(Boolean).map((d) => new Date(d).getTime());
	return { items, counts: countItems(items), lastUpdateAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null };
};

async function assemble(repo, rows, now) {
	const attempts = await repo.getAttemptsByIds(rows.map((r) => r.target.attempt_id).filter(Boolean));
	return summarize(buildItems(rows, attempts, await nameMap(repo, rows), now));
}
