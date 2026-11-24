import { apiHandler, getAccountActor } from "@/lib/mastery-server/http";
import { requireRole } from "@/lib/auth/requireRole";
import removalRepo from "@/lib/removals/repo";
import { listAll } from "@/lib/removals/service";

// Administrators only: every removal request, optionally filtered by ?status=pending|approved|rejected.
export default apiHandler({
	GET: async (req, res) => {
		if (!(await requireRole(req, res, ["admin"]))) return;
		const actor = await getAccountActor(req);
		res.status(200).json(await listAll(removalRepo, actor, { status: req.query.status }));
	},
});
