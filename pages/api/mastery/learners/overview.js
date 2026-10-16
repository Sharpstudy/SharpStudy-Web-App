import { apiHandler, getAccountActor, repo } from "@/lib/mastery-server/http";
import { learnerOverview } from "@/lib/mastery/assignments";

// The caller's own learners (owned or linked) with grade, subjects and assignment status, filterable.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		const { q, grade, subject, course, status } = req.query;
		res.status(200).json(await learnerOverview(repo, actor, { q, grade, subject, course, status }));
	},
});
