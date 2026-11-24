import { apiHandler, getAccountActor, rateLimit, body, clientIp } from "@/lib/mastery-server/http";
import { requireRole } from "@/lib/auth/requireRole";
import removalRepo from "@/lib/removals/repo";
import { createRequest, listMine } from "@/lib/removals/service";

// An instructor's OWN removal requests. The instructor id always comes from the verified token (never the request), and the
// server re-checks that the caller really holds an instructor link to the learner. Instructors can create and read requests;
// there is no way for them to change or withdraw a decision.
export default apiHandler({
	GET: async (req, res) => {
		if (!(await requireRole(req, res, ["instructor"]))) return;
		const actor = await getAccountActor(req);
		res.status(200).json(await listMine(removalRepo, actor));
	},
	POST: async (req, res) => {
		if (!(await requireRole(req, res, ["instructor"]))) return;
		const actor = await getAccountActor(req);
		if (!rateLimit(req, res, "removal-request", { windowMs: 60000, max: 20 }, actor.userId)) return;
		res.status(201).json(await createRequest(removalRepo, actor, body(req), { ip: clientIp(req) }));
	},
});
