import { apiHandler, getActor, repo, body, clientIp, rateLimit } from "@/lib/mastery-server/http";
import { createFeedback } from "@/lib/mastery/admin";

// Screenshots arrive as data URLs, so allow a larger body than the 1 MB default.
export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "feedback", { windowMs: 60 * 60 * 1000, max: 20 })) return;
		const actor = await getActor(req, { prefer: "account" });
		res.status(201).json(await createFeedback(repo, actor, body(req), { ip: clientIp(req) }));
	},
});
