import { handle } from "@/lib/meetings/http";
import { meetingDeps } from "@/lib/meetings/deps";
import { listRequests } from "@/lib/meetings/service";
import { requireRole } from "@/lib/auth/requireRole";

// Admin only (token verified, role re-read from the database): list/search/filter requests.
export default handle(async (req, res) => {
	if (req.method !== "GET") {
		res.setHeader("Allow", "GET");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	const actor = await requireRole(req, res, ["admin"]);
	if (!actor) return;
	res.status(200).json(await listRequests(meetingDeps(), actor, req.query));
});
