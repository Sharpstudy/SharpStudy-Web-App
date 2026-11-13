import { handle, methodNotAllowed, requireAccount } from "@/lib/followups/http";
import { followupDeps } from "@/lib/followups/deps";
import { getDashboard } from "@/lib/followups/service";

// Telecaller dashboard: exact counts, the caller's reminders and recent call activity.
// ?tz=<IANA zone> is the viewer's time zone, used only to decide what "today" means. Access (an ACTIVE approved telecaller profile,
// or an admin) is re-checked from the database on every request.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET"])) return;
	const actor = await requireAccount(req, res);
	if (!actor) return;
	res.status(200).json(await getDashboard(followupDeps(), actor, req.query));
});
