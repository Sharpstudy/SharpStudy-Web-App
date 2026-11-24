import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { learnerDashboard, updateLearner, removeLearner } from "@/lib/mastery/service";

export default apiHandler({
	// Parent / instructor dashboard data (all metrics from persisted data).
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await learnerDashboard(repo, actor, req.query.id));
	},
	PATCH: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json({ learner: await updateLearner(repo, actor, req.query.id, body(req), { ip: clientIp(req) }) });
	},
	// Body: { confirmText: "<learner name>" }
	DELETE: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await removeLearner(repo, actor, req.query.id, body(req).confirmText, { ip: clientIp(req) }));
	},
});
