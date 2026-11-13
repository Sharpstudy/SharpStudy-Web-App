import { apiHandler, getAccountActor, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf } from "@/lib/family/http";
import { getPairing, cancelPairing } from "@/lib/family/service";

export default apiHandler({
	// Polled by the parent's "Waiting for the device..." panel.
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "fam-pair-poll", { windowMs: 60000, max: 60 }, actor.userId)) return;
		res.status(200).json({ pairing: await getPairing(familyRepo, actor, String(req.query.id), ctxOf(req)) });
	},
	DELETE: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await cancelPairing(familyRepo, actor, String(req.query.id), ctxOf(req)));
	},
});
