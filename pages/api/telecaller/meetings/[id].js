import { handle, body, methodNotAllowed, requireAccount } from "@/lib/followups/http";
import { followupDeps } from "@/lib/followups/deps";
import { getMeeting, claimMeeting, transferMeeting, recordCall, changeStatus, FollowupError } from "@/lib/followups/service";
import { rateLimit } from "@/lib/mastery-server/http";

// One meeting for the telecaller: customer details, the original request, the append-only call history and the ownership history.
//   GET                                                                   the meeting
//   POST { action: "claim", version? }                                    take an unowned follow-up
//   POST { action: "transfer", to_user_id, reason, version }              the owner (or an admin) hands it over
//   POST { action: "call", version, called_at?, answered, outcome, ... }  append one call record
//   POST { action: "status", version, status, next_follow_up_at?, note? } explicit follow-up status
// There is deliberately NO action that approves, rejects, reschedules or cancels the meeting request, or edits the enquiry:
// those stay in the admin Meeting Requests workflow.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET", "POST"])) return;
	const actor = await requireAccount(req, res);
	if (!actor) return;
	const deps = followupDeps();
	const id = String(req.query.id || "");
	if (req.method === "GET") return res.status(200).json(await getMeeting(deps, actor, id));
	if (!rateLimit(req, res, "telecaller-followup", { windowMs: 60 * 1000, max: 60 }, actor.userId)) return;
	const b = body(req);
	switch (b.action) {
		case "claim":
			return res.status(200).json(await claimMeeting(deps, actor, id, b));
		case "transfer":
			return res.status(200).json(await transferMeeting(deps, actor, id, b));
		case "call":
			return res.status(200).json(await recordCall(deps, actor, id, b));
		case "status":
			return res.status(200).json(await changeStatus(deps, actor, id, b));
		default:
			throw new FollowupError(422, "invalid_action", "Unknown action");
	}
});
