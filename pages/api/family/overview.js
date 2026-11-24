import { apiHandler, getAccountActor } from "@/lib/mastery-server/http";
import { familyRepo } from "@/lib/family/http";
import { parentOverview } from "@/lib/family/overview";

// Read-only learning summary of the signed-in parent's linked children (and nobody else's). No body, no learner id.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await parentOverview(familyRepo, actor, {}));
	},
});
