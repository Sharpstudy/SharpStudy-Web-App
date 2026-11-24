// Forgot / reset password. Pure with respect to storage, e-mail, hashing, randomness and the clock: everything is passed in (`deps`),
// so every rule is tested without a database or a mail server (tests/auth).
//
// Rules in short
//  - The reset token is 32 random bytes (256 bits) from a CSPRNG, e-mailed once as hex. Only its SHA-256 is stored, in columns that
//    are separate from the e-mail confirmation token. It expires (60 minutes), works once (the update that consumes it is atomic),
//    and a newer request replaces the older token.
//  - Requesting a reset NEVER reveals whether an account exists: the answer is the same for known, unknown, disabled and throttled
//    addresses. Only an enabled account is e-mailed. One e-mail per account per minute.
//  - A reset sets a new bcrypt hash, clears the token, clears any sign-in lockout, and stamps password_changed_at so every login
//    token issued before it stops working (lib/auth/tokenRevocation.js).
//  - Tokens and passwords are never logged, and are never part of an error.
import { createHash } from "node:crypto";
import { passwordProblem } from "./passwordPolicy.js";
import { accountIsActive } from "./accountState.js";
import { resetEmail, passwordChangedEmail } from "./authEmails.js";

export const RESET_TTL_MS = 60 * 60 * 1000;
export const RESET_MIN_INTERVAL_MS = 60 * 1000;
export const GENERIC_REQUEST_MESSAGE = "If an account exists for that email address, we have sent a link to reset the password. The link works once and expires in 1 hour.";

export class AuthError extends Error {
	constructor(status, code, message, fields) {
		super(message);
		this.status = status;
		this.code = code;
		if (fields) this.fields = fields;
	}
}

export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
const looksLikeEmail = (s) => typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// deps: { repo, mailer, now, baseUrl, randomToken(), hashPassword(plain), audit? }
export async function requestPasswordReset(deps, { email }) {
	const generic = { ok: true, message: GENERIC_REQUEST_MESSAGE };
	if (!looksLikeEmail(email)) throw new AuthError(422, "invalid_email", "Enter a valid email address.", { email: "Enter a valid email address." });
	const user = await deps.repo.findByEmail(String(email).trim().toLowerCase());
	// Unknown, disabled: same answer, nothing sent.
	if (!user || !accountIsActive(user)) return generic;
	const now = deps.now();
	if (user.password_reset_requested_at && now.getTime() - new Date(user.password_reset_requested_at).getTime() < RESET_MIN_INTERVAL_MS) return generic;
	const token = deps.randomToken();
	await deps.repo.setResetToken(user.id, { hash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MS), requestedAt: now });
	try {
		await deps.mailer(resetEmail({ user, link: `${deps.baseUrl}/reset-password?token=${token}`, minutes: RESET_TTL_MS / 60000 }));
	} catch (e) {
		/* a mail problem must not change the answer (and would otherwise reveal that the account exists) */
	}
	await audit(deps, "auth.password_reset_requested", user.id);
	return generic;
}

// -> { ok: true }. Throws AuthError(400, "invalid_token") for a wrong, used or expired token, 422 for a weak password.
export async function resetPassword(deps, { token, password, confirm }) {
	if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) throw new AuthError(400, "invalid_token", "This reset link is invalid or has expired. Request a new one.");
	if (confirm !== undefined && confirm !== password) throw new AuthError(422, "mismatch", "The two passwords do not match.", { confirm: "The two passwords do not match." });
	const hash = hashToken(token);
	const user = await deps.repo.findByResetHash(hash);
	const now = deps.now();
	if (!user || !user.password_reset_expires_at || new Date(user.password_reset_expires_at) <= now || !accountIsActive(user)) throw new AuthError(400, "invalid_token", "This reset link is invalid or has expired. Request a new one.");
	const problem = passwordProblem(password, { email: user.email });
	if (problem) throw new AuthError(422, "weak_password", problem, { password: problem });
	const passwordHash = await deps.hashPassword(password);
	const won = await deps.repo.consumeReset(hash, { now, passwordHash });
	if (!won) throw new AuthError(400, "invalid_token", "This reset link is invalid or has expired. Request a new one."); // used by someone else meanwhile
	// the link was delivered to the mailbox, so using it also confirms the e-mail address (the way an unconfirmed account is taken over)
	await deps.repo.confirmEmail(user.id, now);
	await audit(deps, "auth.password_reset", user.id);
	try {
		await deps.mailer(passwordChangedEmail({ user, baseUrl: deps.baseUrl }));
	} catch (e) {
		/* notification only */
	}
	return { ok: true };
}

async function audit(deps, action, userId) {
	try {
		if (deps.audit) await deps.audit(action, userId);
	} catch (e) {
		/* never blocks */
	}
}
