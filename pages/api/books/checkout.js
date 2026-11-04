import { bookHandler, repo, actorFor, rateLimit } from "@/lib/books/http";
import { runBookCheckout } from "@/lib/books/service";
import { getStripe } from "@/lib/payments/stripe";

// Buy one book. The buyer is the signed-in account; the price comes from the book row. The body
// carries only which book and Stripe's payment token - any price or "paid" flag in it is ignored.
export default bookHandler({
	POST: async (req, res) => {
		const actor = await actorFor(req);
		if (!rateLimit(req, res, "books-checkout", { windowMs: 60000, max: 20 }, actor.userId)) return;
		const b = req.body && typeof req.body === "object" ? req.body : {};
		const result = await runBookCheckout({ repo, stripe: getStripe() }, actor, { bookId: b.bookId, slug: b.slug, stripeToken: b.stripeToken, priceCents: b.priceCents });
		res.status(result.status).json(result.body);
	},
});
