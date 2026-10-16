import { apiHandler, getActor, repo, body, rateLimit } from "@/lib/mastery-server/http";
import { touchPresence } from "@/lib/mastery/admin";

// Heartbeat from open Mastery Ladder pages (about once a minute).
export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "presence", { windowMs: 60 * 1000, max: 6 })) return;
		const actor = await getActor(req);
		res.status(200).json(await touchPresence(repo, actor, body(req).path));
	},
});
