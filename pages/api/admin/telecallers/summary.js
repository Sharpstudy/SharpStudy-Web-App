import { handle, methodNotAllowed, requireAdminActor } from "@/lib/telecallers/http";
import { telecallerDeps } from "@/lib/telecallers/deps";
import { getSummary } from "@/lib/telecallers/service";

// Counters for the admin dashboard tiles and sidebar. Admin only.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET"])) return;
	const actor = await requireAdminActor(req, res);
	if (!actor) return;
	res.status(200).json(await getSummary(telecallerDeps(), actor));
});
