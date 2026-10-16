import { apiHandler, getAccountActor, repo } from "@/lib/mastery-server/http";
import { listPresence } from "@/lib/mastery/admin";

export default apiHandler({
	GET: async (req, res) => {
		res.status(200).json(await listPresence(repo, await getAccountActor(req)));
	},
});
