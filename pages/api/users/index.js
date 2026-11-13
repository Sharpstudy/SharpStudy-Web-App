import User from "database/models/user";
import { requireRole } from "@/lib/auth/requireRole";

export default async function handler(req, res) {
	// Lists names and e-mail addresses, so it is admin-only.
	if (!(await requireRole(req, res, ["admin"]))) return;
	try {
		const users = await User.findAll({
			attributes: ["first_name", "last_name", "email"],
			order: [["created_at", "DESC"]],
			limit: 100,
		});

		res.status(200).json({ users });
	} catch (e) {
		res.status(400).json({
			error_code: "get_users",
			message: e.message,
		});
	}
}
