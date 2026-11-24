import bcrypt from "bcrypt";
import isEmail from "validator/lib/isEmail";

import User from "database/models/user";
import connection from "@/database/connection";
import { ciEquals } from "@/lib/db/dialect";
import masteryRepo from "@/lib/mastery-server/repo";
import { rateLimit } from "@/lib/mastery-server/http";
import { authenticate, GENERIC_LOGIN_MESSAGE } from "@/lib/auth/signinGuard";
import { AuthError } from "@/lib/auth/passwordReset";
import { signSession } from "@/lib/auth/session";
import credentialsRepo from "@/lib/auth/credentialsRepo";

// Mastery Ladder audit trail. Never blocks or alters the login response.
const auditLogin = (action, userId, req) =>
	masteryRepo
		.addAudit({ actor_user_id: userId, action, details: {}, ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].slice(0, 64) })
		.catch(() => {});

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store");
	switch (req.method) {
		case "POST":
			await userSignin(req, res);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
}

// Every credential failure answers the same way (401, "Invalid email or password."), see lib/auth/signinGuard.js. A client-address
// limit stops bulk guessing; a per-account lockout (shared through the database) stops slow guessing against one account.
const userSignin = async (req, res) => {
	if (!rateLimit(req, res, "signin-ip", { windowMs: 15 * 60 * 1000, max: 30 })) return;
	const { email, password } = req.body || {};

	try {
		if (typeof email !== "string" || !isEmail(email)) {
			return res.status(422).json({ message: "Enter a valid email address." });
		}

		const user = await authenticate(
			{
				// unscoped: the default scope hides the password hash, which sign-in needs
				findUser: (e) => User.unscoped().findOne({ where: ciEquals(connection, "email", e) }),
				compare: (plain, hash) => bcrypt.compare(plain, hash),
				repo: credentialsRepo,
				now: () => new Date(),
			},
			{ email, password }
		);

		await auditLogin("auth.login", user.id, req);
		res.status(200).json({ message: "Login Successful!", edmy_users_token: signSession(user) });
	} catch (e) {
		if (e instanceof AuthError) {
			if (e.code === "invalid_credentials") return res.status(401).json({ code: e.code, message: GENERIC_LOGIN_MESSAGE });
			return res.status(e.status).json({ code: e.code, message: e.message });
		}
		// Database unreachable (e.g. MySQL not running): Sequelize connection
		// errors carry an empty message, which used to surface as a blank 400.
		if (e?.name?.startsWith("SequelizeConnection")) {
			console.error("signin: database unavailable:", e.name, e.parent?.code);
			return res.status(503).json({
				error_code: "db_unavailable",
				message: "Service temporarily unavailable, please try again shortly.",
			});
		}
		console.error("signin: unexpected failure:", e && e.name);
		res.status(500).json({
			error_code: "user_login",
			message: "Could not sign in right now, please try again.",
		});
	}
};
