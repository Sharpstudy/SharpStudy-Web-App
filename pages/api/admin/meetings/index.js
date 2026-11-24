import { handle } from "@/lib/meetings/http";
import { meetingDeps } from "@/lib/meetings/deps";
import { demoStats, listRequests } from "@/lib/meetings/service";
import { requireRole } from "@/lib/auth/requireRole";

// Admin only (token verified, role re-read from the database): list/search/filter requests.
export default handle(async (req, res) => {
	if (req.method !== "GET") {
		res.setHeader("Allow", "GET");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	const actor = await requireRole(req, res, ["admin"]);
	if (!actor) return;
	// ?stats=1 : counts for the Free Demo Requests overview (all derived from the database)
	if (req.query.stats === "1") return res.status(200).json(await demoStats(meetingDeps(), actor));
	res.status(200).json(await listRequests(meetingDeps(), actor, req.query));
});
