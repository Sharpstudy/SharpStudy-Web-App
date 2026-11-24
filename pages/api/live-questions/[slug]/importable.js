import { apiHandler, getAccountActor } from "@/lib/mastery-server/http";
import liveRepo from "@/lib/live-questions/repo";
import { importableQuestions } from "@/lib/live-questions/service";

// Existing quiz questions (single correct answer) the instructor can copy.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await importableQuestions(liveRepo, actor, req.query.slug));
	},
});
