import { handleAuth, body } from "@/lib/auth/http";
import { authDeps } from "@/lib/auth/deps";
import { resetPassword } from "@/lib/auth/passwordReset";
import { rateLimit } from "@/lib/mastery-server/http";

// POST { token, password, confirm } -> sets the new password, consumes the token (single use) and signs every older session out.
// The response never contains a token and does not sign the person in: they log in with the new password.
export default handleAuth({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "reset-password-ip", { windowMs: 60 * 60 * 1000, max: 20 })) return;
		const b = body(req);
		await resetPassword(authDeps(), { token: b.token, password: b.password, confirm: b.confirm });
		res.status(200).json({ ok: true, message: "Your password has been changed. You can now log in with it." });
	},
});
