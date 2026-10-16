import {
	Course,
	User,
	Category,
	Enrolment,
	Course_Asset,
} from "database/models";
import { optionalActor, courseAccess } from "@/lib/auth/access";

export default async function handler(req, res) {
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
	const { slug } = req.query;
	try {
		const course = await Course.findOne({
			include: [
				{
					model: User,
					as: "user",
					attributes: [
						"first_name",
						"last_name",
						"profile_photo",
						"bio",
					],
				},
				{
					model: Category,
					as: "category",
					attributes: ["name", "slug"],
				},
				{
					model: Enrolment,
					as: "enrolments",
					attributes: ["id"],
				},
				{
					model: Course_Asset,
					as: "assets",
					attributes: ["id"],
				},
			],
			where: { slug: slug },
		});

		// Unapproved (unpublished) courses are visible only to their owner, admins and
		// already-enrolled students; everyone else gets the same answer as for a missing course.
		if (course && !course.approved) {
			const actor = await optionalActor(req);
			const a = actor ? await courseAccess(actor, course.id) : {};
			if (!(a.owner || a.admin || a.enrolled)) return res.status(404).json({ message: "Course not found" });
		}

		res.status(200).json({
			course,
		});
	} catch (e) {
		res.status(400).json({
			error_code: "get_course",
			message: e.message,
		});
	}
};
