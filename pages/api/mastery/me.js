import { apiHandler, getAccountActor, getLearnerActor, repo } from "@/lib/mastery-server/http";
import { publicLearner } from "@/lib/mastery/service";

// Who is calling: account permissions and/or the active learner profile.
export default apiHandler({
	GET: async (req, res) => {
		const [account, learnerActor] = await Promise.all([getAccountActor(req), getLearnerActor(req)]);
		const learner = learnerActor ? publicLearner(await repo.getLearner(learnerActor.learnerId)) : null;
		res.status(200).json({
			account: account && { userId: account.userId, role: account.role, permissions: [...account.permissions] },
			learner,
		});
	},
});
