import Course from "database/models/course";
import { requireUser, requireCourseManager, TEACHER_ROLES } from "@/lib/auth/access";

export default async function handler(req, res) {
	// Instructors (their own courses) and admins only; 401 invalid token, 403 other roles/owners.
	const actor = await requireUser(req, res, TEACHER_ROLES);
	if (!actor) return;
	if (!(await requireCourseManager(res, actor, req.query.id))) return;
	switch (req.method) {
		case "GET":
			await handleGet(req, res);
			break;
		case "PUT":
			await handlePut(req, res);
			break;
		case "DELETE":
			await handleDelete(req, res);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
}

const handleGet = async (req, res) => {
	const { id } = req.query;
	try {
		const course = await Course.findOne({
			where: { id: id },
		});

		res.status(200).json({ course });
	} catch (e) {
		res.status(400).json({
			error_code: "update_course",
			message: e.message,
		});
	}
};

const handlePut = async (req, res) => {
	const { id } = req.query;
	const {
		title,
		short_desc,
		overview,
		latest_price,
		before_price,
		lessons,
		duration,
		image,
		access_time,
		requirements,
		what_you_will_learn,
		who_is_this_course_for,
		catId,
	} = req.body;
	try {
		await Course.update(
			{
				title,
				short_desc,
				overview,
				latest_price,
				before_price,
				lessons,
				duration,
				image,
				access_time,
				requirements,
				what_you_will_learn,
				who_is_this_course_for,
				catId,
			},
			{
				where: { id: id },
			}
		);

		res.status(200).json({ message: "Course updated successfully" });
	} catch (e) {
		res.status(400).json({
			error_code: "update_course",
			message: e.message,
		});
	}
};

const handleDelete = async (req, res) => {
	const { id } = req.query;
	try {
		const course = await Course.findOne({
			where: { id: id },
		});

		await course.destroy();

		res.status(200).json({ message: "Course deleted successfully" });
	} catch (e) {
		res.status(400).json({
			error_code: "delete_course",
			message: e.message,
		});
	}
};
