import { bookHandler, repo, actorFor } from "@/lib/books/http";
import { adminRefund } from "@/lib/books/service";
import { getStripe } from "@/lib/payments/stripe";

// Refund a card payment through Stripe and revoke the student's access to that book.
export default bookHandler({
	POST: async (req, res) => {
		const actor = await actorFor(req);
		res.status(200).json(await adminRefund({ repo, stripe: getStripe() }, actor, req.query.orderId));
	},
});
