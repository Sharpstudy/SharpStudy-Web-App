import { apiHandler, getAccountActor, body } from "@/lib/mastery-server/http";
import liveRepo from "@/lib/live-questions/repo";
import { createQuestion, listResults } from "@/lib/live-questions/service";

export default apiHandler({
	// Saved results for after-class review (instructor / admin only).
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await listResults(liveRepo, actor, req.query.slug));
	},
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		const question = await createQuestion(liveRepo, actor, req.query.slug, body(req));
		res.status(201).json({ question });
	},
});
