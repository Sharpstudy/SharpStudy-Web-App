import { apiHandler, getAccountActor, body, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf } from "@/lib/family/http";
import { setFamilyPin } from "@/lib/family/service";

// Set or change the family PIN. Changing needs the current PIN or the account password.
export default apiHandler({
	PUT: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "fam-pin", { windowMs: 10 * 60000, max: 15 }, actor.userId)) return;
		res.status(200).json(await setFamilyPin(familyRepo, actor, body(req), ctxOf(req)));
	},
});
