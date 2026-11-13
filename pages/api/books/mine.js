import { bookHandler, repo, actorFor } from "@/lib/books/http";
import { myBooks } from "@/lib/books/service";

// The signed-in student's own library. The account comes from the verified token; there is no
// user id or order id parameter to change.
export default bookHandler({
	GET: async (req, res) => {
		const actor = await actorFor(req);
		const one = (v) => (Array.isArray(v) ? v[0] : v);
		res.status(200).json(await myBooks(repo, actor, { q: one(req.query.q), status: one(req.query.status) || "all" }));
	},
});
