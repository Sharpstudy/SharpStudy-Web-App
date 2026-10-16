import { requireRole } from "@/lib/auth/requireRole";
import User from "database/models/user";

export default async function handler(req, res) {
	if (!(await requireRole(req, res, ["admin"]))) return;
	switch (req.method) {
		case "GET":
			await handleGet(req, res);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
}

const handleGet = async (req, res) => {
	try {
		// Everyone who currently HAS instructor access (the role is the source of truth,
		// not the legacy request flags).
		const instructors = await User.findAll({
			where: { role: "instructor" },
			order: [["created_at", "DESC"]],
		});

		res.status(200).json({ instructors });
	} catch (e) {
		res.status(400).json({
			error_code: "get_instructors",
			message: e.message,
		});
	}
};
