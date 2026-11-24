import { handle, methodNotAllowed, requireAccount } from "@/lib/followups/http";
import { followupDeps } from "@/lib/followups/deps";
import { listTelecallerOptions } from "@/lib/followups/service";

// The telecallers a follow-up can be handed to (id, name, active/inactive only). Access is re-checked from the database.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET"])) return;
	const actor = await requireAccount(req, res);
	if (!actor) return;
	res.status(200).json({ telecallers: await listTelecallerOptions(followupDeps(), actor) });
});
