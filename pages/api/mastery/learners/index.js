import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { listLearners, createLearner } from "@/lib/mastery/service";
import { can, PERMISSIONS } from "@/lib/mastery/policy";

export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		const learners = await listLearners(repo, actor);
		// Used only to hide the Add button; createLearner re-checks on the server.
		res.status(200).json({ learners, canCreate: can(actor, PERMISSIONS.LEARNERS_CREATE) });
	},
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		const learner = await createLearner(repo, actor, body(req), { ip: clientIp(req) });
		res.status(201).json({ learner });
	},
});
