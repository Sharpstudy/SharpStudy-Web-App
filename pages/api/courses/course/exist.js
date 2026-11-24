import { Enrolment } from "database/models";
import { requireUser } from "@/lib/auth/access";

// Has the signed-in user bought this course? A visitor without a valid login now gets 401; a
// userId in the query is ignored so other people's purchases cannot be probed.
export default async function handler(req, res) {
	const actor = await requireUser(req, res);
	if (!actor) return;
	const { courseId } = req.query;
	try {
		const enroll = courseId ? !!(await Enrolment.findOne({ where: { userId: actor.userId, courseId } })) : false;

		res.status(200).json({
			enroll,
		});
	} catch (e) {
		res.status(400).json({
			error_code: "get_course",
			message: e.message,
		});
	}
}
