// Server-side checkout. Pure with respect to storage and Stripe: both are
// passed in (see pages/api/checkout/index.js; tests use fakes, so no real
// charge is ever created in tests).
//
// The browser is trusted for nothing except WHICH courses, an optional coupon
// code and the payment token Stripe issued. Buyer, prices, discounts and
// enrolment state all come from the verified user and the database.

import { createHash } from "node:crypto";
import { couponIsValid, normalizeCode, toCents, discountedCents } from "./coupons.js";

export class CheckoutError extends Error {
	constructor(status, code, message, extra) {
		super(message);
		this.status = status;
		this.code = code;
		this.extra = extra;
	}
}
const fail = (...a) => {
	throw new CheckoutError(...a);
};

const inFlight = new Set(); // per-user guard against double submits (per server instance)

export const idempotencyKey = (userId, courseIds, totalCents, token) =>
	createHash("sha256").update(JSON.stringify([userId, [...courseIds].sort(), totalCents, token])).digest("hex");

// repo: { getUser, getCourse, isEnrolled, getCoupon, createEnrolment, createEarning }
// stripe: the Stripe client (or null when not configured)
export async function runCheckout({ repo, stripe, now = Date.now() }, actor, body) {
	if (!actor) fail(401, "unauthorized", "Sign in first");
	const items = body && body.cartItems;
	if (!Array.isArray(items) || items.length === 0 || items.length > 50) fail(422, "empty_cart", "Your cart is empty");
	if (inFlight.has(actor.userId)) fail(409, "in_progress", "Your payment is already being processed");
	inFlight.add(actor.userId);
	try {
		const user = await repo.getUser(actor.userId);
		if (!user) fail(401, "unauthorized", "Sign in first");

		const lines = [];
		const seen = new Set();
		const couponCache = new Map();
		for (const item of items) {
			const id = item && item.id;
			if (typeof id !== "string" || seen.has(id)) fail(422, "invalid_cart", "Invalid cart");
			seen.add(id);
			const course = await repo.getCourse(id);
			// Unapproved (unpublished) courses cannot be bought.
			if (!course || !course.approved) fail(404, "unavailable", "A course in your cart is no longer available");
			if (course.userId === user.id) fail(422, "own_course", "You cannot buy your own course");
			if (await repo.isEnrolled(user.id, course.id)) fail(409, "already_enrolled", `You are already enrolled in "${course.title}"`);

			let price = toCents(course.latest_price);
			const rawCode = (item && item.coupon) || (body && body.coupon);
			if (rawCode) {
				const code = normalizeCode(rawCode);
				if (!couponCache.has(code)) couponCache.set(code, code ? await repo.getCoupon(code) : null);
				const coupon = couponCache.get(code);
				if (!couponIsValid(coupon, now)) fail(422, "invalid_coupon", "That coupon code is not valid");
				price = discountedCents(course.latest_price, Number(coupon.discount));
			}
			// The price the buyer saw must be the price we computed.
			if (item.price !== undefined && toCents(item.price) !== price) {
				fail(422, "price_changed", `The price of "${course.title}" has changed. Please refresh your cart.`);
			}
			if (!(price >= 0)) fail(422, "invalid_price", "Invalid price");
			lines.push({ course, price });
		}
		const total = lines.reduce((a, l) => a + l.price, 0);

		let chargeId = null;
		if (total > 0) {
			const token = body.stripeToken;
			if (typeof token !== "string" || !/^(tok|pm|src)_[A-Za-z0-9]+$/.test(token)) {
				fail(422, "payment_required", "Payment details are required");
			}
			if (!stripe) fail(503, "payments_unavailable", "Payments are not available right now");
			let charge;
			try {
				charge = await stripe.charges.create(
					{
						amount: total,
						currency: "usd",
						source: token,
						receipt_email: user.email,
						description: `Checkout | ${user.email} | ${user.id}`,
						metadata: { userId: user.id, courseIds: lines.map((l) => l.course.id).join(",").slice(0, 480) },
					},
					{ idempotencyKey: idempotencyKey(user.id, lines.map((l) => l.course.id), total, token) }
				);
			} catch (e) {
				if (e && e.type === "StripeCardError") fail(402, "card_declined", e.message || "Your card was declined");
				fail(502, "payment_error", "We could not process the payment. You have not been charged.");
			}
			if (charge.status === "pending") {
				// Not paid yet: nothing is granted until Stripe reports success.
				return { status: 202, body: { status: "pending", message: "Your payment is still processing. Access will be granted once it succeeds." } };
			}
			if (charge.status !== "succeeded" || charge.paid !== true || charge.amount !== total || charge.currency !== "usd") {
				fail(402, "payment_failed", "The payment did not complete. You have not been enrolled.");
			}
			chargeId = charge.id;
		}

		try {
			for (const { course, price } of lines) {
				// A repeat of the same request must not enrol twice.
				if (await repo.isEnrolled(user.id, course.id)) continue;
				await repo.createEnrolment({
					bought_price: price / 100,
					payment_method: total > 0 ? "Card" : "Free",
					buyer_name: user.first_name,
					buyer_email: user.email,
					buyer_avatar: user.profile_photo,
					userId: user.id,
					courseId: course.id,
					status: "paid",
				});
				await repo.createEarning({ earnings: price / 100, userId: course.userId, courseId: course.id });
			}
		} catch (e) {
			// Paid but could not enrol: refund rather than keep the money.
			if (chargeId && stripe) await stripe.refunds.create({ charge: chargeId }).catch(() => {});
			fail(500, "enrol_failed", "We could not complete your enrolment. Any payment has been refunded.");
		}
		return { status: 200, body: { message: "Enroled successfully.", charged: total / 100 } };
	} finally {
		inFlight.delete(actor.userId);
	}
}
