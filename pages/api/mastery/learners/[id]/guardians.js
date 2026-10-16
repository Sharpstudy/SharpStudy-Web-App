import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { addGuardian, removeGuardian } from "@/lib/mastery/service";

export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		const { email, relation } = body(req);
		res.status(200).json(await addGuardian(repo, actor, req.query.id, email, relation, { ip: clientIp(req) }));
	},
	DELETE: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await removeGuardian(repo, actor, req.query.id, body(req).userId, { ip: clientIp(req) }));
	},
});
