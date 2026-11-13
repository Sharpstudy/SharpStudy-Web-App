import { apiHandler, getAccountActor, body, rateLimit } from "@/lib/mastery-server/http";
import { ServiceError } from "@/lib/mastery/service";
import { familyRepo, ctxOf } from "@/lib/family/http";
import { decideDevice, revokeDevice } from "@/lib/family/service";

// { action: "approve" | "deny", name? }  or  { action: "revoke", confirm: true }
export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "fam-device", { windowMs: 60000, max: 30 }, actor.userId)) return;
		const b = body(req);
		const id = String(req.query.id);
		if (b.action === "revoke") return res.status(200).json(await revokeDevice(familyRepo, actor, id, b, ctxOf(req)));
		if (b.action === "approve" || b.action === "deny") return res.status(200).json(await decideDevice(familyRepo, actor, id, b, ctxOf(req)));
		throw new ServiceError(422, "invalid", "Unknown action");
	},
});
