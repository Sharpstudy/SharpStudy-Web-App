// E-mail + password sign-in rules. Pure with respect to storage, hashing and the clock (tests/auth).
//
//  - ONE generic failure for every reason the credentials cannot be accepted: unknown address, wrong password, and a temporarily
//    locked account all answer 401 "Invalid email or password." Nothing about the account is revealed until the password is correct.
//  - Only after the correct password: an unconfirmed e-mail (403 email_unverified: the person needs the confirmation e-mail) and a
//    disabled account (403 account_disabled) are reported, because that person has proved they own the account.
//  - Unknown addresses still run a bcrypt comparison against a dummy hash, so the response time does not reveal them.
//  - Lockout: MAX_FAILURES wrong passwords in a row lock sign-in for LOCK_MS. The counter and the lock live in the database, so they
//    hold across servers. A correct password resets the counter. The lock can only delay a legitimate person by LOCK_MS; the
//    password-reset flow clears it.
import { AuthError } from "./passwordReset.js";
import { accountIsActive } from "./accountState.js";

export const MAX_FAILURES = 8;
export const LOCK_MS = 15 * 60 * 1000;
export const GENERIC_LOGIN_MESSAGE = "Invalid email or password.";
const DUMMY_HASH = "$2b$10$LmgcdSekYhy9bPd5.yXwpeZ3raxPVXysXl4XqH50IhU7ruTdpbJdK";

const invalid = () => new AuthError(401, "invalid_credentials", GENERIC_LOGIN_MESSAGE);

// deps: { findUser(email) -> row with password | null, compare(plain, hash), repo: { lockedUntil, recordFailure, recordSuccess }, now }
export async function authenticate(deps, { email, password }) {
	const user = typeof email === "string" && typeof password === "string" && password ? await deps.findUser(email.trim()) : null;
	if (!user || !user.password) {
		await deps.compare(typeof password === "string" ? password : "", DUMMY_HASH).catch(() => false);
		throw invalid();
	}
	const now = deps.now();
	const lockedUntil = await deps.repo.lockedUntil(user.id);
	if (lockedUntil && new Date(lockedUntil) > now) {
		await deps.compare(password, DUMMY_HASH).catch(() => false);
		throw invalid();
	}
	const ok = await deps.compare(password, user.password);
	if (!ok) {
		await deps.repo.recordFailure(user.id, { now, max: MAX_FAILURES, lockMs: LOCK_MS });
		throw invalid();
	}
	await deps.repo.recordSuccess(user.id);
	if (!user.email_confirmed) throw new AuthError(403, "email_unverified", "Please confirm your email address first. We can send the confirmation email again.");
	if (!accountIsActive(user)) throw new AuthError(403, "account_disabled", "This account is temporarily disabled, please contact the support email.");
	return user;
}
