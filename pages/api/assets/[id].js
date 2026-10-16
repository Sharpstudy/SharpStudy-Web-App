import Course_Asset from "database/models/course_asset";
import { requireUser, courseAccess } from "@/lib/auth/access";

// Downloadable course files: owner, admins and enrolled students only.
export default async function handler(req, res) {
	const actor = await requireUser(req, res);
	if (!actor) return;
	const { id: courseId } = req.query;
	try {
		const access = await courseAccess(actor, courseId);
		if (!access.course) return res.status(404).json({ message: "Course not found" });
		if (!(access.owner || access.admin || access.enrolled)) {
			return res.status(403).json({ message: "You are not enrolled in this course" });
		}
		const assets = await Course_Asset.findAll({
			order: [["created_at", "DESC"]],
			where: { courseId: courseId },
		});

		res.status(200).json({ assets });
	} catch (e) {
		res.status(400).json({
			error_code: "get_course_assets",
			message: e.message,
		});
	}
}
