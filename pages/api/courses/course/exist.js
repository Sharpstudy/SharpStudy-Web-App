import { Enrolment } from "database/models";
import { optionalActor } from "@/lib/auth/access";

// Has the signed-in user bought this course? Visitors simply get false; a
// userId in the query is ignored so other people's purchases cannot be probed.
export default async function handler(req, res) {
	const { courseId } = req.query;
	try {
		const actor = await optionalActor(req);
		const enroll = actor && courseId ? !!(await Enrolment.findOne({ where: { userId: actor.userId, courseId } })) : false;

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
