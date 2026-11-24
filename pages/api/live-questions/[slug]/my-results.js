import { apiHandler, getAccountActor } from "@/lib/mastery-server/http";
import liveRepo from "@/lib/live-questions/repo";
import { myResults } from "@/lib/live-questions/service";

export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await myResults(liveRepo, actor, req.query.slug));
	},
});
