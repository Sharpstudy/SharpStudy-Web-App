import { apiHandler, getAccountActor } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf } from "@/lib/family/http";
import { getFamily } from "@/lib/family/service";

// The signed-in parent's children, their approved devices, pending device requests and PIN status.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await getFamily(familyRepo, actor, ctxOf(req)));
	},
});
