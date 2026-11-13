import { apiHandler, getAccountActor } from "@/lib/mastery-server/http";
import sessionRepo from "@/lib/live-sessions/repo";
import { getAttendance } from "@/lib/live-sessions/service";

// Instructor: the roster of their own session. Student: only their own record.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await getAttendance(sessionRepo, actor, req.query.id));
	},
});
