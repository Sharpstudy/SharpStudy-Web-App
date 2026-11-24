import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { resetPin } from "@/lib/mastery/service";

export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await resetPin(repo, actor, req.query.id, body(req).pin, { ip: clientIp(req) }));
	},
});
