import { apiHandler, getAccountActor, body, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf } from "@/lib/family/http";
import { createPairing } from "@/lib/family/service";

// Creates a short-lived single-use pairing code. The plain code is in this response only.
export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "fam-pair-create", { windowMs: 60000, max: 12 }, actor.userId)) return;
		res.status(201).json({ pairing: await createPairing(familyRepo, actor, body(req), ctxOf(req)) });
	},
});
