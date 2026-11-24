import Sequelize from "sequelize";
import { Course, User, Enrolment, Category } from "database/models";
import connection from "@/database/connection";
import { randomOrderSql } from "@/lib/db/dialect";
import { requireUser } from "@/lib/auth/access";

// Course catalogue data: a signed-in account only (401 without a valid login, 403 for a role outside student / instructor / admin).
export default async function handler(req, res) {
	if (!(await requireUser(req, res))) return;
	switch (req.method) {
		case "GET":
			await handleGetRequest(req, res);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
}

const handleGetRequest = async (req, res) => {
	try {
		const courses = await Course.findAll({
			order: Sequelize.literal(randomOrderSql(connection)),
			limit: 4,
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
			where: { in_home_page: true, approved: true },
		});

		const categories = await Category.findAll({
			order: Sequelize.literal(randomOrderSql(connection)),
			limit: 12,
		});

		res.status(200).json({
			courses,
			categories,
		});
	} catch (e) {
		res.status(400).json({
			error_code: "get_my_courses",
			message: e.message,
		});
	}
};
