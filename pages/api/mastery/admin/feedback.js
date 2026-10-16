import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { listFeedback, updateFeedback, getFeedbackScreenshot } from "@/lib/mastery/admin";

export default apiHandler({
	// ?screenshot=<id> returns that item's image as a data URL.
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		if (req.query.screenshot) {
			return res.status(200).json({ screenshot: await getFeedbackScreenshot(repo, actor, String(req.query.screenshot)) });
		}
		res.status(200).json(await listFeedback(repo, actor, { status: req.query.status, page: req.query.page }));
	},
	PATCH: async (req, res) => {
		const b = body(req);
		res.status(200).json(await updateFeedback(repo, await getAccountActor(req), String(b.id || ""), b, { ip: clientIp(req) }));
	},
});
