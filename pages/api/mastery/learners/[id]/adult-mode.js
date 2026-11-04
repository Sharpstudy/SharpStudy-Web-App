import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { setAdultMode } from "@/lib/mastery/service";

// Only an authorised adult account can switch adult (self-placement) mode.
export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json({ learner: await setAdultMode(repo, actor, req.query.id, body(req).enabled === true, { ip: clientIp(req) }) });
	},
});
