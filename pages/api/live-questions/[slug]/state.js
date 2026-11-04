import { apiHandler, getAccountActor, rateLimit } from "@/lib/mastery-server/http";
import liveRepo from "@/lib/live-questions/repo";
import { getState } from "@/lib/live-questions/service";

// Polled by the live-class page (every couple of seconds) and on reconnect.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "lq-state", { windowMs: 60000, max: 90 }, actor.userId)) return;
		res.status(200).json(await getState(liveRepo, actor, req.query.slug));
	},
});
