import Video from "database/models/video";
import { requireUser, requireCourseManager, TEACHER_ROLES } from "@/lib/auth/access";

export default async function handler(req, res) {
	if (req.method !== "POST") {
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	const actor = await requireUser(req, res, TEACHER_ROLES);
	if (!actor) return;
	await handlePost(req, res, actor);
}

const handlePost = async (req, res, actor) => {
	const {
		group_name,
		title,
		thumb,
		video,
		video_length,
		is_preview,
		short_id,
		courseId,
	} = req.body;
	try {
		// The course must belong to the caller (or the caller is an admin).
		if (!(await requireCourseManager(res, actor, courseId))) return;

		await Video.create({
			group_name,
			title,
			thumb,
			video,
			video_length,
			is_preview,
			short_id,
			courseId,
			userId: actor.userId,
		});

		res.status(200).json({ message: "Video Uploaded Successfully." });
	} catch (e) {
		res.status(400).json({
			error_code: "upload_video",
			message: e.message,
		});
	}
};
