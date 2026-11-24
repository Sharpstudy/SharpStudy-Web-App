import { bookHandler, repo, actorFor, getStorage, rateLimit } from "@/lib/books/http";
import { adminUpload } from "@/lib/books/service";

// { kind: "cover" | "file" | "preview", data: <base64> }. Size and type are validated from the bytes
// on the server (lib/books/validate.js); the storage key is generated server-side.
// 20 MB of PDF is ~27 MB of base64, so this route accepts a larger JSON body than the default.
export const config = { api: { bodyParser: { sizeLimit: "28mb" } } };

export default bookHandler({
	POST: async (req, res) => {
		const actor = await actorFor(req);
		if (!rateLimit(req, res, "books-upload", { windowMs: 60000, max: 20 }, actor.userId)) return;
		res.status(200).json(await adminUpload({ repo, storage: getStorage() }, actor, req.query.id, req.body));
	},
});
