import { handleAuth, body } from "@/lib/auth/http";
import { authDeps } from "@/lib/auth/deps";
import { googleSignin } from "@/lib/auth/googleSignin";
import { signSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/mastery-server/http";

// POST { credential } -> "Continue with Google". `credential` is the ID token issued by Google to OUR client id; it is verified on the
// server (signature, issuer, audience, expiry, verified e-mail). Nothing else from the request is used: no user id, no role, no profile.
// The answer is the same as /api/users/signin, so the rest of the application (token cookie, landing redirect, page gate) is unchanged.
// Google sign-in never grants telecaller / instructor / admin access: those states are read from the database after sign-in.
export default handleAuth({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "google-signin", { windowMs: 15 * 60 * 1000, max: 30 })) return;
		const deps = authDeps();
		const user = await googleSignin(deps, { credential: body(req).credential });
		await deps.audit("auth.login_google", user.id).catch(() => {});
		res.status(200).json({ message: "Login Successful!", edmy_users_token: signSession(user) });
	},
});
