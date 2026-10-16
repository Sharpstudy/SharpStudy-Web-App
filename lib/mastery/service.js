// Mastery Ladder business logic. Every function takes a `repo` (data access,
// see lib/mastery-server/repo.js for the Sequelize implementation and
// tests/mastery/memoryRepo.mjs for the in-memory one) and an actor, and
// performs its own authorization. API handlers stay thin.

import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

import { learnerAccess, can, resolvePermissions, PERMISSIONS } from "./policy.js";
import {
	SUBJECT_IDS,
	getSubject,
	getLevel,
	getSet,
	firstPosition,
	isValidPosition,
	isUnlocked,
	positionIndex,
	ladder,
	ladderNav,
	ladderProgress,
} from "./curriculum.js";
import { generateSheet, SheetError, PRINT_VARIANT_BASE } from "./sheet.js";
import { stripAnswers } from "./problem.js";
import { gradeLabel, ageOf, validateProfile } from "./profile.js";
import { learnerAssignments } from "./assignmentModel.js";
import { formatAnswer } from "./answers.js";
import { gradeResponses, GradingError } from "./grading.js";
import { scoreAttempt, decideProgression, nextActionLabel, OUTCOME } from "./rules.js";
import { signLearnerToken, signStartToken, verifyStartToken } from "./tokens.js";
import { localDate, isValidTimeZone, computeStreak, habitGrid, bucketActivity, addDays } from "./habits.js";
import { supportAreas } from "./insights.js";
import { tutorRespond, TUTOR_MODES, TUTOR_MODELS, DEFAULT_TUTOR_SETTINGS } from "./tutor.js";

export class ServiceError extends Error {
	constructor(status, code, message, extra) {
		super(message);
		this.status = status;
		this.code = code;
		if (extra) this.extra = extra;
	}
}

const fail = (status, code, message, extra) => {
	throw new ServiceError(status, code, message, extra);
};

export const LIMITS = {
	maxLearnersPerAccount: 12,
	pinMaxFailures: 5,
	pinLockMs: 10 * 60 * 1000,
	minMsPerQuestion: 500,
	clockSlackMs: 5 * 60 * 1000,
	pinHashRounds: 10,
};

const PIN_RE = /^\d{4}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const AVATARS = ["🦊", "🐼", "🐯", "🐸", "🦉", "🐙", "🦄", "🐢", "🚀", "⭐", "🌈", "⚽"];

export const publicLearner = (l) =>
	l && {
		id: l.id,
		displayName: l.display_name,
		avatar: l.avatar,
		birthYear: l.birth_year,
		grade: l.grade || null,
		gradeLabel: gradeLabel(l.grade),
		age: ageOf(l), // derived from the date of birth when there is one
		adultMode: !!l.adult_mode,
		dailyGoal: l.daily_goal,
		timeZone: l.time_zone,
		reminderTime: l.reminder_time,
		lastSeenAt: l.last_seen_at,
		pinLocked: !!(l.pin_locked_until && new Date(l.pin_locked_until).getTime() > Date.now()),
		createdAt: l.created_at,
	};

const describePosition = (pos) => {
	if (!pos) return null;
	const lv = getLevel(pos.levelId);
	const set = getSet(pos.levelId, pos.setId);
	return {
		levelId: pos.levelId,
		setId: pos.setId,
		worksheetNo: pos.worksheetNo,
		levelTitle: lv ? lv.title : pos.levelId,
		stage: lv ? lv.stage : "",
		setTitle: set ? set.title : pos.setId,
		worksheets: set ? set.worksheets : null,
		targetSeconds: set ? set.targetSeconds : null,
	};
};

const toPos = (row) => row && { levelId: row.level_id, setId: row.set_id, worksheetNo: row.worksheet_no };

async function audit(repo, actor, action, learnerId, details, ip) {
	await repo.addAudit({
		actor_user_id: actor && actor.kind === "account" ? actor.userId : actor && actor.accountUserId ? actor.accountUserId : null,
		actor_learner_id: actor && actor.kind === "learner" ? actor.learnerId : null,
		learner_id: learnerId || null,
		action,
		details: details || {},
		ip: ip || null,
	});
}
export { audit as writeAudit };

// Load a learner and check the actor has the requested access level.
export async function loadLearner(repo, actor, learnerId, need = "view") {
	if (!learnerId || typeof learnerId !== "string") fail(400, "bad_request", "learnerId is required");
	const learner = await repo.getLearner(learnerId);
	if (!learner) fail(404, "not_found", "Learner not found");
	const link = actor && actor.kind === "account" ? await repo.getGuardian(learner.id, actor.userId) : null;
	const access = learnerAccess(actor, learner, link);
	if (!access[need]) {
		// Do not reveal existence of learners the actor cannot see.
		if (!access.view) fail(404, "not_found", "Learner not found");
		fail(403, "forbidden", "You do not have permission to do that for this learner");
	}
	return { learner, access };
}

// A learner session (the signed token issued after the PIN) becomes a learner actor only if:
//   - the learner still exists;
//   - when the request ALSO carries a signed-in account, that account is the one that
//     unlocked the profile. A learner session left in the browser by a previous login
//     (another family, an instructor, a student) is refused instead of showing that
//     account's learner under the new account;
//   - the account that issued the session still has access to the learner (owner,
//     linked guardian or an administrator), so removing a link ends the session.
// Returns the learner actor, or null (the caller answers 401 and the app returns to the profile picker).
export async function resolveLearnerSession(repo, claims, account) {
	if (!claims || !claims.learnerId || !claims.accountUserId) return null;
	if (account && account.userId !== claims.accountUserId) return null;
	const learner = await repo.getLearner(claims.learnerId);
	if (!learner) return null;
	const user = await repo.getUser(claims.accountUserId);
	if (!user || user.status === false) return null;
	const issuer = { kind: "account", userId: user.id, role: user.role, permissions: resolvePermissions(user.role, await repo.permissionsForUser(user.id)) };
	const link = await repo.getGuardian(learner.id, user.id);
	if (!learnerAccess(issuer, learner, link).view) return null;
	return { kind: "learner", learnerId: learner.id, accountUserId: user.id };
}

// ---------------- Learners (account actors) ----------------

export async function listLearners(repo, actor) {
	if (!actor || actor.kind !== "account") fail(401, "unauthorized", "Sign in first");
	const owned = await repo.listLearnersByOwner(actor.userId);
	const linked = await repo.listLearnersByGuardian(actor.userId);
	const own = repo.listLearnersByStudent ? await repo.listLearnersByStudent(actor.userId) : []; // profiles linked to this student account
	const seen = new Set();
	const out = [];
	for (const l of [...owned, ...linked, ...own.map((x) => ({ ...x, _relation: "self" }))]) {
		if (seen.has(l.id)) continue;
		seen.add(l.id);
		out.push({ ...publicLearner(l), relation: l.owner_user_id === actor.userId ? "owner" : l._relation || "guardian" });
	}
	return out;
}

function validateLearnerFields(input, { partial }) {
	const out = {};
	if (!partial || input.displayName !== undefined) {
		const name = String(input.displayName || "").trim();
		if (name.length < 1 || name.length > 40) fail(422, "invalid", "Name must be 1–40 characters");
		out.display_name = name;
	}
	if (input.avatar !== undefined) out.avatar = AVATARS.includes(input.avatar) ? input.avatar : AVATARS[0];
	if (input.birthYear !== undefined && input.birthYear !== null && input.birthYear !== "") {
		const y = Number(input.birthYear);
		const now = new Date().getUTCFullYear();
		if (!Number.isInteger(y) || y < now - 100 || y > now) fail(422, "invalid", "Birth year is not valid");
		out.birth_year = y;
	}
	Object.assign(out, validateProfile(input, Date.now(), { bad: (m) => fail(422, "invalid", m) }));
	if (input.dailyGoal !== undefined) {
		const g = Number(input.dailyGoal);
		if (!Number.isInteger(g) || g < 1 || g > 20) fail(422, "invalid", "Daily goal must be 1–20 worksheets");
		out.daily_goal = g;
	}
	if (input.timeZone !== undefined) {
		if (!isValidTimeZone(input.timeZone)) fail(422, "invalid", "Unknown time zone");
		out.time_zone = input.timeZone;
	}
	if (input.reminderTime !== undefined) {
		if (input.reminderTime === null || input.reminderTime === "") out.reminder_time = null;
		else if (!TIME_RE.test(input.reminderTime)) fail(422, "invalid", "Reminder time must be HH:MM");
		else out.reminder_time = input.reminderTime;
	}
	return out;
}

export async function createLearner(repo, actor, input, ctx = {}) {
	if (!actor) fail(401, "unauthorized", "Sign in first");
	// A learner profile (a child signed in with a PIN) can never create profiles,
	// and plain student accounts need the learners.create permission (granted by
	// the "Family" role or to instructors/admins).
	if (actor.kind !== "account" || !can(actor, PERMISSIONS.LEARNERS_CREATE)) {
		fail(403, "forbidden", "Your account is not allowed to create learner profiles. Ask an administrator for family access.");
	}
	const fields = validateLearnerFields(input, { partial: false });
	if (!PIN_RE.test(String(input.pin || ""))) fail(422, "invalid", "PIN must be exactly 4 digits");
	const existing = await repo.listLearnersByOwner(actor.userId);
	if (existing.length >= LIMITS.maxLearnersPerAccount) fail(422, "limit", "This account already has the maximum number of learners");
	const subjects = (Array.isArray(input.subjects) && input.subjects.length ? input.subjects : ["math"]).filter((s) =>
		SUBJECT_IDS.includes(s)
	);
	const learner = await repo.createLearner({
		id: uuidv4(),
		owner_user_id: actor.userId,
		avatar: AVATARS[0],
		daily_goal: 1,
		time_zone: "UTC",
		...fields,
		pin_hash: await bcrypt.hash(String(input.pin), LIMITS.pinHashRounds),
		pin_failed_attempts: 0,
		adult_mode: false,
	});
	for (const s of subjects) await enrolInternal(repo, learner.id, s, true);
	await audit(repo, actor, "learner.create", learner.id, { displayName: learner.display_name, subjects }, ctx.ip);
	return publicLearner(learner);
}

// Private profile data: only adults who can manage the learner see the date of birth and the contact.
export const adultProfile = (l, access) =>
	access && (access.place || access.admin)
		? { birthDate: l.birth_date ? String(l.birth_date).slice(0, 10) : null, contactName: l.contact_name || null, contactPhone: l.contact_phone || null, contactEmail: l.contact_email || null }
		: null;

const PROFILE_INPUT_KEYS = ["grade", "birthDate", "age", "birthYear", "contactName", "contactPhone", "contactEmail"];

export async function updateLearner(repo, actor, learnerId, input, ctx = {}) {
	if (actor && actor.kind === "learner" && PROFILE_INPUT_KEYS.some((k) => input && input[k] !== undefined)) {
		fail(403, "forbidden", "Only an adult can change a learner's grade, age or contact details");
	}
	const { learner } = await loadLearner(repo, actor, learnerId, "place");
	const patch = validateLearnerFields(input, { partial: true });
	if (Object.keys(patch).length === 0) return publicLearner(learner);
	const updated = await repo.updateLearner(learner.id, patch);
	await audit(repo, actor, "learner.update", learner.id, { fields: Object.keys(patch) }, ctx.ip);
	return publicLearner(updated);
}

export async function setAdultMode(repo, actor, learnerId, enabled, ctx = {}) {
	if (!actor || actor.kind !== "account") fail(403, "forbidden", "Only an authorised adult can change adult mode");
	const { learner } = await loadLearner(repo, actor, learnerId, "admin");
	const updated = await repo.updateLearner(learner.id, { adult_mode: !!enabled, adult_mode_set_by: actor.userId });
	await audit(repo, actor, "learner.adult_mode", learner.id, { enabled: !!enabled }, ctx.ip);
	return publicLearner(updated);
}

export async function resetPin(repo, actor, learnerId, newPin, ctx = {}) {
	if (!actor || actor.kind !== "account") fail(403, "forbidden", "Only an authorised adult can reset a PIN");
	const { learner } = await loadLearner(repo, actor, learnerId, "admin");
	if (!PIN_RE.test(String(newPin || ""))) fail(422, "invalid", "PIN must be exactly 4 digits");
	await repo.updateLearner(learner.id, {
		pin_hash: await bcrypt.hash(String(newPin), LIMITS.pinHashRounds),
		pin_failed_attempts: 0,
		pin_locked_until: null,
	});
	await audit(repo, actor, "learner.pin_reset", learner.id, {}, ctx.ip);
	return { ok: true };
}

// PIN entry on the profile picker. The account must already be able to see
// the learner; the PIN then proves which child is at the keyboard.
export async function unlockLearner(repo, actor, learnerId, pin, ctx = {}) {
	const { learner } = await loadLearner(repo, actor, learnerId, "view");
	const now = ctx.now || Date.now();
	if (learner.pin_locked_until && new Date(learner.pin_locked_until).getTime() > now) {
		fail(423, "locked", "Too many wrong PINs. Ask an adult to wait or reset the PIN.", {
			lockedUntil: new Date(learner.pin_locked_until).toISOString(),
		});
	}
	const ok = PIN_RE.test(String(pin || "")) && (await bcrypt.compare(String(pin), learner.pin_hash));
	if (!ok) {
		const failures = (learner.pin_failed_attempts || 0) + 1;
		const lock = failures >= LIMITS.pinMaxFailures;
		await repo.updateLearner(learner.id, {
			pin_failed_attempts: lock ? 0 : failures,
			pin_locked_until: lock ? new Date(now + LIMITS.pinLockMs) : null,
		});
		await audit(repo, actor, "learner.login_failed", learner.id, { locked: lock }, ctx.ip);
		fail(401, "wrong_pin", lock ? "Too many wrong PINs. Try again in 10 minutes." : "That PIN is not right. Try again.", {
			remaining: lock ? 0 : LIMITS.pinMaxFailures - failures,
		});
	}
	await repo.updateLearner(learner.id, { pin_failed_attempts: 0, pin_locked_until: null, last_seen_at: new Date(now) });
	await audit(repo, actor, "learner.login", learner.id, {}, ctx.ip);
	return {
		learnerToken: signLearnerToken({ learnerId: learner.id, accountUserId: actor.userId }),
		learner: publicLearner(learner),
	};
}

export async function removeLearner(repo, actor, learnerId, confirmText, ctx = {}) {
	if (!actor || actor.kind !== "account") fail(403, "forbidden", "Only an authorised adult can remove a learner");
	const { learner } = await loadLearner(repo, actor, learnerId, "admin");
	if (String(confirmText || "").trim() !== learner.display_name) {
		fail(422, "confirm_required", `Type the learner's name (${learner.display_name}) to confirm`);
	}
	await repo.deleteLearner(learner.id);
	await audit(repo, actor, "learner.remove", learner.id, { displayName: learner.display_name }, ctx.ip);
	return { ok: true };
}

export async function resetProgress(repo, actor, learnerId, subject, confirmText, ctx = {}) {
	if (!actor || actor.kind !== "account") fail(403, "forbidden", "Only an authorised adult can reset progress");
	const { learner } = await loadLearner(repo, actor, learnerId, "admin");
	if (String(confirmText || "").trim() !== learner.display_name) {
		fail(422, "confirm_required", `Type the learner's name (${learner.display_name}) to confirm`);
	}
	if (subject && !SUBJECT_IDS.includes(subject)) fail(422, "invalid", "Unknown subject");
	const subjects = subject ? [subject] : SUBJECT_IDS;
	await repo.deleteAttempts(learner.id, subject || null);
	if (!subject) await repo.deleteActivity(learner.id);
	for (const s of subjects) {
		const cur = await repo.getProgress(learner.id, s);
		if (cur) await repo.upsertProgress(learner.id, s, firstPosition(s), { force: true, by: `reset:${actor.userId}` });
	}
	await audit(repo, actor, "learner.progress_reset", learner.id, { subject: subject || "all" }, ctx.ip);
	return { ok: true };
}

// ---------------- Guardians ----------------

export async function addGuardian(repo, actor, learnerId, email, relation, ctx = {}) {
	const { learner } = await loadLearner(repo, actor, learnerId, "admin");
	if (!["parent", "instructor"].includes(relation)) fail(422, "invalid", "Relation must be parent or instructor");
	const user = await repo.findUserByEmail(String(email || "").trim().toLowerCase());
	if (!user) fail(404, "not_found", "No SharpStudy account uses that email");
	if (user.id === learner.owner_user_id) fail(422, "invalid", "That account already owns this learner");
	if (relation === "instructor" && user.role !== "instructor" && user.role !== "admin") {
		fail(422, "invalid", "That account is not an instructor");
	}
	await repo.addGuardian({ learner_id: learner.id, user_id: user.id, relation, created_by: actor.userId });
	await audit(repo, actor, "learner.guardian_add", learner.id, { userId: user.id, relation }, ctx.ip);
	return { ok: true };
}

export async function removeGuardian(repo, actor, learnerId, userId, ctx = {}) {
	const { learner } = await loadLearner(repo, actor, learnerId, "admin");
	await repo.removeGuardian(learner.id, userId);
	await audit(repo, actor, "learner.guardian_remove", learner.id, { userId }, ctx.ip);
	return { ok: true };
}

// ---------------- Enrolment & placement ----------------

async function enrolInternal(repo, learnerId, subject, active) {
	await repo.upsertEnrolment(learnerId, subject, active);
	if (active && !(await repo.getProgress(learnerId, subject))) {
		const first = firstPosition(subject);
		if (first) await repo.upsertProgress(learnerId, subject, first, { force: true, by: "enrol" });
	}
}

export async function setEnrolment(repo, actor, learnerId, subject, active, ctx = {}) {
	const { learner } = await loadLearner(repo, actor, learnerId, "place");
	if (actor.kind === "learner") fail(403, "forbidden", "Ask an adult to change subjects");
	if (!SUBJECT_IDS.includes(subject)) fail(422, "invalid", "Unknown subject");
	await enrolInternal(repo, learner.id, subject, !!active);
	await audit(repo, actor, "learner.enrolment", learner.id, { subject, active: !!active }, ctx.ip);
	return { ok: true };
}

// Placement override. Adults with "place" access, or the learner themself
// when an authorised adult has enabled adult mode. Requires explicit confirm.
export async function setPlacement(repo, actor, learnerId, subject, position, confirm, ctx = {}) {
	const { learner } = await loadLearner(repo, actor, learnerId, "place");
	if (confirm !== true) fail(422, "confirm_required", "Placement changes must be confirmed");
	if (!SUBJECT_IDS.includes(subject)) fail(422, "invalid", "Unknown subject");
	const pos = position && {
		levelId: String(position.levelId || ""),
		setId: String(position.setId || ""),
		worksheetNo: Number(position.worksheetNo || 1),
	};
	if (!isValidPosition(subject, pos)) fail(422, "invalid", "That level/set/worksheet is not available");
	const enrolments = await repo.listEnrolments(learner.id);
	if (!enrolments.some((e) => e.subject === subject && e.active)) fail(422, "not_enrolled", "Enrol in the subject first");
	const before = toPos(await repo.getProgress(learner.id, subject));
	await repo.upsertProgress(learner.id, subject, pos, { force: true, by: `placement:${actor.userId || actor.learnerId}` });
	await audit(repo, actor, "placement.change", learner.id, { subject, from: before, to: pos, self: actor.kind === "learner" }, ctx.ip);
	return { ok: true, position: describePosition(pos) };
}

// ---------------- Study (learner actors) ----------------

function requireLearnerActor(actor) {
	if (!actor || actor.kind !== "learner") fail(401, "learner_required", "Choose your profile and enter your PIN");
}

async function activitySummary(repo, learner, now) {
	const today = localDate(now, learner.time_zone);
	const from = addDays(today, -400);
	const activity = (await repo.listActivity(learner.id, from, today)).map((a) => ({
		date: a.local_date,
		worksheets: a.worksheets,
		stars: a.stars,
		seconds: a.seconds,
	}));
	const goal = learner.daily_goal || 1;
	const todayRow = activity.find((a) => a.date === today);
	return {
		today,
		activity,
		goal,
		todayCount: todayRow ? todayRow.worksheets : 0,
		streak: computeStreak(activity, today, goal),
		habit: habitGrid(activity, today, goal, 21),
		totalStars: activity.reduce((s, a) => s + (a.stars || 0), 0),
	};
}

export async function studyHome(repo, actor, ctx = {}) {
	requireLearnerActor(actor);
	const learner = await repo.getLearner(actor.learnerId);
	if (!learner) fail(401, "learner_required", "Learner session expired");
	const now = ctx.now || Date.now();
	const enrolments = (await repo.listEnrolments(learner.id)).filter((e) => e.active);
	const subjects = [];
	for (const e of enrolments) {
		const subj = getSubject(e.subject);
		if (!subj) continue;
		let pos = toPos(await repo.getProgress(learner.id, e.subject));
		if (!pos || !isValidPosition(e.subject, pos)) pos = firstPosition(e.subject);
		if (!pos) continue;
		const set = getSet(pos.levelId, pos.setId);
		subjects.push({
			id: subj.id,
			name: subj.name,
			icon: subj.icon,
			position: describePosition(pos),
			progress: ladderProgress(e.subject, pos),
			worksheets: Array.from({ length: set.worksheets }, (_, i) => ({
				no: i + 1,
				state: i + 1 < pos.worksheetNo ? "done" : i + 1 === pos.worksheetNo ? "current" : "locked",
			})),
		});
	}
	const summary = await activitySummary(repo, learner, now);
	const work = await learnerAssignments(repo, learner.id, now);
	return {
		learner: publicLearner(learner),
		subjects,
		assignments: work.items.filter((i) => !i.cancelled),
		assignmentCounts: work.counts,
		today: summary.today,
		dailyGoal: summary.goal,
		todayCount: summary.todayCount,
		streak: summary.streak,
		habit: summary.habit,
		totalStars: summary.totalStars,
	};
}

// Hands out a worksheet if (and only if) it is unlocked for this learner.
export async function startWorksheet(repo, actor, input, ctx = {}) {
	requireLearnerActor(actor);
	const learner = await repo.getLearner(actor.learnerId);
	if (!learner) fail(401, "learner_required", "Learner session expired");
	let subject = String(input.subject || "");
	let target = { levelId: String(input.levelId || ""), setId: String(input.setId || ""), worksheetNo: Number(input.worksheetNo) };
	// Started from an assignment: the worksheet is the one the instructor assigned to THIS learner
	// (coordinates come from the stored assignment, not from the request).
	let assignment = null;
	let assignmentTarget = null;
	if (input.assignmentId) {
		assignment = await repo.getAssignment(String(input.assignmentId));
		assignmentTarget = assignment ? await repo.getAssignmentTarget(assignment.id, learner.id) : null;
		// Not assigned to this learner is indistinguishable from not existing.
		if (!assignment || !assignmentTarget) fail(404, "not_found", "Assignment not found");
		if (assignment.status !== "active") fail(409, "cancelled", "This assignment was cancelled");
		subject = assignment.subject;
		target = { levelId: assignment.level_id, setId: assignment.set_id, worksheetNo: assignment.worksheet_no };
	}
	if (!SUBJECT_IDS.includes(subject) || !isValidPosition(subject, target)) fail(404, "not_found", "Worksheet not found");
	const enrol = (await repo.listEnrolments(learner.id)).find((e) => e.subject === subject && e.active);
	if (!enrol) fail(403, "locked", "This subject is not switched on for you");
	const current = toPos(await repo.getProgress(learner.id, subject)) || firstPosition(subject);
	// An assigned worksheet may be ahead of the ladder; it is then practice (it only moves the ladder when it is the current worksheet).
	if (!assignment && !isUnlocked(subject, target, current)) fail(403, "locked", "This worksheet is still locked");

	const isCurrent = positionIndex(subject, target) === positionIndex(subject, current);
	const variant = await repo.countAttempts(learner.id, { subject, ...target });
	const sheet = generateSheet(target.levelId, target.setId, target.worksheetNo, variant);
	const startedAt = ctx.now || Date.now();
	const sessionId = uuidv4();
	const startToken = signStartToken({ sessionId, learnerId: learner.id, subject, ...target, variant, startedAt, assignmentId: assignment ? assignment.id : undefined });
	await repo.updateLearner(learner.id, { last_seen_at: new Date(startedAt) });
	// Opening it marks the assignment in progress (first start only). It is NOT completed until a graded submission is stored.
	if (assignment) await repo.markAssignmentStarted(assignment.id, learner.id, new Date(startedAt));
	return { sheet, startToken, sessionId, isCurrent, startedAt, assignmentId: assignment ? assignment.id : null };
}

// Records a finished worksheet. Idempotent on (learner, clientAttemptId).
// The server regenerates the sheet from the signed start token and grades
// the raw answer log itself; client scores/progression are never trusted.
export async function submitAttempt(repo, actor, input, ctx = {}) {
	const token = verifyStartToken(input.startToken);
	if (!token) fail(400, "invalid_token", "This worksheet session is not valid. Please start it again.");

	// Either the learner themself, or an adult account with view access
	// (lets a parent's device flush the offline queue).
	let learner;
	if (actor && actor.kind === "learner") {
		if (actor.learnerId !== token.learnerId) fail(403, "forbidden", "This worksheet belongs to another learner");
		learner = await repo.getLearner(token.learnerId);
		if (!learner) fail(404, "not_found", "Learner not found");
	} else {
		learner = (await loadLearner(repo, actor, token.learnerId, "view")).learner;
	}

	const clientAttemptId = String(input.clientAttemptId || "");
	if (!/^[A-Za-z0-9-]{8,64}$/.test(clientAttemptId)) fail(422, "invalid", "clientAttemptId is required");

	const existing = await repo.findAttemptByClientId(learner.id, clientAttemptId);
	if (existing) return { duplicate: true, ...attemptResult(existing) };

	let sheet;
	try {
		sheet = generateSheet(token.levelId, token.setId, token.worksheetNo, token.variant);
	} catch (e) {
		if (e instanceof SheetError) fail(422, "invalid", e.message);
		throw e;
	}
	let graded;
	try {
		graded = gradeResponses(sheet, input.responses);
	} catch (e) {
		if (e instanceof GradingError) fail(422, e.code, e.message);
		throw e;
	}

	// Duration: client-measured (works offline) but bounded by what is
	// physically possible since the server issued the sheet.
	const now = ctx.now || Date.now();
	const serverElapsed = Math.max(0, now - token.startedAt);
	const minMs = graded.total * LIMITS.minMsPerQuestion;
	let durationMs = Number.isFinite(Number(input.durationMs)) ? Math.round(Number(input.durationMs)) : serverElapsed;
	durationMs = Math.min(Math.max(durationMs, minMs), serverElapsed + LIMITS.clockSlackMs);
	durationMs = Math.max(durationMs, minMs);
	let completedAt = Number(new Date(input.completedAt || now));
	if (!Number.isFinite(completedAt) || completedAt > now || completedAt < token.startedAt) completedAt = now;

	const score = scoreAttempt({
		correctFirst: graded.correctFirst,
		total: graded.total,
		durationSec: durationMs / 1000,
		targetSec: sheet.targetSeconds,
	});
	const hintsUsed = await repo.countHints(token.sessionId);

	// Claim the clientAttemptId first; only the request that inserts the row
	// may change placement, so retries and parallel syncs cannot double-apply.
	const row = {
		id: uuidv4(),
		learner_id: learner.id,
		client_attempt_id: clientAttemptId,
		session_id: token.sessionId,
		subject: token.subject,
		level_id: token.levelId,
		set_id: token.setId,
		worksheet_no: token.worksheetNo,
		variant: token.variant,
		seed: sheet.seed,
		total: graded.total,
		correct_first: graded.correctFirst,
		accuracy: score.accuracy,
		duration_ms: durationMs,
		target_seconds: sheet.targetSeconds,
		stars: score.stars,
		status: score.status,
		outcome: OUTCOME.REVIEW,
		counted: false,
		hints_used: hintsUsed,
		responses: graded.perQuestion.map((q) => ({ f: q.firstCorrect ? 1 : 0, t: q.tries, a: q.first })),
		started_at: new Date(token.startedAt),
		completed_at: new Date(completedAt),
		local_date: localDate(completedAt, learner.time_zone),
	};
	const inserted = await repo.createAttempt(row);
	if (!inserted) {
		const again = await repo.findAttemptByClientId(learner.id, clientAttemptId);
		return { duplicate: true, ...attemptResult(again) };
	}

	let outcome = OUTCOME.REVIEW;
	let next = null;
	const progressRow = await repo.getProgress(learner.id, token.subject);
	const current = toPos(progressRow);
	const enrol = (await repo.listEnrolments(learner.id)).find((e) => e.subject === token.subject && e.active);
	const sheetPos = { levelId: token.levelId, setId: token.setId, worksheetNo: token.worksheetNo };
	if (enrol && current && positionIndex(token.subject, sheetPos) === positionIndex(token.subject, current)) {
		const decision = decideProgression(current, score, ladderNav);
		const applied = await repo.upsertProgress(learner.id, token.subject, decision.next, {
			expectedVersion: progressRow.version,
			by: "attempt",
		});
		if (applied) {
			outcome = decision.outcome;
			next = decision.next;
		}
		// else: progress moved concurrently (other device / placement change) -> stays a review attempt
	}
	await repo.updateAttempt(row.id, { outcome, counted: outcome !== OUTCOME.REVIEW });
	// Only the request that inserted the graded attempt gets here, so a retry cannot complete it twice.
	if (token.assignmentId) {
		const a = await repo.getAssignment(token.assignmentId);
		if (a && a.status === "active" && (await repo.getAssignmentTarget(a.id, learner.id))) {
			await repo.markAssignmentCompleted(a.id, learner.id, { attemptId: row.id, at: new Date(completedAt) });
		}
	}
	await repo.addActivity(learner.id, row.local_date, { worksheets: 1, stars: score.stars, seconds: Math.round(durationMs / 1000) });
	await repo.updateLearner(learner.id, { last_seen_at: new Date(now) });

	return {
		duplicate: false,
		...attemptResult({ ...row, outcome, counted: outcome !== OUTCOME.REVIEW }),
		next: next ? describePosition(next) : null,
	};
}

function attemptResult(a) {
	return {
		attemptId: a.id,
		clientAttemptId: a.client_attempt_id,
		subject: a.subject,
		levelId: a.level_id,
		setId: a.set_id,
		worksheetNo: a.worksheet_no,
		total: a.total,
		correctFirst: a.correct_first,
		accuracy: Number(a.accuracy),
		durationMs: a.duration_ms,
		targetSeconds: a.target_seconds,
		stars: a.stars,
		status: a.status,
		outcome: a.outcome,
		counted: !!a.counted,
		hintsUsed: a.hints_used,
		nextAction: nextActionLabel(a.outcome),
		completedAt: a.completed_at,
	};
}

// ---------------- Dashboard (adults) ----------------

export async function learnerDashboard(repo, actor, learnerId, ctx = {}) {
	const { learner, access } = await loadLearner(repo, actor, learnerId, "view");
	const now = ctx.now || Date.now();
	const enrolments = await repo.listEnrolments(learner.id);
	const subjects = [];
	for (const subj of SUBJECT_IDS) {
		const e = enrolments.find((x) => x.subject === subj);
		const pos = toPos(await repo.getProgress(learner.id, subj));
		const s = getSubject(subj);
		subjects.push({
			id: subj,
			name: s.name,
			active: !!(e && e.active),
			position: describePosition(pos),
			progress: pos ? ladderProgress(subj, pos) : 0,
			readySets: ladder(subj).length,
		});
	}
	const summary = await activitySummary(repo, learner, now);
	const stats = await repo.attemptStats(learner.id);
	const history = (await repo.listAttempts(learner.id, { limit: 60 })).map(attemptResult);
	const recent = history.slice(0, 25);
	const needsSupport = supportAreas(history).map((a) => {
		const set = getSet(a.levelId, a.setId);
		return { ...a, subjectName: getSubject(a.subject).name, setTitle: set ? set.title : a.setId };
	});
	const guardians = access.admin ? await repo.listGuardians(learner.id) : [];
	// An instructor who is only linked to the learner sees the assignments THEY gave; owners, parents and admins see all.
	const work = await learnerAssignments(repo, learner.id, now, { createdBy: access.place && !access.admin && actor.userId ? actor.userId : undefined });
	const lastAttemptAt = history.length ? history[0].completedAt : null;
	const stamps = [work.lastUpdateAt, lastAttemptAt].filter(Boolean).map((d) => new Date(d).getTime());
	return {
		learner: publicLearner(learner),
		profile: adultProfile(learner, access),
		assignments: work.items,
		assignmentCounts: work.counts,
		lastUpdateAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
		serverTime: new Date(now).toISOString(),
		access: { place: access.place, admin: access.admin, owner: !!access.owner },
		subjects,
		today: summary.today,
		dailyGoal: summary.goal,
		todayCount: summary.todayCount,
		streak: summary.streak,
		habit: summary.habit,
		totalStars: summary.totalStars,
		charts: {
			day: bucketActivity(summary.activity, summary.today, "day", 14),
			week: bucketActivity(summary.activity, summary.today, "week", 8),
			month: bucketActivity(summary.activity, summary.today, "month", 6),
		},
		stats: {
			worksheets: stats.count,
			avgAccuracy: stats.count ? stats.accuracySum / stats.count : null,
			totalSeconds: Math.round(stats.durationMsSum / 1000),
			hintsUsed: stats.hintsSum,
			daysPractised: summary.activity.filter((a) => a.worksheets > 0).length,
			lastPractisedAt: stats.lastCompletedAt,
		},
		recent,
		needsSupport,
		attemptsConsidered: history.filter((a) => a.counted || a.outcome !== "review").length,
		guardians,
	};
}

// ---------------- Admin ----------------

export function requirePermission(actor, permission) {
	if (!actor || actor.kind !== "account") fail(401, "unauthorized", "Sign in first");
	if (!can(actor, permission)) fail(403, "forbidden", "You do not have access to this area");
}

export async function adminListLearners(repo, actor, { q, limit = 50, offset = 0 } = {}) {
	requirePermission(actor, PERMISSIONS.LEARNERS_MANAGE_ALL);
	const rows = await repo.listAllLearners({ q: q ? String(q).slice(0, 60) : "", limit: Math.min(200, limit), offset });
	return rows.map((l) => ({ ...publicLearner(l), ownerEmail: l._ownerEmail || null, ownerUserId: l.owner_user_id }));
}

export const GLOBAL_RESET_PHRASE = "RESET ALL PROGRESS";

export async function globalReset(repo, actor, { phrase, passwordOk }, ctx = {}) {
	requirePermission(actor, PERMISSIONS.GLOBAL_RESET);
	if (phrase !== GLOBAL_RESET_PHRASE) fail(422, "confirm_required", `Type "${GLOBAL_RESET_PHRASE}" to confirm`);
	if (!passwordOk) fail(401, "reauth_failed", "Password confirmation failed");
	const counts = await repo.globalReset(Object.fromEntries(SUBJECT_IDS.map((s) => [s, firstPosition(s)])));
	await audit(repo, actor, "system.global_reset", null, counts, ctx.ip);
	return { ok: true, ...counts };
}

// ---------------- Sage tutor ----------------

export async function getTutorSettings(repo) {
	const out = { ...DEFAULT_TUTOR_SETTINGS };
	for (const key of Object.keys(DEFAULT_TUTOR_SETTINGS)) {
		const v = await repo.getSetting(`tutor.${key}`);
		if (v !== null && v !== undefined) out[key] = v;
	}
	return out;
}

export async function updateTutorSettings(repo, actor, input, ctx = {}) {
	requirePermission(actor, PERMISSIONS.TUTOR_CONFIGURE);
	const patch = {};
	if (input.enabled !== undefined) patch.enabled = input.enabled === true;
	if (input.chatEnabled !== undefined) patch.chatEnabled = input.chatEnabled === true;
	if (input.model !== undefined) {
		if (!TUTOR_MODELS.includes(input.model)) fail(422, "invalid", "Unsupported model");
		patch.model = input.model;
	}
	if (input.maxRequestsPerHour !== undefined) {
		const n = Number(input.maxRequestsPerHour);
		if (!Number.isInteger(n) || n < 1 || n > 1000) fail(422, "invalid", "Limit must be 1–1000");
		patch.maxRequestsPerHour = n;
	}
	for (const [k, v] of Object.entries(patch)) await repo.setSetting(`tutor.${k}`, v, actor.userId);
	await audit(repo, actor, "tutor.settings", null, patch, ctx.ip);
	return getTutorSettings(repo);
}

// The question context is rebuilt from the signed start token; the browser
// only says which question and which help mode.
export async function tutorRequest(repo, actor, input, { ai, settings } = {}) {
	requireLearnerActor(actor);
	const token = verifyStartToken(input.startToken);
	if (!token) fail(400, "invalid_token", "This worksheet session is not valid.");
	if (token.learnerId !== actor.learnerId) fail(403, "forbidden", "This worksheet belongs to another learner");
	const mode = String(input.mode || "");
	if (!TUTOR_MODES.includes(mode)) fail(422, "invalid", "Unknown help mode");
	const cfg = settings || (await getTutorSettings(repo));
	if (mode === "chat" && !(cfg.enabled && cfg.chatEnabled)) fail(403, "chat_disabled", "Chatting with Sage is switched off.");
	if (mode === "chat" && !String(input.message || "").trim()) fail(422, "invalid", "Type a message for Sage");
	const sheet = generateSheet(token.levelId, token.setId, token.worksheetNo, token.variant);
	const index = Number(input.questionIndex);
	if (!Number.isInteger(index) || index < 0 || index >= sheet.problems.length) fail(422, "invalid", "Unknown question");
	await repo.addHintEvent({ learner_id: actor.learnerId, session_id: token.sessionId, question_index: index, mode });
	const r = await tutorRespond({ sheet, problemIndex: index, mode, message: input.message, attempted: input.attempted, settings: cfg, ai });
	return { mode: r.mode, text: r.text, lesson: r.lesson, example: r.example, source: r.source };
}

// ---------------- Printing ----------------

// Printable copies generated by the same deterministic generator as study.
// Locked worksheets are refused unless the account may print any worksheet
// (curriculum.print_any, e.g. instructors/admins printing without a learner).
// Answer keys / prefilled copies: adults only, or an adult-mode learner.
export async function printSheets(repo, actor, input) {
	if (!actor) fail(401, "unauthorized", "Sign in first");
	const subject = String(input.subject || "");
	const pos = { levelId: String(input.levelId || ""), setId: String(input.setId || ""), worksheetNo: Number(input.worksheetNo) };
	if (!SUBJECT_IDS.includes(subject) || !isValidPosition(subject, pos)) fail(404, "not_found", "Worksheet not found");
	const copies = Math.min(6, Math.max(1, Number(input.copies) || 1));
	const wantKey = input.answerKey === true || input.answerKey === "true" || input.answerKey === "1";
	const wantPrefilled = input.prefilled === true || input.prefilled === "true" || input.prefilled === "1";

	let mayKey = false;
	let learner = null;
	const learnerId = actor.kind === "learner" ? actor.learnerId : input.learnerId;
	if (learnerId) {
		const loaded = await loadLearner(repo, actor, String(learnerId), "view");
		learner = loaded.learner;
		const current = toPos(await repo.getProgress(learner.id, subject));
		const enrolled = (await repo.listEnrolments(learner.id)).some((e) => e.subject === subject && e.active);
		if (!enrolled || !current || !isUnlocked(subject, pos, current)) {
			if (!can(actor, PERMISSIONS.PRINT_ANY)) fail(403, "locked", "This worksheet is still locked for this learner");
		}
		mayKey = actor.kind === "account" ? true : !!learner.adult_mode;
	} else {
		if (!can(actor, PERMISSIONS.PRINT_ANY)) fail(403, "forbidden", "Choose a learner to print their unlocked worksheets");
		mayKey = true;
	}
	if ((wantKey || wantPrefilled) && !mayKey) fail(403, "forbidden", "Answer keys are only available to adults");

	const sheets = [];
	for (let k = 0; k < copies; k++) {
		const sheet = generateSheet(pos.levelId, pos.setId, pos.worksheetNo, PRINT_VARIANT_BASE + k);
		sheets.push({
			...sheet,
			problems: sheet.problems.map((p) => ({
				...stripAnswers(p),
				...(wantPrefilled ? { filled: formatAnswer(p.answer) } : {}),
			})),
			answerKey: wantKey ? sheet.problems.map((p) => ({ index: p.index, answer: formatAnswer(p.answer), solution: p.solution })) : null,
		});
	}
	return { learnerName: learner ? learner.display_name : null, sheets };
}
