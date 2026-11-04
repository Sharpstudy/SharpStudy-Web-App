import { apiHandler, getAccountActor, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf } from "@/lib/family/http";
import { getChildLinkStatus, issueLinkCodeForChild, cancelLinkCodeForChild } from "@/lib/family/links";

// The signed-in child account's own parent link code. Nothing in the request chooses the learner: it is the one
// attached to this account.
//   GET     whether this account has a learner profile, whether a code is open, linked parents (never a code)
//   POST    generate a code and return it once
//   DELETE  withdraw the open code
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await getChildLinkStatus(familyRepo, actor, ctxOf(req)));
	},
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "fam-link-show", { windowMs: 60 * 60000, max: 10 }, actor.userId)) return;
		res.status(200).json(await issueLinkCodeForChild(familyRepo, actor, ctxOf(req)));
	},
	DELETE: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "fam-link-cancel", { windowMs: 60 * 60000, max: 30 }, actor.userId)) return;
		res.status(200).json(await cancelLinkCodeForChild(familyRepo, actor, ctxOf(req)));
	},
});
