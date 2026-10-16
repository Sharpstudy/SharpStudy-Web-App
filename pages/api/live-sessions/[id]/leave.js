import { apiHandler, getAccountActor } from "@/lib/mastery-server/http";
import sessionRepo from "@/lib/live-sessions/repo";
import { leaveSession } from "@/lib/live-sessions/service";

export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await leaveSession(sessionRepo, actor, req.query.id));
	},
});
