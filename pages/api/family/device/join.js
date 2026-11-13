import { apiHandler, body, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf } from "@/lib/family/http";
import { redeemPairing } from "@/lib/family/service";

// Public on purpose: a child's device has no account. Guessing is bounded here (per address),
// by the code's short life and single use, and by the parent's approval that must follow.
export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "fam-join", { windowMs: 60000, max: 8 })) return;
		if (!rateLimit(req, res, "fam-join-hour", { windowMs: 3600000, max: 60 })) return;
		res.status(200).json(await redeemPairing(familyRepo, body(req), ctxOf(req)));
	},
});
