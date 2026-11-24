import { bookHandler, repo, actorFor } from "@/lib/books/http";
import { bookDetail } from "@/lib/books/service";

// Book details by slug. Signed-in callers also get their own purchase status; the same URL for a
// signed-out caller never reveals ownership, reading links or files.
export default bookHandler({
	GET: async (req, res) => {
		const actor = await actorFor(req, { optional: true });
		res.status(200).json(await bookDetail(repo, actor, req.query.id));
	},
});
