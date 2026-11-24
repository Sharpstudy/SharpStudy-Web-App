import { bookHandler, repo, actorFor } from "@/lib/books/http";
import { myOrders } from "@/lib/books/service";

// The signed-in student's own book purchase history (paid, pending, failed and refunded).
export default bookHandler({
	GET: async (req, res) => {
		const actor = await actorFor(req);
		res.status(200).json(await myOrders(repo, actor));
	},
});
