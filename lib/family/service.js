// Family & child devices: child profiles, the family PIN, pairing a child's device, parent
// approval, device revocation and the child's picture sign-in.
//
// Builds on the existing Mastery Ladder identity model instead of adding a second one:
//   - a child profile IS an ml_learners row (owner = the parent account, guardians = other parents);
//   - a child's session IS the existing signed learner token, with the device id added so that
//     revoking the device ends the session at once (see deviceAllowsLearner);
//   - learner profiles are NEVER created here. Instructors/admins create them (lib/mastery, studentLinks) and
//     hand a parent access with a single-use link code (links.js), which adds an ml_learner_guardians row with
//     relation "parent". Every family operation below requires that parent link on the specific learner, and a
//     paired device belongs to the parent who paired it (not to the learner's owner).
// Nothing here trusts a client-supplied owner, family, role, approval flag or learner id: every
// learner is re-loaded and access-checked, and devices are matched by a secret only the device holds.
//
// Pure with respect to storage: functions take a `repo` (see repo.js; tests use an in-memory one) and
// an explicit `now` (ms) in ctx.

import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import { ServiceError, LIMITS as ML_LIMITS, loadLearner, writeAudit, publicLearner } from "../mastery/service.js";
import { accountIsActive } from "../auth/accountState.js";

import { learnerAccess, resolvePermissions } from "../mastery/policy.js";
import { signLearnerToken, signGrownupToken, verifyGrownupToken } from "../mastery/tokens.js";
import { generateCode, normalizeCode, hashCode, formatCode, newDeviceSecret, hashSecret, parseDeviceToken, safeEqualHex, deviceLabel } from "./codes.js";

const fail = (status, code, message, extra) => {
	throw new ServiceError(status, code, message, extra);
};

export const FAMILY_LIMITS = {
	nameMax: 24,
	deviceNameMax: 60,
	pinMin: 4,
	pinMax: 6,
	pinMaxFailures: 5,
	pictureMaxFailures: 5,
	lockMs: 10 * 60 * 1000,
	codeTtlMs: Math.max(1, Number(process.env.FAMILY_CODE_TTL_MIN) || 10) * 60 * 1000,
	pendingTtlMs: 10 * 60 * 1000, // a redeemed code must be approved within this long
	maxChildDevices: 12, // learners on one device
	onlineMs: 2 * 60 * 1000,
	touchMs: 60 * 1000, // how often a device's last_seen_at is written
	hashRounds: ML_LIMITS.pinHashRounds,
};

export const AGE_BANDS = ["6-7", "7-8", "8-9"];
// Stored in ml_learners.avatar (varchar 16). The first six are the family picker; the UI draws an icon for each.
export const FAMILY_AVATARS = ["🚀", "🌿", "⭐", "🐟", "🌙", "🌸"];
export const PICTURES = ["sun", "star", "heart", "moon", "leaf", "fish", "cloud", "flower", "ball"];
const PIN_RE = new RegExp(`^\\d{${FAMILY_LIMITS.pinMin},${FAMILY_LIMITS.pinMax}}$`);
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '’.\-]*$/u;

const nowOf = (ctx) => (ctx && ctx.now) || Date.now();
const iso = (d) => (d ? new Date(d).toISOString() : null);
const ms = (d) => (d ? new Date(d).getTime() : 0);

export function requireAccount(actor) {
	if (!actor || actor.kind !== "account") fail(401, "unauthorized", "Sign in first");
}

// ------------------------------------------------------------------ validation

function cleanName(raw, max, what = "Nickname") {
	const n = String(raw === undefined || raw === null ? "" : raw).trim().replace(/\s+/g, " ");
	if (n.length < 1 || n.length > max) fail(422, "invalid", `${what} must be 1–${max} characters`);
	if (!NAME_RE.test(n)) fail(422, "invalid", `${what} can use letters, numbers, spaces and ' - . only`);
	return n;
}

function cleanPicture(input) {
	if (!Array.isArray(input) || input.length !== 3 || input.some((p) => !PICTURES.includes(p))) fail(422, "invalid", "Choose exactly 3 pictures");
	return input.join("-");
}

// ------------------------------------------------------------------ parent authority

// The ONLY family authority: an active ml_learner_guardians row with relation "parent" for this exact learner
// (created by redeeming a code the child showed), and the access that row gives. Owning a profile, teaching it or
// holding learners.create is not parenthood, and nothing a client sends can widen this.
export async function isParentOf(repo, userId, learner) {
	if (!userId || !learner) return false;
	const user = await repo.getUser(userId);
	if (!accountIsActive(user)) return false;
	const link = await repo.getGuardian(learner.id, userId);
	if (!link || link.relation !== "parent") return false;
	const actor = { kind: "account", userId: user.id, role: user.role, permissions: resolvePermissions(user.role, await repo.permissionsForUser(user.id)) };
	return learnerAccess(actor, learner, link).admin === true;
}

// A learner this account is a linked parent of; anyone else gets the same answer as for a missing learner.
async function loadParentLearner(repo, actor, learnerId) {
	requireAccount(actor);
	const { learner } = await loadLearner(repo, actor, learnerId, "admin");
	if (!(await isParentOf(repo, actor.userId, learner))) fail(404, "not_found", "Learner not found");
	return learner;
}

// ------------------------------------------------------------------ views

export const publicChild = (l) => ({
	id: l.id,
	nickname: l.display_name,
	avatar: l.avatar,
	ageBand: l.age_band || null,
	pictureCode: !!l.picture_hash,
});

const deviceStatusView = (d, now) => {
	if (d.status === "pending" && ms(d.pending_until) <= now) return "expired";
	return d.status;
};

function deviceView(d, now) {
	const seen = ms(d.last_seen_at);
	return {
		id: d.id,
		name: d.name || null,
		label: d.label,
		status: deviceStatusView(d, now),
		learnerIds: d.learner_ids || [],
		shared: (d.learner_ids || []).length > 1,
		lastSeenAt: iso(d.last_seen_at),
		online: !!seen && now - seen < FAMILY_LIMITS.onlineMs && d.status === "approved",
		requestedAt: iso(d.created_at),
	};
}

// The children this account is a linked parent of (an administrator or instructor is not a parent by that fact).
export async function managedChildren(repo, actor) {
	const out = [];
	for (const l of await repo.listLearnersByGuardian(actor.userId)) if (l._relation === "parent" && (await isParentOf(repo, actor.userId, l))) out.push(l);
	return out.sort((a, b) => ms(a.created_at) - ms(b.created_at));
}

// ------------------------------------------------------------------ family overview

export async function getFamily(repo, actor, ctx = {}) {
	requireAccount(actor);
	const now = nowOf(ctx);
	const kids = await managedChildren(repo, actor);
	const ids = kids.map((k) => k.id);
	const devices = ids.length ? await repo.listDevicesForLearners(ids) : [];
	const live = devices.filter((d) => d.status === "approved" || (d.status === "pending" && ms(d.pending_until) > now));
	const pin = await repo.getFamPin(actor.userId);
	return {
		pinSet: !!pin,
		children: kids.map((k) => ({
			...publicChild(k),
			devices: live.filter((d) => (d.learner_ids || []).includes(k.id) && d.status === "approved").map((d) => deviceView(d, now)),
		})),
		requests: live
			.filter((d) => d.status === "pending")
			.map((d) => ({ ...deviceView(d, now), learners: kids.filter((k) => (d.learner_ids || []).includes(k.id)).map((k) => ({ id: k.id, nickname: k.display_name, avatar: k.avatar })) })),
	};
}

// ------------------------------------------------------------------ children

// The only edit a parent can make to a linked child: the secret picture code used to sign in on a paired device.
// Name, avatar, grade, PIN, placement and ownership belong to the instructor/admin who manages the profile.
export async function setChildPicture(repo, actor, learnerId, input, ctx = {}) {
	const learner = await loadParentLearner(repo, actor, learnerId);
	input = input || {};
	if (Object.keys(input).some((k) => k !== "picture")) fail(422, "invalid", "Only the picture code can be changed here");
	if (input.picture === undefined) fail(422, "invalid", "Choose exactly 3 pictures");
	const patch = {
		picture_hash: input.picture === null ? null : await bcrypt.hash(cleanPicture(input.picture), FAMILY_LIMITS.hashRounds),
		picture_failed_attempts: 0,
		picture_locked_until: null,
	};
	const updated = await repo.updateLearner(learner.id, patch);
	await writeAudit(repo, actor, "family.child_picture", learner.id, { cleared: input.picture === null }, ctx.ip);
	return publicChild(updated);
}

// Checks the PIN of `ownerUserId` with a persisted lockout. Wrong and locked answers never say anything
// about the PIN itself. `remaining` counts attempts left before the lock.
async function checkFamilyPin(repo, ownerUserId, pin, now, ctx, who) {
	const row = await repo.getFamPin(ownerUserId);
	if (!row) fail(409, "no_pin", "A family PIN has not been set up yet");
	if (row.locked_until && ms(row.locked_until) > now) {
		fail(423, "locked", "Too many wrong PINs. Try again in a few minutes.", { lockedUntil: iso(row.locked_until) });
	}
	const ok = typeof pin === "string" && PIN_RE.test(pin) && (await bcrypt.compare(pin, row.pin_hash));
	if (!ok) {
		const failures = (row.failed_attempts || 0) + 1;
		const lock = failures >= FAMILY_LIMITS.pinMaxFailures;
		await repo.upsertFamPin(ownerUserId, { failed_attempts: lock ? 0 : failures, locked_until: lock ? new Date(now + FAMILY_LIMITS.lockMs) : null });
		await writeAudit(repo, who, "family.pin_failed", null, { locked: lock }, ctx.ip);
		fail(401, "wrong_pin", lock ? "Too many wrong PINs. Try again in 10 minutes." : "That PIN is not right.", { remaining: lock ? 0 : FAMILY_LIMITS.pinMaxFailures - failures });
	}
	if (row.failed_attempts || row.locked_until) await repo.upsertFamPin(ownerUserId, { failed_attempts: 0, locked_until: null });
}

// First PIN: any family account. Changing it needs the current PIN or the account password
// (so a forgotten PIN can be reset from the parent's own signed-in phone).
export async function setFamilyPin(repo, actor, input, ctx = {}) {
	requireAccount(actor);
	if (!(await managedChildren(repo, actor)).length) fail(403, "forbidden", "Link a child to your account before setting a family PIN");
	input = input || {};
	if (typeof input.pin !== "string" || !PIN_RE.test(input.pin)) fail(422, "invalid", `PIN must be ${FAMILY_LIMITS.pinMin} to ${FAMILY_LIMITS.pinMax} digits`);
	const now = nowOf(ctx);
	const existing = await repo.getFamPin(actor.userId);
	if (existing) {
		if (input.currentPin !== undefined && input.currentPin !== "") {
			await checkFamilyPin(repo, actor.userId, input.currentPin, now, ctx, actor);
		} else if (input.password) {
			const u = await repo.getUserWithPassword(actor.userId);
			if (!u || !u.password || !(await bcrypt.compare(String(input.password), u.password))) fail(401, "wrong_password", "That password is not right.");
		} else {
			fail(422, "invalid", "Enter your current PIN or your account password to change the PIN");
		}
	}
	await repo.upsertFamPin(actor.userId, { pin_hash: await bcrypt.hash(input.pin, FAMILY_LIMITS.hashRounds), failed_attempts: 0, locked_until: null });
	await writeAudit(repo, actor, existing ? "family.pin_change" : "family.pin_set", null, {}, ctx.ip);
	return { pinSet: true };
}

// ------------------------------------------------------------------ pairing (parent side)

export async function createPairing(repo, actor, input, ctx = {}) {
	requireAccount(actor);
	const now = nowOf(ctx);
	const ids = input && input.learnerIds;
	if (!Array.isArray(ids) || ids.length < 1 || ids.length > FAMILY_LIMITS.maxChildDevices || ids.some((x) => typeof x !== "string" || !x || x.length > 36)) fail(422, "invalid", "Choose who this device is for");
	const learnerIds = [...new Set(ids)];
	// Every child must be one this account is a linked parent of; the device then belongs to this parent.
	for (const id of learnerIds) await loadParentLearner(repo, actor, id);
	const ownerUserId = actor.userId;
	// Without a PIN a child could leave child mode at will.
	if (!(await repo.getFamPin(ownerUserId))) fail(409, "pin_required", "Set a family PIN before pairing a device", {});
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = generateCode();
		try {
			const row = await repo.createPairingCode({
				id: uuidv4(),
				owner_user_id: ownerUserId,
				created_by: actor.userId,
				code_hash: hashCode(code),
				learner_ids: learnerIds,
				status: "open",
				expires_at: new Date(now + FAMILY_LIMITS.codeTtlMs),
				created_at: new Date(now),
			});
			// One live code per parent: a new code replaces OLDER ones. Insert first, then cancel only codes created
			// before this one, so two requests racing (a double tap, a re-render) can never cancel each other's code.
			await repo.cancelOlderOpenCodes(actor.userId, row.created_at, row.id);
			await writeAudit(repo, actor, "family.pairing_create", null, { learners: learnerIds.length }, ctx.ip);
			// The only time the plain code exists outside the child's own typing.
			return { id: row.id, code, display: formatCode(code), joinPath: `/learn/join/?code=${code}`, expiresAt: iso(row.expires_at), ttlSeconds: Math.round(FAMILY_LIMITS.codeTtlMs / 1000) };
		} catch (e) {
			if (!(e && e.code === "duplicate_code")) throw e;
		}
	}
	fail(500, "server_error", "Could not create a code. Please try again.");
}

async function loadOwnCode(repo, actor, id) {
	requireAccount(actor);
	const code = typeof id === "string" ? await repo.getPairingCode(id) : null;
	// Someone else's code is the same as a missing one.
	if (!code || (code.created_by !== actor.userId && code.owner_user_id !== actor.userId)) fail(404, "not_found", "Pairing code not found");
	return code;
}

export async function getPairing(repo, actor, id, ctx = {}) {
	const now = nowOf(ctx);
	const code = await loadOwnCode(repo, actor, id);
	let status = code.status;
	if (status === "open" && ms(code.expires_at) <= now) status = "expired";
	const out = { id: code.id, status, expiresAt: iso(code.expires_at), secondsLeft: Math.max(0, Math.round((ms(code.expires_at) - now) / 1000)) };
	if (status === "claimed" || status === "approved") {
		const d = await repo.getDeviceByCode(code.id);
		if (d) {
			const kids = [];
			for (const lid of d.learner_ids || []) {
				const l = await repo.getLearner(lid);
				if (l) kids.push({ id: l.id, nickname: l.display_name, avatar: l.avatar });
			}
			out.device = { ...deviceView(d, now), learners: kids };
			if (out.device.status === "expired") out.status = "expired";
		}
	}
	return out;
}

export async function cancelPairing(repo, actor, id, ctx = {}) {
	const code = await loadOwnCode(repo, actor, id);
	if (code.status === "open") await repo.updatePairingCode(code.id, { status: "cancelled" }, { whereStatus: ["open"] });
	return { ok: true };
}

// ------------------------------------------------------------------ pairing (child device side, no account)

const INVALID_CODE = ["invalid_code", "That code did not work. Check it and try again, or ask your grown-up for a new one."];

export async function redeemPairing(repo, input, ctx = {}) {
	const now = nowOf(ctx);
	const code = normalizeCode(input && input.code);
	if (!code) fail(422, ...INVALID_CODE);
	const dev = newDeviceSecret();
	const claimed = await repo.claimPairingCode({
		codeHash: hashCode(code),
		now: new Date(now),
		device: {
			id: uuidv4(),
			label: deviceLabel(ctx.userAgent),
			secret_hash: dev.hash,
			status: "pending",
			pending_until: new Date(now + FAMILY_LIMITS.pendingTtlMs),
		},
	});
	// Unknown, expired, already used, cancelled: all the same answer.
	if (!claimed) fail(410, ...INVALID_CODE);
	const learners = [];
	for (const lid of claimed.device.learner_ids) {
		const l = await repo.getLearner(lid);
		if (l) learners.push({ nickname: l.display_name, avatar: l.avatar });
	}
	await writeAudit(repo, null, "family.pairing_redeem", null, {}, ctx.ip);
	return { deviceToken: `${claimed.device.id}.${dev.secret}`, status: "pending", learners, pendingSeconds: Math.round(FAMILY_LIMITS.pendingTtlMs / 1000) };
}

// Resolves a device token to its row, or throws. Constant-time secret comparison.
export async function authenticateDevice(repo, token, ctx = {}, { allowPending = false } = {}) {
	const now = nowOf(ctx);
	const t = parseDeviceToken(token);
	const d = t ? await repo.getDevice(t.id) : null;
	if (!d || !safeEqualHex(d.secret_hash, hashSecret(t.secret))) fail(401, "device_invalid", "This device is not paired. Ask your grown-up for a new code.");
	if (d.status === "revoked") fail(401, "device_revoked", "This device was removed by your grown-up.");
	if (d.status === "denied") fail(401, "device_denied", "Your grown-up said no. Ask them for a new code.");
	if (d.status === "pending") {
		if (ms(d.pending_until) <= now) fail(401, "device_expired", "That took too long. Ask your grown-up for a new code.");
		if (!allowPending) fail(403, "device_pending", "Waiting for your grown-up to say yes.");
	}
	if (d.status === "approved" && now - ms(d.last_seen_at) > FAMILY_LIMITS.touchMs) await repo.updateDevice(d.id, { last_seen_at: new Date(now) });
	return d;
}

async function deviceChildren(repo, d) {
	const out = [];
	for (const lid of d.learner_ids || []) {
		const l = await repo.getLearner(lid);
		// A child whose parent link was removed (or who was deleted) silently drops off the device.
		if (l && (await isParentOf(repo, d.owner_user_id, l))) out.push(l);
	}
	return out;
}

// What the waiting screen and the profile picker poll. Returns names/avatars only: no ids of other families, no secrets.
export async function deviceStatus(repo, token, ctx = {}) {
	const d = await authenticateDevice(repo, token, ctx, { allowPending: true });
	if (d.status === "pending") {
		const kids = await deviceChildren(repo, d);
		return { status: "pending", learners: kids.map((l) => ({ nickname: l.display_name, avatar: l.avatar })) };
	}
	const kids = await deviceChildren(repo, d);
	return { status: "approved", deviceName: d.name || d.label, learners: kids.map((l) => ({ id: l.id, nickname: l.display_name, avatar: l.avatar, pictureRequired: !!l.picture_hash })) };
}

// ------------------------------------------------------------------ approval / revocation (parent)

async function loadManagedDevice(repo, actor, deviceId) {
	requireAccount(actor);
	const d = typeof deviceId === "string" ? await repo.getDevice(deviceId) : null;
	if (!d) fail(404, "not_found", "Device not found");
	// The parent must manage EVERY child on the device; anyone else sees a missing device.
	for (const lid of d.learner_ids || []) {
		try {
			await loadParentLearner(repo, actor, lid);
		} catch (e) {
			if (e instanceof ServiceError) fail(404, "not_found", "Device not found");
			throw e;
		}
	}
	return d;
}

export async function decideDevice(repo, actor, deviceId, input, ctx = {}) {
	const now = nowOf(ctx);
	const d = await loadManagedDevice(repo, actor, deviceId);
	const action = input && input.action;
	if (action !== "approve" && action !== "deny") fail(422, "invalid", "Unknown action");
	if (d.status !== "pending") fail(409, "conflict", "This request was already answered");
	if (ms(d.pending_until) <= now) fail(409, "expired", "This request expired. Make a new code.");
	if (action === "deny") {
		const u = await repo.updateDevice(d.id, { status: "denied" }, { whereStatus: ["pending"] });
		if (!u) fail(409, "conflict", "This request was already answered");
		await repo.updatePairingCode(d.pairing_code_id, { status: "denied" }, {});
		await writeAudit(repo, actor, "family.device_deny", null, { deviceId: d.id }, ctx.ip);
		return { ok: true, status: "denied" };
	}
	const first = await repo.getLearner((d.learner_ids || [])[0]);
	const name = input.name === undefined || String(input.name).trim() === "" ? `${first ? first.display_name : "Child"}'s ${d.label.split(" · ")[0]}`.slice(0, FAMILY_LIMITS.deviceNameMax) : cleanName(input.name, FAMILY_LIMITS.deviceNameMax, "Device name");
	// Compare-and-set: two parents tapping at once cannot both win, and a revoked/denied device cannot be revived.
	const u = await repo.updateDevice(d.id, { status: "approved", name, approved_at: new Date(now), approved_by: actor.userId, last_seen_at: null }, { whereStatus: ["pending"] });
	if (!u) fail(409, "conflict", "This request was already answered");
	await repo.updatePairingCode(d.pairing_code_id, { status: "approved" }, {});
	await writeAudit(repo, actor, "family.device_approve", null, { deviceId: d.id, children: (d.learner_ids || []).length }, ctx.ip);
	return { ok: true, status: "approved", name };
}

export async function revokeDevice(repo, actor, deviceId, input, ctx = {}) {
	const now = nowOf(ctx);
	const d = await loadManagedDevice(repo, actor, deviceId);
	if (!input || input.confirm !== true) fail(422, "confirm_required", "Confirm that you want to remove this device");
	if (d.status === "revoked") return { ok: true, status: "revoked" };
	const u = await repo.updateDevice(d.id, { status: "revoked", revoked_at: new Date(now), revoked_by: actor.userId }, { whereStatus: ["approved", "pending"] });
	if (!u) fail(409, "conflict", "This device cannot be removed");
	await writeAudit(repo, actor, "family.device_revoke", null, { deviceId: d.id }, ctx.ip);
	return { ok: true, status: "revoked" };
}

// ------------------------------------------------------------------ child sign-in

// True only while the device is still approved, still carries this child, and the family still owns them.
// Called for every request made with a device-bound learner token, so revocation is immediate.
export async function deviceAllowsLearner(repo, claims) {
	if (!claims || !claims.deviceId) return true; // an ordinary (non-device) learner session
	const d = await repo.getDevice(claims.deviceId);
	if (!d || d.status !== "approved") return false;
	if (!(d.learner_ids || []).includes(claims.learnerId)) return false;
	if (d.owner_user_id !== claims.accountUserId) return false;
	const l = await repo.getLearner(claims.learnerId);
	return !!l && (await isParentOf(repo, d.owner_user_id, l)); // a child whose parent link was removed loses the session
}

export async function startChildSession(repo, token, input, ctx = {}) {
	const now = nowOf(ctx);
	const d = await authenticateDevice(repo, token, ctx);
	const lid = input && typeof input.learnerId === "string" ? input.learnerId : "";
	const kids = await deviceChildren(repo, d);
	const learner = kids.find((l) => l.id === lid);
	if (!learner) fail(404, "not_found", "That profile is not on this device");
	if (learner.picture_hash) {
		if (learner.picture_locked_until && ms(learner.picture_locked_until) > now) {
			fail(423, "locked", "Too many tries. Ask your grown-up for help.", { lockedUntil: iso(learner.picture_locked_until) });
		}
		const seq = Array.isArray(input.picture) && input.picture.length === 3 && input.picture.every((p) => PICTURES.includes(p)) ? input.picture.join("-") : null;
		if (!seq || !(await bcrypt.compare(seq, learner.picture_hash))) {
			const failures = (learner.picture_failed_attempts || 0) + 1;
			const lock = failures >= FAMILY_LIMITS.pictureMaxFailures;
			await repo.updateLearner(learner.id, { picture_failed_attempts: lock ? 0 : failures, picture_locked_until: lock ? new Date(now + FAMILY_LIMITS.lockMs) : null });
			await writeAudit(repo, { kind: "learner", learnerId: learner.id, accountUserId: d.owner_user_id }, "family.picture_failed", learner.id, { locked: lock }, ctx.ip);
			fail(401, "wrong_picture", lock ? "Too many tries. Ask your grown-up for help." : "Not quite. Try again!", { remaining: lock ? 0 : FAMILY_LIMITS.pictureMaxFailures - failures });
		}
		if (learner.picture_failed_attempts || learner.picture_locked_until) await repo.updateLearner(learner.id, { picture_failed_attempts: 0, picture_locked_until: null });
	}
	await repo.updateLearner(learner.id, { last_seen_at: new Date(now) });
	await writeAudit(repo, { kind: "learner", learnerId: learner.id, accountUserId: d.owner_user_id }, "family.child_login", learner.id, { deviceId: d.id }, ctx.ip);
	return { learnerToken: signLearnerToken({ learnerId: learner.id, accountUserId: d.owner_user_id, deviceId: d.id }), learner: publicLearner(learner) };
}

// ------------------------------------------------------------------ grown-ups only (child device)

export async function grownupAccess(repo, token, input, ctx = {}) {
	const now = nowOf(ctx);
	const d = await authenticateDevice(repo, token, ctx);
	await checkFamilyPin(repo, d.owner_user_id, input && input.pin, now, ctx, { kind: "learner", learnerId: null, accountUserId: d.owner_user_id });
	return { grownupToken: signGrownupToken({ deviceId: d.id, ownerUserId: d.owner_user_id }), expiresInSeconds: 300 };
}

// The device removes itself, after the family PIN was entered on it.
export async function unpairThisDevice(repo, token, grownupToken, ctx = {}) {
	const now = nowOf(ctx);
	const d = await authenticateDevice(repo, token, ctx);
	const g = verifyGrownupToken(grownupToken);
	if (!g || g.deviceId !== d.id || g.ownerUserId !== d.owner_user_id) fail(403, "grownup_required", "Ask a grown-up to enter the family PIN.");
	await repo.updateDevice(d.id, { status: "revoked", revoked_at: new Date(now), revoked_by: d.owner_user_id }, { whereStatus: ["approved"] });
	await writeAudit(repo, { kind: "learner", learnerId: null, accountUserId: d.owner_user_id }, "family.device_unpair", null, { deviceId: d.id }, ctx.ip);
	return { ok: true };
}
