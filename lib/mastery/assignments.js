// Instructor worksheet assignments on top of the existing Mastery Ladder.
//
// Who may assign: an account whose role is instructor or admin, and only to learners it can manage
// ("place" access): learners it owns, or is linked to as the learner's instructor/parent, or any
// learner for an administrator (learners.manage_all). Nobody else is ever in scope, whatever ids
// the client sends. Learner ids (never names or e-mails) identify the targets.
//
// The worksheet itself is an existing curriculum worksheet (subject, level, set, number); starting,
// grading and progress all go through the existing startWorksheet / submitAttempt.

import { v4 as uuidv4 } from "uuid";
import { getSubject, getSet } from "./curriculum.js";
import { learnerAccess } from "./policy.js";
import { loadLearner, listLearners, ServiceError } from "./service.js";
import { assignmentsByLearner } from "./assignmentModel.js";
import { GRADE_CODES } from "./profile.js";

const fail = (status, code, message, extra) => {
	throw new ServiceError(status, code, message, extra);
};

export const LIMITS = { titleMax: 160, instructionsMax: 1000, groupLabelMax: 80, maxTargets: 100, dedupeWindowMs: 10 * 60 * 1000 };

const isTeacher = (actor) => actor && actor.kind === "account" && (actor.role === "instructor" || actor.role === "admin");
const requireTeacher = (actor) => {
	if (!actor || actor.kind !== "account") fail(401, "unauthorized", "Sign in first");
	if (!isTeacher(actor)) fail(403, "forbidden", "Only instructors can assign worksheets");
};

// ------------------------------------------------------------------ validation

function parseWorksheet(input) {
	const subject = String(input.subject || "");
	const levelId = String(input.levelId || "");
	const setId = String(input.setId || "");
	const worksheetNo = Number(input.worksheetNo);
	const set = getSet(levelId, setId);
	if (!getSubject(subject) || !set || set.subject !== subject || !set.ready) fail(422, "invalid", "Choose a worksheet from the curriculum");
	if (!Number.isInteger(worksheetNo) || worksheetNo < 1 || worksheetNo > set.worksheets) fail(422, "invalid", `Worksheet number must be 1-${set.worksheets}`);
	return { subject, levelId, setId, worksheetNo, set };
}

function parseDue(v, now) {
	if (v === undefined || v === null || v === "") return null;
	const d = new Date(v);
	if (Number.isNaN(d.getTime())) fail(422, "invalid", "The due date is not valid");
	if (d.getTime() <= now) fail(422, "invalid", "The due date must be in the future");
	// Whole seconds: MySQL DATETIME does not keep milliseconds, and a retried request must compare equal to what was stored.
	return new Date(Math.floor(d.getTime() / 1000) * 1000);
}

const text = (v, max, label) => {
	const s = String(v == null ? "" : v).trim();
	if (s.length > max) fail(422, "invalid", `${label} must be at most ${max} characters`);
	return s || null;
};

// Resolve and authorise every target. Unknown, out-of-scope and view-only learners are refused
// as one group so the response does not reveal which ids exist.
async function resolveTargets(repo, actor, learnerIds, subject) {
	if (!Array.isArray(learnerIds) || learnerIds.length === 0) fail(422, "invalid", "Choose at least one student");
	const ids = [...new Set(learnerIds.map(String))];
	if (ids.length > LIMITS.maxTargets) fail(422, "invalid", `At most ${LIMITS.maxTargets} students at a time`);
	const learners = [];
	for (const id of ids) {
		let found;
		try {
			found = await loadLearner(repo, actor, id, "place");
		} catch (e) {
			if (e instanceof ServiceError) fail(403, "forbidden", "You can only assign work to students you teach");
			throw e;
		}
		learners.push(found.learner);
	}
	const notOn = [];
	for (const l of learners) {
		const e = (await repo.listEnrolments(l.id)).find((x) => x.subject === subject && x.active);
		if (!e) notOn.push(l.display_name);
	}
	if (notOn.length) fail(422, "subject_off", `${getSubject(subject).name} is not switched on for: ${notOn.join(", ")}`, { learners: notOn });
	return learners;
}

async function ownCourse(repo, actor, courseId) {
	if (!courseId) return null;
	const c = await repo.getCourseOwner(String(courseId));
	if (!c) fail(422, "invalid", "That course was not found");
	if (c.userId !== actor.userId && actor.role !== "admin") fail(403, "forbidden", "You can only link your own courses");
	return c.id;
}

// ------------------------------------------------------------------ create

// input.preview = true validates everything and returns what WOULD be published (the review step).
export async function createAssignment(repo, actor, input, ctx = {}) {
	requireTeacher(actor);
	input = input || {};
	const now = ctx.now || Date.now();
	const ws = parseWorksheet(input);
	const learners = await resolveTargets(repo, actor, input.learnerIds, ws.subject);
	const dueAt = parseDue(input.dueAt, now);
	const courseId = await ownCourse(repo, actor, input.courseId);
	const grade = input.grade ? (GRADE_CODES.includes(String(input.grade)) ? String(input.grade) : fail(422, "invalid", "Unknown grade")) : null;
	const title = text(input.title, LIMITS.titleMax, "Title") || `${ws.set.title} - worksheet ${ws.worksheetNo}`;
	const instructions = text(input.instructions, LIMITS.instructionsMax, "Instructions");
	const groupLabel = text(input.groupLabel, LIMITS.groupLabelMax, "Group name");

	const summary = {
		title,
		subject: ws.subject,
		subjectName: getSubject(ws.subject).name,
		levelId: ws.levelId,
		setTitle: ws.set.title,
		worksheetNo: ws.worksheetNo,
		grade,
		courseId,
		dueAt: dueAt ? dueAt.toISOString() : null,
		instructions: instructions || "",
		groupLabel,
		students: learners.map((l) => ({ id: l.id, name: l.display_name })),
	};
	if (input.preview) return { preview: true, ...summary };

	// A retried request (double click, flaky network) must not publish twice: the same instructor,
	// worksheet, due date and students within a few minutes is the same assignment.
	const recent = await repo.listAssignmentRows({ learnerIds: learners.map((l) => l.id), createdBy: actor.userId });
	const key = learners.map((l) => l.id).sort().join(",");
	const byAssignment = new Map();
	for (const r of recent) {
		if (!byAssignment.has(r.assignment.id)) byAssignment.set(r.assignment.id, { a: r.assignment, ids: [] });
		byAssignment.get(r.assignment.id).ids.push(r.target.learner_id);
	}
	for (const { a, ids } of byAssignment.values()) {
		const same =
			a.status === "active" &&
			a.subject === ws.subject &&
			a.level_id === ws.levelId &&
			a.set_id === ws.setId &&
			a.worksheet_no === ws.worksheetNo &&
			(a.due_at ? new Date(a.due_at).getTime() : null) === (dueAt ? dueAt.getTime() : null) &&
			now - new Date(a.created_at).getTime() < LIMITS.dedupeWindowMs &&
			(await repo.listAssignmentTargets(a.id)).map((t) => t.learner_id).sort().join(",") === key;
		if (same) return { duplicate: true, assignmentId: a.id, ...summary, students: summary.students };
	}

	const created = await repo.createAssignment(
		{
			id: uuidv4(),
			created_by: actor.userId,
			course_id: courseId,
			title,
			subject: ws.subject,
			level_id: ws.levelId,
			set_id: ws.setId,
			worksheet_no: ws.worksheetNo,
			grade,
			group_label: groupLabel,
			instructions,
			due_at: dueAt,
			status: "active",
		},
		learners.map((l) => l.id)
	);
	return { duplicate: false, assignmentId: created.id, ...summary };
}

// ------------------------------------------------------------------ change / cancel

async function loadOwned(repo, actor, assignmentId) {
	requireTeacher(actor);
	const a = await repo.getAssignment(String(assignmentId || ""));
	// Someone else's assignment is indistinguishable from a missing one.
	if (!a || (a.created_by !== actor.userId && actor.role !== "admin")) fail(404, "not_found", "Assignment not found");
	return a;
}

// input: { dueAt?: ISO | null, instructions?: string, cancel?: true }
export async function updateAssignment(repo, actor, assignmentId, input, ctx = {}) {
	const a = await loadOwned(repo, actor, assignmentId);
	const now = ctx.now || Date.now();
	const patch = {};
	const changed = [];
	if (input.cancel) {
		if (a.status !== "cancelled") {
			patch.status = "cancelled";
			changed.push("cancelled");
		}
	} else {
		if (a.status === "cancelled") fail(409, "cancelled", "This assignment was cancelled");
		if (input.dueAt !== undefined) {
			const due = input.dueAt === null || input.dueAt === "" ? null : parseDue(input.dueAt, now);
			const before = a.due_at ? new Date(a.due_at).getTime() : null;
			if ((due ? due.getTime() : null) !== before) {
				patch.due_at = due;
				changed.push("due");
			}
		}
		if (input.instructions !== undefined) patch.instructions = text(input.instructions, LIMITS.instructionsMax, "Instructions");
	}
	const updated = Object.keys(patch).length ? await repo.updateAssignment(a.id, patch) : a;
	const targets = await repo.listAssignmentTargets(a.id);
	return { assignment: updated, changed, learnerIds: targets.map((t) => t.learner_id) };
}

// ------------------------------------------------------------------ the instructor's list

export const LEARNING_STATUS = ["no_work", "not_started", "in_progress", "overdue", "all_done"];
const learningStatus = (c) => (c.assigned === 0 ? "no_work" : c.overdue > 0 ? "overdue" : c.inProgress > 0 ? "in_progress" : c.pending > 0 ? "not_started" : "all_done");

// Learners in the caller's scope (owned or linked) with grade, subjects and assignment counts.
// Filters: q (name), grade, subject, course, status (see LEARNING_STATUS).
export async function learnerOverview(repo, actor, filters = {}, ctx = {}) {
	if (!actor || actor.kind !== "account") fail(401, "unauthorized", "Sign in first");
	const now = ctx.now || Date.now();
	const q = String(filters.q || "").trim().toLowerCase();
	const base = await listLearners(repo, actor);
	// An instructor who is only LINKED to a learner sees just the assignments they gave; owners and parents see all.
	const mine = base.filter((l) => l.relation === "instructor").map((l) => l.id);
	const others = base.filter((l) => l.relation !== "instructor").map((l) => l.id);
	const work = new Map([...(await assignmentsByLearner(repo, others, now)), ...(await assignmentsByLearner(repo, mine, now, { createdBy: actor.userId }))]);
	const out = [];
	for (const l of base) {
		if (q && !l.displayName.toLowerCase().includes(q)) continue;
		if (filters.grade && l.grade !== filters.grade) continue;
		const subjects = (await repo.listEnrolments(l.id)).filter((e) => e.active).map((e) => e.subject);
		if (filters.subject && !subjects.includes(filters.subject)) continue;
		const w = work.get(l.id);
		if (filters.course && !w.items.some((i) => i.courseId === filters.course)) continue;
		const status = learningStatus(w.counts);
		if (filters.status && status !== filters.status) continue;
		const stats = await repo.attemptStats(l.id);
		out.push({
			id: l.id,
			displayName: l.displayName,
			avatar: l.avatar,
			grade: l.grade,
			gradeLabel: l.gradeLabel,
			age: l.age,
			relation: l.relation,
			subjects,
			counts: w.counts,
			status,
			lastActivityAt: stats && stats.lastCompletedAt ? new Date(stats.lastCompletedAt).toISOString() : null,
		});
	}
	return { learners: out, total: base.length, serverTime: new Date(now).toISOString() };
}
