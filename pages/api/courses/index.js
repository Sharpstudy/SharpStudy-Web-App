import { requireUser } from "@/lib/auth/access";
import { Course, User, Enrolment } from "database/models";

export default async function handler(req, res) {
	// 401 for a missing/invalid token (verified, not just present)
	const actor = await requireUser(req, res);
	if (!actor) return;
	switch (req.method) {
		case "GET":
			await handleGetRequest(req, res, actor);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
}

const handleGetRequest = async (req, res, actor) => {
	try {
		const userId = actor.userId;

		const courses = await Course.findAll({
			order: [["created_at", "DESC"]],
			include: [
				{
					model: User,
					as: "user",
					attributes: ["first_name", "last_name", "profile_photo"],
				},
				{
					model: Enrolment,
					as: "enrolments",
					attributes: ["id"],
				},
			],
			where: { userId: userId },
		});

		res.status(200).json({
			courses,
		});
	} catch (e) {
		res.status(400).json({
			error_code: "get_my_courses",
			message: e.message,
		});
	}
};
