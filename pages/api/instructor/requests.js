import { handle, body, methodNotAllowed } from "@/lib/instructor-applications/http";
import { applicationDeps } from "@/lib/instructor-applications/deps";
import { listApplications, getApplication, reviewAction } from "@/lib/instructor-applications/service";
import { requireRole } from "@/lib/auth/requireRole";

// Admin > Instructors > Requests. Admin only (token verified, role re-read from the database).
//   GET ?q=&status=&page=   -> applications + counts per status
//   GET ?id=<application>   -> the full review record (profile, evidence, history, private notes)
//   POST { id, action, confirm, feedback, admin_notes, rubric }
//        action = save_review | start_review | request_info | approve | reject | revoke | retry_email
// This is the ONLY place a user is granted instructor access.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET", "POST"])) return;
	const actor = await requireRole(req, res, ["admin"]);
	if (!actor) return;
	const deps = applicationDeps();
	if (req.method === "GET") {
		if (req.query.id) return res.status(200).json({ application: await getApplication(deps, actor, String(req.query.id)) });
		return res.status(200).json(await listApplications(deps, actor, req.query));
	}
	const b = body(req);
	res.status(200).json(await reviewAction(deps, actor, String(b.id || ""), b));
});
