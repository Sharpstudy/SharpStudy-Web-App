import { apiHandler, getAccountActor, repo } from "@/lib/mastery-server/http";
import { adminListLearners } from "@/lib/mastery/service";

// Requires learners.manage_all.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json({ learners: await adminListLearners(repo, actor, { q: req.query.q }) });
	},
});
