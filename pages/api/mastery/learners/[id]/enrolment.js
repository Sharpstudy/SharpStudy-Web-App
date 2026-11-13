import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { setEnrolment } from "@/lib/mastery/service";

export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		const { subject, active } = body(req);
		res.status(200).json(await setEnrolment(repo, actor, req.query.id, subject, active === true, { ip: clientIp(req) }));
	},
});
