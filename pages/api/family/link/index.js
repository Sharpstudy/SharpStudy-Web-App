import { apiHandler, getAccountActor, body, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf } from "@/lib/family/http";
import { redeemParentLink } from "@/lib/family/links";

// A signed-in parent redeems the single-use code their child showed them on the child's own Study page. The learner comes
// from the stored code only; the body carries nothing but the code.
export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		// Guessing is bounded per account and per address.
		if (!rateLimit(req, res, "fam-link-ip", { windowMs: 60 * 60000, max: 30 })) return;
		if (actor && !rateLimit(req, res, "fam-link", { windowMs: 60 * 60000, max: 10 }, actor.userId)) return;
		res.status(200).json(await redeemParentLink(familyRepo, actor, { code: body(req).code }, ctxOf(req)));
	},
});
