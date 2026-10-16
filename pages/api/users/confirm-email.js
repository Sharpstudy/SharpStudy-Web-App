import validate from "uuid-validate";
import User from "database/models/user";
import { rateLimit } from "@/lib/mastery-server/http";

export default async (req, res) => {
	switch (req.method) {
		case "PUT":
			await userEmailConfirm(req, res);
			break;
		default:
			res.status(405).send(`Method ${req.method} not allowed`);
	}
};

const userEmailConfirm = async (req, res) => {
	if (!rateLimit(req, res, "confirm-email", { windowMs: 15 * 60 * 1000, max: 20 })) return;
	let { token, email } = req.body || {};
	const validUuid = typeof token === "string" && validate(token);
	try {
		if (!token) {
			return res.status(422).json({
				message:
					"Assigned token is missing, try clicking on the exact link from the email",
			});
		} else if (!validUuid) {
			return res.status(422).json({ message: "Token is incorrect" });
		}

		// unscoped: the default scope hides reset_password_token, which is the proof
		// that the person confirming owns this mailbox (it was only ever e-mailed).
		const user = typeof email === "string" ? await User.unscoped().findOne({ where: { email } }) : null;

		// console.log(user)

		if (!user) {
			return res.status(422).json({ message: `Email is incorrect` });
		} else if (user.reset_password_token !== token) {
			// The token must be the one issued to this account, not just any valid uuid.
			return res.status(422).json({ message: "Token is incorrect" });
		} else if (user.email_confirmed) {
			return res
				.status(422)
				.send({ message: `Email address is already confirmed!` });
		}

		await User.update(
			{
				email_confirmed: true,
				email_confirmed_at: Date.now(),
			},
			{
				where: {
					id: user.id,
				},
			}
		);

		res.status(201).json({
			message: `Email address confirmed successfully. Thank you`,
		});
	} catch (e) {
		res.status(400).json({
			error_code: "email_confirmation",
			message: "Could not confirm the email address",
		});
	}
};
