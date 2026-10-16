import { apiHandler, getActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { setPlacement } from "@/lib/mastery/service";

// Adults with placement rights, or the learner themself in adult mode.
// Body: { subject, position: { levelId, setId, worksheetNo }, confirm: true }
export default apiHandler({
	POST: async (req, res) => {
		const actor = await getActor(req, { prefer: req.headers["x-learner-token"] ? "learner" : "account" });
		const { subject, position, confirm } = body(req);
		res.status(200).json(await setPlacement(repo, actor, req.query.id, subject, position, confirm === true, { ip: clientIp(req) }));
	},
});
