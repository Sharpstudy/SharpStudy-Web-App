import { handleAuth, body, allow } from "@/lib/auth/http";
import { authDeps } from "@/lib/auth/deps";
import { requestPasswordReset, GENERIC_REQUEST_MESSAGE } from "@/lib/auth/passwordReset";
import { rateLimit } from "@/lib/mastery-server/http";

// POST { email } -> always the same 200 answer for a well-formed address (known, unknown, disabled or throttled), so nobody can use it to
// find out who has an account. Limits: 10 requests / hour / client address (429), 3 e-mails / hour / address (silently the same 200),
// plus one e-mail per account per minute inside the service.
export default handleAuth({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "forgot-password-ip", { windowMs: 60 * 60 * 1000, max: 10 })) return;
		const email = body(req).email;
		if (typeof email === "string" && !allow("forgot-password-email", { windowMs: 60 * 60 * 1000, max: 3 }, email.trim().toLowerCase())) {
			return res.status(200).json({ ok: true, message: GENERIC_REQUEST_MESSAGE });
		}
		res.status(200).json(await requestPasswordReset(authDeps(), { email }));
	},
});
