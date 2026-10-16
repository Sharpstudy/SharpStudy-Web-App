// Server-only Stripe client. The secret key comes from the environment
// (STRIPE_SECRET_KEY); without it payments are reported as not configured
// instead of falling back to anything.
import Stripe from "stripe";

let client = null;
export function getStripe() {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) return null;
	if (!client) client = Stripe(key);
	return client;
}
