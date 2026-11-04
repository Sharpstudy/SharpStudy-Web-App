import { Enrolment, Instructor_Earning, Course, User } from "database/models";
import Coupon from "database/models/coupon";
import { requireUser } from "@/lib/auth/access";
import { getStripe } from "@/lib/payments/stripe";
import { runCheckout, CheckoutError } from "@/lib/payments/checkout";

const repo = {
	getUser: (id) => User.findOne({ where: { id }, attributes: ["id", "first_name", "email", "profile_photo"] }).then((u) => u && u.get({ plain: true })),
	getCourse: (id) => Course.findOne({ where: { id } }).then((c) => c && c.get({ plain: true })),
	isEnrolled: async (userId, courseId) => !!(await Enrolment.findOne({ where: { userId, courseId }, attributes: ["id"] })),
	getCoupon: (code) => Coupon.findOne({ where: { code } }).then((c) => c && c.get({ plain: true })),
	createEnrolment: (row) => Enrolment.create(row),
	createEarning: (row) => Instructor_Earning.create(row),
};

export default async function handler(req, res) {
	if (req.method !== "POST") {
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	// 401 for a missing/invalid token. The buyer is always the signed-in user.
	const actor = await requireUser(req, res);
	if (!actor) return;
	try {
		const result = await runCheckout({ repo, stripe: getStripe() }, actor, req.body || {});
		res.status(result.status).json(result.body);
	} catch (e) {
		if (e instanceof CheckoutError) {
			return res.status(e.status).json({ error_code: e.code, message: e.message, ...(e.extra || {}) });
		}
		console.error(`[checkout] ${e && e.message}`);
		res.status(400).json({ error_code: "create_enroled", message: "Checkout failed. You have not been charged." });
	}
}
