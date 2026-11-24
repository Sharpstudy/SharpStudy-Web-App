import { handle, body, methodNotAllowed, requireAdminActor } from "@/lib/telecallers/http";
import { telecallerDeps } from "@/lib/telecallers/deps";
import { listMembers, getMember, setMemberStatus } from "@/lib/telecallers/service";

// Admin > Telecallers > Approved Telecallers. Admin only.
//   GET ?status=active|inactive&q=&page=  -> approved telecallers + counts
//   GET ?id=<user id>                     -> the full profile with the application that was approved
//   POST { id, action: "activate" | "deactivate", reason }
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET", "POST"])) return;
	const actor = await requireAdminActor(req, res);
	if (!actor) return;
	const deps = telecallerDeps();
	if (req.method === "GET") {
		if (req.query.id) return res.status(200).json(await getMember(deps, actor, String(req.query.id)));
		return res.status(200).json(await listMembers(deps, actor, req.query));
	}
	const b = body(req);
	res.status(200).json(await setMemberStatus(deps, actor, String(b.id || ""), b));
});
