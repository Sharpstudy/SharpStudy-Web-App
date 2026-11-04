import { apiHandler, body, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf, deviceToken } from "@/lib/family/http";
import { startChildSession } from "@/lib/family/service";

// Profile tap + picture code -> the existing learner session token, bound to this device.
export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "fam-session", { windowMs: 60000, max: 12 })) return;
		res.status(200).json(await startChildSession(familyRepo, deviceToken(req), body(req), ctxOf(req)));
	},
});
