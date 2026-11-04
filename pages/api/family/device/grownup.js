import { apiHandler, body, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf, deviceToken } from "@/lib/family/http";
import { grownupAccess } from "@/lib/family/service";

// Family PIN on a child device. Wrong tries also count against a persisted lockout on the PIN itself.
export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "fam-grownup", { windowMs: 60000, max: 10 })) return;
		res.status(200).json(await grownupAccess(familyRepo, deviceToken(req), body(req), ctxOf(req)));
	},
});
