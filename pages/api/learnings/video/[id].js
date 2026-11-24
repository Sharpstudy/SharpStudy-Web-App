import { Video, Course_Progress } from "@/database/models";
import { requireUser, courseAccess } from "@/lib/auth/access";

// One lesson for a learner. Requires being enrolled in the lesson's course (or
// owning it / being an admin). Progress is recorded for the authenticated
// user only; userId/courseId in the query string are ignored.
export default async function handler(req, res) {
	const actor = await requireUser(req, res);
	if (!actor) return;
	const { id } = req.query;
	try {
		const video = /^[0-9a-f-]{36}$/i.test(String(id)) ? await Video.findOne({ where: { id } }) : null;
		if (!video) return res.status(404).json({ message: "Lesson not found" });

		const access = await courseAccess(actor, video.courseId);
		if (!(access.owner || access.admin || access.enrolled)) {
			return res.status(403).json({ message: "You are not enrolled in this course" });
		}
		if (access.enrolled) {
			const progress = await Course_Progress.findOne({
				where: { userId: actor.userId, courseId: video.courseId, videoId: video.id },
			});
			if (!progress) {
				await Course_Progress.create({ finished: true, userId: actor.userId, courseId: video.courseId, videoId: video.id });
			}
		}

		res.status(200).json({ video });
	} catch (e) {
		res.status(400).json({
			error_code: "get_videos",
			message: e.message,
		});
	}
}
