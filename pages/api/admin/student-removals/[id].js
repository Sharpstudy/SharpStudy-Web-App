import { apiHandler, getAccountActor, body, clientIp } from "@/lib/mastery-server/http";
import { requireRole } from "@/lib/auth/requireRole";
import removalRepo from "@/lib/removals/repo";
import { getOne, decide } from "@/lib/removals/service";

// Administrators only. GET = details; PATCH { action: "approve" | "reject", note } = the decision. A decision runs in one
// database transaction and can never be changed afterwards.
export default apiHandler({
	GET: async (req, res) => {
		if (!(await requireRole(req, res, ["admin"]))) return;
		const actor = await getAccountActor(req);
		res.status(200).json(await getOne(removalRepo, actor, req.query.id));
	},
	PATCH: async (req, res) => {
		if (!(await requireRole(req, res, ["admin"]))) return;
		const actor = await getAccountActor(req);
		res.status(200).json(await decide(removalRepo, actor, req.query.id, body(req), { ip: clientIp(req) }));
	},
});
