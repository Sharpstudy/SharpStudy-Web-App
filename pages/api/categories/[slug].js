import { Category, Course, User, Enrolment } from "database/models";
import connection from "@/database/connection";
import { ciEquals } from "@/lib/db/dialect";
import { requireUser } from "@/lib/auth/access";

// Course catalogue data: a signed-in account only (401 without a valid login, 403 for a role outside student / instructor / admin).
export default async function handler(req, res) {
	if (!(await requireUser(req, res))) return;
	const { slug } = req.query;
	try {
		const courses = await Category.findOne({
			where: ciEquals(connection, "slug", slug, Category),
			include: [
				{
					model: Course,
					as: "courses",
					required: false,
					where: { approved: true }, // only published courses are listed
					include: [
						{
							model: User,
							as: "user",
							attributes: [
								"first_name",
								"last_name",
								"profile_photo",
							],
						},
						{
							model: Enrolment,
							as: "enrolments",
							attributes: ["id"],
						},
					],
				},
			],
		});

		res.status(200).json({ courses });
	} catch (e) {
		res.status(400).json({
			error_code: "get_category_by_id",
			message: e.message,
		});
	}
}
