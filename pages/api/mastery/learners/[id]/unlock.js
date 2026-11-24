import { apiHandler, getAccountActor, repo, body, clientIp, rateLimit } from "@/lib/mastery-server/http";
import { unlockLearner } from "@/lib/mastery/service";

// PIN entry from the profile picker. Returns a learner session token.
export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "pin", { windowMs: 60 * 1000, max: 20 })) return;
		const actor = await getAccountActor(req);
		res.status(200).json(await unlockLearner(repo, actor, req.query.id, body(req).pin, { ip: clientIp(req) }));
	},
});
