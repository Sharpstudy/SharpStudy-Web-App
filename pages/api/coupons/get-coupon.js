import Coupon from "database/models/coupon";
import { rateLimit } from "@/lib/mastery-server/http";
import { normalizeCode, couponIsValid } from "@/lib/payments/coupons";

// Public coupon lookup used by the course page. Rate limited so codes cannot be
// guessed quickly, and it only ever returns the percentage of a usable coupon,
// never ids, dates, status or other administrative fields. Checkout validates
// the code again and computes the price itself.
export default async function handler(req, res) {
	if (req.method !== "POST") {
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	// Per client address; in-memory, so per server instance on serverless hosts.
	if (!rateLimit(req, res, "coupon-lookup", { windowMs: 10 * 60 * 1000, max: 20 })) return;

	try {
		const code = normalizeCode((req.body || {}).coupon);
		if (!code) {
			return res.status(422).json({
				message: "Invalid coupon code",
			});
		}

		const coupon = await Coupon.findOne({ where: { code } });

		if (couponIsValid(coupon)) {
			res.status(200).json({ message: "Coupon code applied", discount: { discount: Number(coupon.discount) } });
		} else {
			// Same answer for unknown, expired, disabled and not-site-wide codes.
			res.status(422).json({ message: "This coupon code is not valid" });
		}
	} catch (e) {
		res.status(400).json({
			error_code: "get_coupon",
			message: "Could not check the coupon right now",
		});
	}
}
