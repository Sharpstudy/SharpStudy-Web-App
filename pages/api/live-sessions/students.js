import { apiHandler, getAccountActor } from "@/lib/mastery-server/http";
import sessionRepo from "@/lib/live-sessions/repo";
import { listEligibleStudents } from "@/lib/live-sessions/service";

// Paid students of ONE course the caller owns (the picker on the scheduling form).
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await listEligibleStudents(sessionRepo, actor, req.query.courseId, { q: req.query.q }));
	},
});
