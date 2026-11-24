import { apiHandler, getLearnerActor, repo } from "@/lib/mastery-server/http";
import { studyHome } from "@/lib/mastery/service";

export default apiHandler({
	GET: async (req, res) => {
		const actor = await getLearnerActor(req);
		res.status(200).json(await studyHome(repo, actor));
	},
});
