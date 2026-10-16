import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { resetProgress } from "@/lib/mastery/service";

// Body: { subject?: "math" | ..., confirmText: "<learner name>" }
export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		const { subject, confirmText } = body(req);
		res.status(200).json(await resetProgress(repo, actor, req.query.id, subject || null, confirmText, { ip: clientIp(req) }));
	},
});
