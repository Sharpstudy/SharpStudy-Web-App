import { handle, body, methodNotAllowed, requireAdminActor } from "@/lib/telecallers/http";
import { telecallerDeps } from "@/lib/telecallers/deps";
import { listApplications, getApplication, reviewAction } from "@/lib/telecallers/service";

// Admin > Telecallers > Applications / Rejected Applications. Admin only (token verified, role re-read from the database).
//   GET ?view=open|rejected&status=&q=&page=  -> applications + counts per status
//   GET ?id=<application>                     -> the full review record: applicant, every attempt with its events and resume versions
//   POST { id, action, confirm, feedback, admin_notes }
//        action = save_notes | request_info | approve | reject
// This is the ONLY place an application is approved, and approval only creates an active telecaller profile.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET", "POST"])) return;
	const actor = await requireAdminActor(req, res);
	if (!actor) return;
	const deps = telecallerDeps();
	if (req.method === "GET") {
		if (req.query.id) return res.status(200).json({ application: await getApplication(deps, actor, String(req.query.id)) });
		return res.status(200).json(await listApplications(deps, actor, req.query));
	}
	const b = body(req);
	res.status(200).json(await reviewAction(deps, actor, String(b.id || ""), b));
});
