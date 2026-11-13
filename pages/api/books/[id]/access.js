import { bookHandler, repo, actorFor, getStorage, rateLimit } from "@/lib/books/http";
import { readAccess } from "@/lib/books/service";

// Tells the reader where to fetch the protected file. The purchase is verified HERE on every call:
// either the same-origin authenticated stream, or a signed object-storage URL that expires in ~2 minutes.
export default bookHandler({
	GET: async (req, res) => {
		const actor = await actorFor(req);
		if (!rateLimit(req, res, "books-access", { windowMs: 60000, max: 60 }, actor.userId)) return;
		res.status(200).json(await readAccess({ repo, storage: getStorage() }, actor, req.query.id));
	},
});
