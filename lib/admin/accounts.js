// Admin account management for students and instructors: deactivate / reactivate / anonymize.
//
// The repo is injected (see accountsRepo.js) so every rule here is testable without a database.
//
// Why "delete" anonymizes instead of removing the row: users.id is referenced with ON DELETE CASCADE by
// enrolments, courses, course progress, instructor earnings, mastery learners/assignments, family links
// and more, and with RESTRICT by book orders. A hard delete would wipe learning and financial records.
// So "delete" is implemented as anonymization: it scrubs personal data, permanently disables the login, and keeps every record attached.
import crypto from "crypto";
import { accountIsActive } from "../auth/accountState.js";
import { ANON_DOMAIN, isAnonymized } from "./anonymized.js";


export const MANAGED_ROLES = ["student", "instructor"];
export { ANON_DOMAIN, isAnonymized };

export class AccountError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


async function loadTarget(repo, actor, id, verb) {
	if (!UUID.test(String(id || ""))) throw new AccountError(422, "Invalid user id");
	if (actor.userId === id) throw new AccountError(422, `You cannot ${verb} your own account.`);
	const target = await repo.getUser(id);
	if (!target) throw new AccountError(404, "User not found");
	// Administrators (including the last active one) are never managed here: remove admin access first.
	if (target.role === "admin") throw new AccountError(403, "Administrator accounts cannot be managed from this page.");
	if (!MANAGED_ROLES.includes(target.role)) throw new AccountError(403, "This account type cannot be managed here.");
	return target;
}

const audit = (repo, actor, action, target, details = {}) =>
	repo.audit({ actor_user_id: actor.userId, action, details: { targetUserId: target.id, targetRole: target.role, ...details } }).catch(() => {});

export async function getDetails(repo, actor, id) {
	if (!UUID.test(String(id || ""))) throw new AccountError(422, "Invalid user id");
	const target = await repo.getUser(id);
	if (!target) throw new AccountError(404, "User not found");
	if (!MANAGED_ROLES.includes(target.role)) throw new AccountError(403, "This account type cannot be viewed here.");
	return { user: target, anonymized: isAnonymized(target), records: await repo.relatedCounts(id) };
}

export async function setActive(repo, actor, id, active) {
	if (typeof active !== "boolean") throw new AccountError(422, "`active` must be true or false");
	const target = await loadTarget(repo, actor, id, active ? "reactivate" : "deactivate");
	if (isAnonymized(target)) throw new AccountError(409, "This account was anonymized and cannot be reactivated.");
	if (accountIsActive(target) === active) throw new AccountError(409, `This account is already ${active ? "active" : "inactive"}.`);
	// Only the status flag changes: credentials, progress, courses, assignments etc. are untouched.
	await repo.updateUser(id, { status: active });
	await audit(repo, actor, active ? "admin.account.reactivate" : "admin.account.deactivate", target);
	return { message: active ? "Account reactivated." : "Account deactivated. They can no longer sign in." };
}

export async function anonymizeAccount(repo, actor, id, { confirmEmail } = {}) {
	const target = await loadTarget(repo, actor, id, "anonymize");
	if (isAnonymized(target)) throw new AccountError(409, "This account has already been anonymized.");
	if (String(confirmEmail || "").trim().toLowerCase() !== String(target.email || "").toLowerCase()) {
		throw new AccountError(422, "Type the account's email address to confirm anonymization.");
	}
	const records = await repo.relatedCounts(id);
	await repo.updateUser(id, {
		first_name: "Anonymized",
		last_name: "User",
		email: `anonymized-${target.id}@${ANON_DOMAIN}`,
		// Not a valid bcrypt hash, so no password can ever match it.
		password: `!anonymized:${crypto.randomBytes(24).toString("hex")}`,
		gender: null,
		designation: null,
		bio: null,
		profile_photo: null,
		location: null,
		phone: null,
		website: null,
		twitter: null,
		facebook: null,
		linkedin: null,
		youtube: null,
		instructor_description: null,
		reset_password_token: null,
		email_confirmed: false,
		is_profile_public: false,
		status: false,
	});
	await audit(repo, actor, "admin.account.anonymize", target, { mode: "anonymized", recordsKept: records });
	return { message: "Account anonymized. Personal details were removed; learning, course and payment records were kept." };
}
