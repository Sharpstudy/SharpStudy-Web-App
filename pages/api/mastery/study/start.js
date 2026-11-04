import { apiHandler, getLearnerActor, repo, body, rateLimit } from "@/lib/mastery-server/http";
import { startWorksheet } from "@/lib/mastery/service";

// Returns the worksheet only if it is unlocked for the signed-in learner.
export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "start", { windowMs: 60 * 1000, max: 30 })) return;
		const actor = await getLearnerActor(req);
		res.status(200).json(await startWorksheet(repo, actor, body(req)));
	},
});
