import { apiHandler, getActor, repo, body } from "@/lib/mastery-server/http";
import { printSheets } from "@/lib/mastery/service";

// Body: { learnerId?, subject, levelId, setId, worksheetNo, copies, answerKey, prefilled }
export default apiHandler({
	POST: async (req, res) => {
		const actor = await getActor(req, { prefer: req.headers["x-learner-token"] && !req.headers.authorization ? "learner" : "account" });
		res.status(200).json(await printSheets(repo, actor, body(req)));
	},
});
