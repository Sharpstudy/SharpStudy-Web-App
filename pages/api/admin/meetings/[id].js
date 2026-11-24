import { handle } from "@/lib/meetings/http";
import { meetingDeps } from "@/lib/meetings/deps";
import { getRequest, processRequest } from "@/lib/meetings/service";
import { requireRole } from "@/lib/auth/requireRole";

// Admin only. GET: details + status history. POST { action, version, ... }:
// approve | reject | reschedule | cancel | note | resend_email. The acting admin is
// always the authenticated user; no admin id is accepted from the request.
export default handle(async (req, res) => {
	if (!["GET", "POST"].includes(req.method)) {
		res.setHeader("Allow", "GET, POST");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	const actor = await requireRole(req, res, ["admin"]);
	if (!actor) return;
	const deps = meetingDeps();
	if (req.method === "GET") return res.status(200).json(await getRequest(deps, actor, req.query.id));
	const b = req.body && typeof req.body === "object" ? req.body : {};
	res.status(200).json(await processRequest(deps, actor, req.query.id, String(b.action || ""), b));
});
