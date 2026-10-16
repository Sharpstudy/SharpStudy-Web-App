import { Course, Enrolment, Video, Course_Progress } from "@/database/models";
import { requireRole } from "@/lib/auth/requireRole";

// Approved instructors (and admins) only; role re-read from the database. Everything is
// scoped to courses OWNED by the caller (userId comes from the verified token).
export default async function handler(req, res) {
	if (req.method !== "GET") {
		res.setHeader("Allow", "GET");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	const actor = await requireRole(req, res, ["instructor", "admin"]);
	if (!actor) return;
	res.setHeader("Cache-Control", "no-store");
	try {
		const courses = await Course.findAll({ where: { userId: actor.userId }, attributes: ["id", "title", "slug", "approved", "created_at", "updated_at"], order: [["updated_at", "DESC"]] });
		const ids = courses.map((c) => c.id);
		const published = courses.filter((c) => c.approved).length;
		let enrolments = 0;
		let recent = [];
		let videos = 0;
		let completed = 0;
		if (ids.length) {
			enrolments = await Enrolment.count({ where: { courseId: ids } });
			recent = (await Enrolment.findAll({ where: { courseId: ids }, order: [["created_at", "DESC"]], limit: 6, attributes: ["id", "buyer_name", "buyer_avatar", "courseId", "created_at"] })).map((e) => ({ id: e.id, student: e.buyer_name, avatar: e.buyer_avatar, course: (courses.find((c) => c.id === e.courseId) || {}).title || "", at: e.created_at }));
			videos = await Video.count({ where: { courseId: ids } });
			completed = await Course_Progress.count({ where: { courseId: ids, finished: true } });
		}
		res.status(200).json({
			totals: { courses: courses.length, published, drafts: courses.length - published, students: enrolments, pendingReview: courses.length - published, lessons: videos, lessonsCompleted: completed },
			recentEnrolments: recent,
			recentCourses: courses.slice(0, 5).map((c) => ({ id: c.id, title: c.title, published: !!c.approved, updatedAt: c.updated_at })),
		});
	} catch (e) {
		console.error(`[instructor-dashboard] ${e && e.message}`);
		res.status(500).json({ code: "server_error", message: "Could not load the dashboard." });
	}
}
