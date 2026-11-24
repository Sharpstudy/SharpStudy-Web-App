import { apiHandler, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf, deviceToken, grownupToken } from "@/lib/family/http";
import { unpairThisDevice } from "@/lib/family/service";

export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "fam-unpair", { windowMs: 60000, max: 10 })) return;
		res.status(200).json(await unpairThisDevice(familyRepo, deviceToken(req), grownupToken(req), ctxOf(req)));
	},
});
