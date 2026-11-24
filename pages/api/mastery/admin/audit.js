import { apiHandler, getAccountActor, repo } from "@/lib/mastery-server/http";
import { listAudit } from "@/lib/mastery/admin";

export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await listAudit(repo, actor, { action: req.query.action, learnerId: req.query.learnerId, page: req.query.page }));
	},
});
