import { Course_Progress } from "@/database/models";
import { requireUser } from "@/lib/auth/access";

// The signed-in user's own progress in a course (a userId in the query is ignored).
export default async function handler(req, res) {
	const actor = await requireUser(req, res);
	if (!actor) return;
	const { courseId } = req.query;
	try {
		const courseProgress = await Course_Progress.findAll({
			where: { userId: actor.userId, courseId: courseId },
		});

		res.status(200).json({
			courseProgress,
		});
	} catch (e) {
		res.status(400).json({
			error_code: "progress",
			message: e.message,
		});
	}
}
