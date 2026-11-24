import isEmail from "validator/lib/isEmail";
import User from "database/models/user";
import connection from "@/database/connection";
import { ciEquals } from "@/lib/db/dialect";
import { rateLimit } from "@/lib/mastery-server/http";
import { allow } from "@/lib/auth/http";
import { accountIsActive } from "@/lib/auth/accountState";
import { confirmEmailAddress } from "email-templates/account-confirmation";

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store");
	switch (req.method) {
		case "POST":
			await userConfirmationEmailSend(req, res);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
}

const GENERIC = "If that address has an account that still needs confirming, we have sent the confirmation email again.";

// "Send the confirmation email again". Same answer whether or not the address has an account, and whether or not it is already
// confirmed, so it cannot be used to discover accounts. Limits: 5 requests / hour / client address (429) and 3 e-mails / hour /
// address (silently the same answer). Only an unconfirmed, enabled account is e-mailed.
const userConfirmationEmailSend = async (req, res) => {
	if (!rateLimit(req, res, "send-confirmation", { windowMs: 60 * 60 * 1000, max: 5 })) return;
	const { email, next } = req.body || {};
	try {
		if (typeof email !== "string" || !isEmail(email)) {
			return res.status(422).json({
				message: "Email should be a valid email address",
			});
		}
		if (!allow("send-confirmation-email", { windowMs: 60 * 60 * 1000, max: 3 }, email.trim().toLowerCase())) {
			return res.status(200).json({ message: GENERIC });
		}

		// unscoped: the confirmation link in the e-mail carries reset_password_token
		const user = await User.unscoped().findOne({
			where: ciEquals(connection, "email", email),
		});

		if (user && !user.email_confirmed && accountIsActive(user)) {
			await confirmEmailAddress(user, next);
		}
		res.status(200).json({ message: GENERIC });
	} catch (e) {
		console.error("send-confirmation-email failed:", e && e.name);
		res.status(400).json({
			error_code: "confirm_email",
			message: "Could not send the email right now. Please try again shortly.",
		});
	}
};
