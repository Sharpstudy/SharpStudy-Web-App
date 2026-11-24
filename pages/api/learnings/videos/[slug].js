import { Video, Course } from "@/database/models";
import { requireUser, courseAccess } from "@/lib/auth/access";
import connection from "@/database/connection";
import { ciEquals } from "@/lib/db/dialect";

// Curriculum for a course. Only a signed-in account may see the lesson list (401 otherwise); the video URLs of non-preview
// lessons are still only sent to the course owner, admins and enrolled students.
export default async function handler(req, res) {
	const { slug } = req.query;
	const actor = await requireUser(req, res);
	if (!actor) return;
	try {
		const course = await Course.findOne({ where: ciEquals(connection, "slug", slug, Course) });
		const access = course && actor ? await courseAccess(actor, course.id) : {};
		const full = !!(access.owner || access.admin || access.enrolled);
		// Unpublished courses do not exist for anyone but their owner, admins and enrolled students.
		if (course && (course.approved || full)) {
			const rows = await Video.findAll({
				order: [["short_id", "ASC"]],
				where: { courseId: course.id },
			});
			const videos = rows.map((v) => {
				const o = v.get({ plain: true });
				if (!full && !o.is_preview) o.video = null;
				return o;
			});

			res.status(200).json({
				course,
				videos,
			});
		} else {
			res.status(200).json({
				videos: [],
			});
		}
	} catch (e) {
		res.status(400).json({
			error_code: "get_videos",
			message: e.message,
		});
	}
}
