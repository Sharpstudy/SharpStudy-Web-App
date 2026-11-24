// Admin operations: users & roles, custom roles (access rights), audit log,
// feedback, presence. Every function checks permissions itself.

import { PERMISSIONS, ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, BUILTIN_ROLE_PERMISSIONS } from "./policy.js";
import { ServiceError, requirePermission, writeAudit } from "./service.js";

const fail = (status, code, message) => {
	throw new ServiceError(status, code, message);
};

export const BUILTIN_ROLES = ["student", "instructor", "admin"];

export function permissionCatalog() {
	return {
		permissions: ALL_PERMISSIONS.map((p) => ({ id: p, description: PERMISSION_DESCRIPTIONS[p] })),
		builtin: BUILTIN_ROLE_PERMISSIONS,
	};
}

// ---- users ----

export async function listUsers(repo, actor, { q = "", page = 1 } = {}) {
	requirePermission(actor, PERMISSIONS.USERS_MANAGE);
	const limit = 25;
	const p = Math.max(1, Number(page) || 1);
	const { rows, count } = await repo.listUsers({ q: String(q).slice(0, 80), limit, offset: (p - 1) * limit });
	const users = [];
	for (const u of rows) {
		users.push({
			id: u.id,
			name: `${u.first_name || ""} ${u.last_name || ""}`.trim(),
			email: u.email,
			role: u.role,
			status: u.status,
			createdAt: u.created_at,
			roleIds: await repo.getUserRoleIds(u.id),
		});
	}
	return { users, count, page: p, pages: Math.max(1, Math.ceil(count / limit)) };
}

export async function setUserRole(repo, actor, userId, role, ctx = {}) {
	requirePermission(actor, PERMISSIONS.USERS_MANAGE);
	if (!BUILTIN_ROLES.includes(role)) fail(422, "invalid", "Unknown role");
	const user = await repo.getUser(userId);
	if (!user) fail(404, "not_found", "User not found");
	// Instructor access is granted only by approving an instructor application (evidence, review, audit).
	if (role === "instructor" && user.role !== "instructor") {
		fail(422, "instructor_application_required", "Instructors are approved under Admin > Instructors > Applications.");
	}
	if (user.id === actor.userId && role !== "admin" && actor.role === "admin") {
		fail(422, "invalid", "You cannot remove your own admin role");
	}
	await repo.setUserRole(user.id, role);
	await writeAudit(repo, actor, "user.role_change", null, { userId: user.id, from: user.role, to: role }, ctx.ip);
	return { ok: true };
}

export async function setUserCustomRoles(repo, actor, userId, roleIds, ctx = {}) {
	requirePermission(actor, PERMISSIONS.ROLES_MANAGE);
	const user = await repo.getUser(userId);
	if (!user) fail(404, "not_found", "User not found");
	const ids = [...new Set(Array.isArray(roleIds) ? roleIds.map(String) : [])];
	const roles = await repo.listRoles();
	if (!ids.every((id) => roles.some((r) => r.id === id))) fail(422, "invalid", "Unknown role");
	await repo.setUserRoles(user.id, ids);
	await writeAudit(repo, actor, "user.roles_assign", null, { userId: user.id, roleIds: ids }, ctx.ip);
	return { ok: true };
}

// ---- custom roles ----

function validateRole(input) {
	const name = String(input.name || "").trim();
	if (name.length < 2 || name.length > 60) fail(422, "invalid", "Role name must be 2–60 characters");
	if (BUILTIN_ROLES.includes(name.toLowerCase())) fail(422, "invalid", "That name is reserved for a built-in role");
	const permissions = [...new Set(Array.isArray(input.permissions) ? input.permissions : [])];
	if (!permissions.every((p) => ALL_PERMISSIONS.includes(p))) fail(422, "invalid", "Unknown permission");
	return { name, description: String(input.description || "").slice(0, 255), permissions };
}

export async function listRoles(repo, actor) {
	requirePermission(actor, PERMISSIONS.ROLES_MANAGE);
	return { roles: await repo.listRoles(), ...permissionCatalog() };
}

export async function createRole(repo, actor, input, ctx = {}) {
	requirePermission(actor, PERMISSIONS.ROLES_MANAGE);
	const data = validateRole(input);
	if ((await repo.listRoles()).some((r) => r.name.toLowerCase() === data.name.toLowerCase())) fail(422, "invalid", "A role with that name exists");
	const role = await repo.createRole(data);
	await writeAudit(repo, actor, "role.create", null, { roleId: role.id, ...data }, ctx.ip);
	return role;
}

export async function updateRole(repo, actor, roleId, input, ctx = {}) {
	requirePermission(actor, PERMISSIONS.ROLES_MANAGE);
	const existing = await repo.getRole(roleId);
	if (!existing) fail(404, "not_found", "Role not found");
	const data = validateRole({ ...existing, ...input });
	const role = await repo.updateRole(roleId, data);
	await writeAudit(repo, actor, "role.update", null, { roleId, ...data }, ctx.ip);
	return role;
}

export async function deleteRole(repo, actor, roleId, ctx = {}) {
	requirePermission(actor, PERMISSIONS.ROLES_MANAGE);
	const existing = await repo.getRole(roleId);
	if (!existing) fail(404, "not_found", "Role not found");
	await repo.deleteRole(roleId);
	await writeAudit(repo, actor, "role.delete", null, { roleId, name: existing.name }, ctx.ip);
	return { ok: true };
}

// ---- audit ----

export async function listAudit(repo, actor, { action, learnerId, page = 1 } = {}) {
	requirePermission(actor, PERMISSIONS.AUDIT_VIEW);
	const limit = 50;
	const p = Math.max(1, Number(page) || 1);
	const { rows, count } = await repo.listAudit({
		action: action ? String(action).slice(0, 64) : undefined,
		learnerId: learnerId ? String(learnerId) : undefined,
		limit,
		offset: (p - 1) * limit,
	});
	return { entries: rows, count, page: p, pages: Math.max(1, Math.ceil(count / limit)) };
}

// ---- feedback ----

export const MAX_SCREENSHOT_CHARS = 1500000;
const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export async function createFeedback(repo, actor, input, ctx = {}) {
	if (!actor) fail(401, "unauthorized", "Sign in to send feedback");
	const message = String(input.message || "").trim();
	if (message.length < 1 || message.length > 4000) fail(422, "invalid", "Feedback must be 1–4000 characters");
	let screenshot = null;
	if (input.screenshot) {
		const s = String(input.screenshot);
		if (s.length > MAX_SCREENSHOT_CHARS || !DATA_URL_RE.test(s)) fail(422, "invalid", "Screenshot must be a PNG/JPEG/WebP image under 1.5 MB");
		screenshot = s;
	}
	const row = await repo.createFeedback({
		user_id: actor.kind === "account" ? actor.userId : actor.accountUserId || null,
		learner_id: actor.kind === "learner" ? actor.learnerId : null,
		message,
		page: String(input.page || "").slice(0, 200) || null,
		screenshot,
		status: "new",
	});
	await writeAudit(repo, actor, "feedback.create", actor.kind === "learner" ? actor.learnerId : null, { feedbackId: row.id }, ctx.ip);
	return { ok: true, id: row.id };
}

export async function listFeedback(repo, actor, { status, page = 1 } = {}) {
	requirePermission(actor, PERMISSIONS.FEEDBACK_MANAGE);
	const limit = 25;
	const p = Math.max(1, Number(page) || 1);
	const st = ["new", "reviewing", "resolved"].includes(status) ? status : undefined;
	const { rows, count } = await repo.listFeedback({ status: st, limit, offset: (p - 1) * limit });
	return { items: rows, count, page: p, pages: Math.max(1, Math.ceil(count / limit)) };
}

export async function getFeedbackScreenshot(repo, actor, id) {
	requirePermission(actor, PERMISSIONS.FEEDBACK_MANAGE);
	const f = await repo.getFeedback(id);
	if (!f || !f.screenshot) fail(404, "not_found", "No screenshot");
	return f.screenshot;
}

export async function updateFeedback(repo, actor, id, input, ctx = {}) {
	requirePermission(actor, PERMISSIONS.FEEDBACK_MANAGE);
	const f = await repo.getFeedback(id);
	if (!f) fail(404, "not_found", "Feedback not found");
	const patch = {};
	if (input.status !== undefined) {
		if (!["new", "reviewing", "resolved"].includes(input.status)) fail(422, "invalid", "Unknown status");
		patch.status = input.status;
	}
	if (input.adminNote !== undefined) patch.admin_note = String(input.adminNote).slice(0, 2000);
	await repo.updateFeedback(id, patch);
	await writeAudit(repo, actor, "feedback.update", null, { feedbackId: id, ...patch }, ctx.ip);
	return { ok: true };
}

// ---- presence ----

export const PRESENCE_WINDOW_MS = 5 * 60 * 1000;

export async function touchPresence(repo, actor, path) {
	if (!actor) fail(401, "unauthorized", "Sign in first");
	const kind = actor.kind === "learner" ? "learner" : "user";
	const id = kind === "learner" ? actor.learnerId : actor.userId;
	await repo.touchPresence(kind, id, String(path || "").slice(0, 200));
	return { ok: true };
}

export async function listPresence(repo, actor, now = Date.now()) {
	requirePermission(actor, PERMISSIONS.ADMIN_ACCESS);
	const rows = await repo.listPresence(new Date(now - PRESENCE_WINDOW_MS));
	return {
		windowMinutes: PRESENCE_WINDOW_MS / 60000,
		users: rows.filter((r) => r.kind === "user").length,
		learners: rows.filter((r) => r.kind === "learner").length,
		recent: rows.slice(0, 100).map((r) => ({ kind: r.kind, id: r.subject_id, path: r.path, lastSeenAt: r.last_seen_at })),
	};
}
