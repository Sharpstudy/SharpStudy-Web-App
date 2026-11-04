import { apiHandler, getAccountActor, body, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf } from "@/lib/family/http";
import { setChildPicture } from "@/lib/family/service";

// A linked parent may set or clear the child's sign-in picture code. Nothing else about a learner is editable here.
export default apiHandler({
	PATCH: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "fam-child", { windowMs: 60000, max: 20 }, actor.userId)) return;
		res.status(200).json({ child: await setChildPicture(familyRepo, actor, String(req.query.id), body(req), ctxOf(req)) });
	},
});
