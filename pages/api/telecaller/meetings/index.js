import { handle, methodNotAllowed, requireAccount } from "@/lib/followups/http";
import { followupDeps } from "@/lib/followups/deps";
import { listMeetings } from "@/lib/followups/service";

// Every ACTIVE approved telecaller sees ALL meeting requests with their follow-up state (shared visibility).
//   GET ?filter=all|unclaimed|mine|due_today|overdue|upcoming|completed &mine=1 &q= &page= &tz=
// Read only: nothing here can change a meeting request.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET"])) return;
	const actor = await requireAccount(req, res);
	if (!actor) return;
	res.status(200).json(await listMeetings(followupDeps(), actor, req.query));
});
