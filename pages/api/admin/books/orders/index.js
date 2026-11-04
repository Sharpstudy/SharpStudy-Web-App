import { bookHandler, repo, actorFor } from "@/lib/books/http";
import { adminListOrders } from "@/lib/books/service";

// Book orders for administrators: filter by status (pending / paid / failed / refunded).
const one = (v) => (Array.isArray(v) ? v[0] : v);
export default bookHandler({
	GET: async (req, res) => {
		const actor = await actorFor(req);
		res.status(200).json(await adminListOrders(repo, actor, { status: one(req.query.status), page: one(req.query.page), bookId: one(req.query.bookId) }));
	},
});
