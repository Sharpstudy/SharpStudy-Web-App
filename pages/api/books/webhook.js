import { repo } from "@/lib/books/http";
import { handleStripeEvent } from "@/lib/books/service";
import { getStripe } from "@/lib/payments/stripe";

// Stripe webhook for book payments (charge.succeeded / charge.failed / charge.refunded).
// The signature is verified against the RAW body with STRIPE_WEBHOOK_SECRET before anything is read
// from the event. Replays are harmless: settling an order is idempotent.
export const config = { api: { bodyParser: false } };

const readRaw = (req) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (c) => {
			size += c.length;
			if (size > 1024 * 1024) {
				reject(new Error("payload too large"));
				req.destroy();
			} else chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});

export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.setHeader("Allow", "POST");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	const stripe = getStripe();
	const secret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!stripe || !secret) return res.status(503).json({ message: "Webhooks are not configured" });
	let event;
	try {
		const raw = await readRaw(req);
		event = stripe.webhooks.constructEvent(raw, req.headers["stripe-signature"], secret);
	} catch (e) {
		return res.status(400).json({ message: "Invalid signature" });
	}
	try {
		const r = await handleStripeEvent({ repo, stripe }, event);
		res.status(200).json({ received: true, handled: !!r.handled });
	} catch (e) {
		console.error(`[books-webhook] ${event.type}: ${e && e.message}`);
		// 500 makes Stripe retry later; handling is idempotent.
		res.status(500).json({ message: "Could not process the event" });
	}
}
