import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import isEmail from "validator/lib/isEmail";

import User from "database/models/user";
import masteryRepo from "@/lib/mastery-server/repo";

// Mastery Ladder audit trail. Never blocks or alters the login response.
const auditLogin = (action, userId, req) =>
	masteryRepo
		.addAudit({ actor_user_id: userId, action, details: {}, ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].slice(0, 64) })
		.catch(() => {});

export default async function handler(req, res) {
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

const userSignin = async (req, res) => {
	const { email, password } = req.body;

	try {
		if (!isEmail(email)) {
			return res
				.status(422)
				.json({ message: "Email should be a valid email address" });
		}

		// unscoped: the default scope hides the password hash, which sign-in needs
		const user = await User.unscoped().findOne({
			where: { email: email },
		});

		if (!user) {
			return res
				.status(404)
				.json({ message: "User account does not exist" });
		}

		if (!user.email_confirmed) {
			return res.status(404).json({
				message:
					"Email is not confirmed yet, please confirm your email.",
			});
		}

		if (!user.status) {
			return res.status(404).json({
				message:
					"This account is temporarily disabled, please contact the support email",
			});
		}

		const passwordsMatch = await bcrypt.compare(password, user.password);
		if (passwordsMatch) {
			await auditLogin("auth.login", user.id, req);
			const edmy_users_token = jwt.sign(
				{
					userId: user.id,
					first_name: user.first_name,
					last_name: user.last_name,
					email: user.email,
					role: user.role,
					profile_photo: user.profile_photo,
				},
				process.env.JWT_SECRET,
				{ expiresIn: "7d" }
			);
			res.status(200).json({
				message: "Login Successful!",
				edmy_users_token,
			});
		} else {
			await auditLogin("auth.login_failed", user.id, req);
			res.status(401).json({ message: "Password is not correct" });
		}
	} catch (e) {
		// Database unreachable (e.g. MySQL not running): Sequelize connection
		// errors carry an empty message, which used to surface as a blank 400.
		if (e?.name?.startsWith("SequelizeConnection")) {
			console.error("signin: database unavailable:", e.name, e.parent?.code);
			return res.status(503).json({
				error_code: "db_unavailable",
				message: "Service temporarily unavailable, please try again shortly.",
			});
		}
		res.status(400).json({
			error_code: "user_login",
			message: e.message,
		});
	}
};
