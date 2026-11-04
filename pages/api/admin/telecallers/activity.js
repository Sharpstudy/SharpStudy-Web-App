import { handle, body, methodNotAllowed, requireAdminActor } from "@/lib/followups/http";
import { followupDeps } from "@/lib/followups/deps";
import { listActivity, listMeetings, getMeeting, adminAssign, adminClear, FollowupError } from "@/lib/followups/service";

// Admin > Telecallers > Activity & Call History. Admin only (token verified, role re-read from the database).
//   GET ?view=feed (default) &telecaller=<user id> &meeting=<reference or id> &from=YYYY-MM-DD &to=YYYY-MM-DD &status= &type=all|calls|ownership &page= &tz=
//   GET ?view=ownership &filter= &q= &page=     follow-up ownership across all meetings
//   GET ?id=<meeting id>                        one meeting with its calls and ownership history
//   POST { id, action: "assign" | "clear", to_user_id?, reason, version }    override or clear ownership (a reason is required)
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET", "POST"])) return;
	const actor = await requireAdminActor(req, res);
	if (!actor) return;
	const deps = followupDeps();
	if (req.method === "GET") {
		if (req.query.id) return res.status(200).json(await getMeeting(deps, actor, String(req.query.id)));
		if (req.query.view === "ownership") return res.status(200).json(await listMeetings(deps, actor, req.query));
		return res.status(200).json(await listActivity(deps, actor, req.query));
	}
	const b = body(req);
	const id = String(b.id || "");
	if (b.action === "assign") return res.status(200).json(await adminAssign(deps, actor, id, b));
	if (b.action === "clear") return res.status(200).json(await adminClear(deps, actor, id, b));
	throw new FollowupError(422, "invalid_action", "Unknown action");
});
