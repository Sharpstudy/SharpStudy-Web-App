import { apiHandler, getAccountActor, body, rateLimit } from "@/lib/mastery-server/http";
import liveRepo from "@/lib/live-questions/repo";
import { submitAnswer } from "@/lib/live-questions/service";

export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "lq-answer", { windowMs: 60000, max: 30 }, actor.userId)) return;
		// The user comes from the signed token only; any userId in the body is ignored.
		const receipt = await submitAnswer(liveRepo, actor, req.query.slug, req.query.qid, body(req).optionId);
		res.status(200).json(receipt);
	},
});
