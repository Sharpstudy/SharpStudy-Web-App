// The parent's view of their children's learning: a short, read-only summary built from the same stored data the
// instructor dashboard uses (attempts, ladder position, assignments), minus everything a parent does not manage —
// placement, enrolment, answers, contact details, guardians, PINs. Only children the signed-in account is a
// linked PARENT of (an active "parent" guardian row, see isParentOf) are included; owning a profile, teaching it
// or holding learners.create does not make anyone a parent, and nothing in the request chooses the children.

import { SUBJECT_IDS, getSubject, getLevel, getSet, ladderProgress } from "../mastery/curriculum.js";
import { gradeLabel } from "../mastery/profile.js";
import { learnerAssignments } from "../mastery/assignmentModel.js";
import { managedChildren, requireAccount } from "./service.js";

const iso = (d) => (d ? new Date(d).toISOString() : null);
const RECENT_ATTEMPTS = 6;
const LISTED_WORKSHEETS = 8;

const worksheetName = (a) => {
	const set = getSet(a.level_id, a.set_id);
	return `${set ? set.title : a.set_id} · worksheet ${a.worksheet_no}`;
};

async function subjectProgress(repo, learner) {
	const enrolled = new Set((await repo.listEnrolments(learner.id)).filter((e) => e.active).map((e) => e.subject));
	const out = [];
	for (const id of SUBJECT_IDS) {
		if (!enrolled.has(id)) continue;
		const row = await repo.getProgress(learner.id, id);
		const pos = row && { levelId: row.level_id, setId: row.set_id, worksheetNo: row.worksheet_no };
		const level = pos && getLevel(pos.levelId);
		out.push({ id, name: getSubject(id).name, levelTitle: level ? level.title : null, percent: pos ? Math.round(ladderProgress(id, pos) * 100) : 0 });
	}
	return out;
}

async function childSummary(repo, learner, now) {
	const stats = await repo.attemptStats(learner.id);
	const work = await learnerAssignments(repo, learner.id, now);
	const live = work.items.filter((i) => !i.cancelled);
	const slim = (i) => ({ id: i.id, title: i.title, subjectName: i.subjectName, dueAt: i.dueAt, overdue: i.overdue, status: i.status, completedAt: i.completedAt, stars: i.result ? i.result.stars : null });
	const recent = (await repo.listAttempts(learner.id, { limit: RECENT_ATTEMPTS })).map((a) => ({
		id: a.id,
		when: iso(a.completed_at),
		subjectName: getSubject(a.subject) ? getSubject(a.subject).name : a.subject,
		worksheet: worksheetName(a),
		stars: a.stars,
		correctFirst: a.correct_first,
		total: a.total,
	}));
	return {
		id: learner.id,
		nickname: learner.display_name,
		avatar: learner.avatar,
		gradeLabel: gradeLabel(learner.grade) || null,
		summary: {
			worksheetsDone: stats.count,
			accuracy: stats.count ? stats.accuracySum / stats.count : null,
			minutes: Math.round(stats.durationMsSum / 60000),
			lastPractisedAt: iso(stats.lastCompletedAt),
		},
		subjects: await subjectProgress(repo, learner),
		worksheets: {
			counts: { completed: live.filter((i) => i.status === "completed").length, pending: live.filter((i) => i.status !== "completed").length, overdue: live.filter((i) => i.overdue).length },
			pending: live.filter((i) => i.status !== "completed").slice(0, LISTED_WORKSHEETS).map(slim),
			completed: live.filter((i) => i.status === "completed").slice(0, LISTED_WORKSHEETS).map(slim),
		},
		recent,
	};
}

export async function parentOverview(repo, actor, ctx = {}) {
	requireAccount(actor);
	const now = ctx.now || Date.now();
	const children = [];
	for (const l of await managedChildren(repo, actor)) children.push(await childSummary(repo, l, now));
	return { serverTime: new Date(now).toISOString(), children };
}
