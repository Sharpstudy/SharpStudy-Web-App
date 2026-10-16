import { apiHandler, getActor, repo, body, rateLimit } from "@/lib/mastery-server/http";
import { submitAttempt } from "@/lib/mastery/service";

// Records a finished worksheet (also used by the offline sync queue).
// Idempotent on clientAttemptId; the server re-grades from the start token.
export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "submit", { windowMs: 60 * 1000, max: 60 })) return;
		const actor = await getActor(req);
		const result = await submitAttempt(repo, actor, body(req));
		res.status(result.duplicate ? 200 : 201).json(result);
	},
});
