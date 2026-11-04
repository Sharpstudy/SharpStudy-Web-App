import { apiHandler, getAccountActor, body, rateLimit } from "@/lib/mastery-server/http";
import liveRepo from "@/lib/live-questions/repo";
import { uploadImage } from "@/lib/live-questions/service";

// Images are sent as base64 JSON (<= 1 MB of image) and kept in the database, not in a public folder.
export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "lq-image", { windowMs: 60000, max: 20 }, actor.userId)) return;
		res.status(201).json(await uploadImage(liveRepo, actor, req.query.slug, body(req).data));
	},
});
