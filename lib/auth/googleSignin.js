// "Continue with Google": turns a VERIFIED Google identity into a SharpStudy account. Pure with respect to storage, verification, hashing
// and the clock (tests/auth). The request supplies only the ID token; the user id, role and every profile value come from Google's signed
// claims and our database, never from the browser.
//
//  - Sign-in with a Google identity already linked (users.google_sub) -> that account.
//  - Else an account with the same e-mail (case-insensitive) whose e-mail IS confirmed -> LINKED to it (google_sub only), never
//    duplicated; its password, role and every other field are left exactly as they were.
//  - Else an account with that e-mail whose own e-mail was never confirmed -> REFUSED (409 account_unconfirmed). Nothing is linked,
//    confirmed or overwritten; the owner uses "Forgot password", the explicit process that replaces the password and confirms the e-mail.
//  - Else a new ordinary account: role student (the column default), e-mail confirmed, no usable password.
//  - Google can never grant anything: role, Telecaller approval and instructor/admin status are not read or written here. A Google user
//    who wants telecaller access applies and is approved exactly like everyone else.
import { AuthError } from "./passwordReset.js";
import { accountIsActive } from "./accountState.js";

const clean = (s, max, fallback) => String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) || fallback;

// deps: { repo, verify(idToken), randomPasswordHash(), now }
export async function googleSignin(deps, { credential }) {
	let claims;
	try {
		claims = await deps.verify(credential);
	} catch (e) {
		if (e && e.message === "google_not_configured") throw new AuthError(503, "google_not_configured", "Google sign-in is not available right now.");
		throw new AuthError(401, "invalid_google_token", "We could not verify your Google sign-in. Please try again.");
	}
	if (!claims.email_verified) throw new AuthError(403, "google_email_unverified", "Your Google email address is not verified, so it cannot be used to sign in.");
	const email = String(claims.email).trim().toLowerCase();
	const now = deps.now();

	let user = await deps.repo.findByGoogleSub(claims.sub);
	if (!user) {
		const existing = await deps.repo.findByEmail(email);
		if (existing) {
			if (existing.google_sub && existing.google_sub !== claims.sub) throw new AuthError(409, "google_conflict", "This account is already linked to a different Google account.");
			if (!accountIsActive(existing)) throw new AuthError(403, "account_disabled", "This account is temporarily disabled, please contact the support email.");
			// An account whose own e-mail was never confirmed may have been registered by someone other than the mailbox owner, with a
			// password only they know. Google proves the mailbox, but silently confirming and linking would leave that password working,
			// and replacing it would be an unrequested password change. So nothing is linked, confirmed or changed: the owner is told how
			// to take the account over explicitly (Forgot password: the reset replaces the password AND confirms the e-mail), then signs
			// in with Google.
			if (!existing.email_confirmed) throw new AuthError(409, "account_unconfirmed", "An account with this email address already exists but its email was never confirmed. Use \"Forgot password\" to set a new password (this also confirms your email), then continue with Google again.");
			const linked = await deps.repo.linkGoogle(existing.id, { sub: claims.sub });
			if (!linked) throw new AuthError(409, "google_conflict", "This account is already linked to a different Google account.");
			user = await deps.repo.findById(existing.id);
		} else {
			user = await deps.repo.createGoogleUser({
				first_name: clean(claims.given_name, 100, "Google"),
				last_name: clean(claims.family_name, 100, "User"),
				email,
				password: await deps.randomPasswordHash(),
				email_confirmed: true,
				email_confirmed_at: now,
				status: true,
				google_sub: claims.sub,
			});
			// Two first sign-ins racing: the database keeps one row per e-mail, so use the one that won.
			if (!user) user = await deps.repo.findByEmail(email);
			if (!user) throw new AuthError(409, "conflict", "Could not create the account. Please try again.");
		}
	}
	if (!accountIsActive(user)) throw new AuthError(403, "account_disabled", "This account is temporarily disabled, please contact the support email.");
	return user;
}
