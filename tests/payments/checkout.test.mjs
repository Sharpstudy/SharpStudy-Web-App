// Checkout and coupon rules with an in-memory repository and a FAKE Stripe.
// No network access and no real charge is possible in this file.
import test from "node:test";
import assert from "node:assert/strict";
import { runCheckout, CheckoutError, idempotencyKey } from "../../lib/payments/checkout.js";
import { couponIsValid, normalizeCode, discountedCents, toCents } from "../../lib/payments/coupons.js";

const NOW = Date.parse("2026-10-14T12:00:00Z");

function setup({ stripe, courses, coupons } = {}) {
	const db = {
		users: [
			{ id: "buyer", first_name: "Bea", email: "bea@example.com", profile_photo: null },
			{ id: "teacher", first_name: "Tom", email: "tom@example.com" },
		],
		courses: courses || [
			{ id: "c1", title: "Maths", latest_price: 25, approved: true, userId: "teacher" },
			{ id: "c2", title: "Art", latest_price: 40, approved: true, userId: "teacher" },
			{ id: "free", title: "Intro", latest_price: 0, approved: true, userId: "teacher" },
			{ id: "draft", title: "Draft", latest_price: 10, approved: false, userId: "teacher" },
			{ id: "mine", title: "Mine", latest_price: 10, approved: true, userId: "buyer" },
		],
		coupons: coupons || [
			{ code: "HALF", discount: 50, active_for_full_site: true, status: true, exp_date: null, deleted_at: null },
			{ code: "OLD", discount: 50, active_for_full_site: true, status: true, exp_date: new Date(NOW - 1000), deleted_at: null },
			{ code: "OFF", discount: 50, active_for_full_site: true, status: false, exp_date: null, deleted_at: null },
			{ code: "NOTSITE", discount: 50, active_for_full_site: false, status: true, exp_date: null, deleted_at: null },
			{ code: "GONE", discount: 50, active_for_full_site: true, status: true, exp_date: null, deleted_at: new Date(NOW - 5000) },
			{ code: "FREE", discount: 100, active_for_full_site: true, status: true, exp_date: null, deleted_at: null },
			{ code: "WEIRD", discount: 250, active_for_full_site: true, status: true, exp_date: null, deleted_at: null },
		],
		enrolments: [],
		earnings: [],
	};
	const repo = {
		getUser: async (id) => db.users.find((u) => u.id === id) || null,
		getCourse: async (id) => db.courses.find((c) => c.id === id) || null,
		isEnrolled: async (u, c) => db.enrolments.some((e) => e.userId === u && e.courseId === c),
		getCoupon: async (code) => db.coupons.find((c) => c.code === code) || null,
		createEnrolment: async (row) => db.enrolments.push(row),
		createEarning: async (row) => db.earnings.push(row),
	};
	const calls = { charges: [], refunds: [] };
	const fake =
		stripe === null
			? null
			: {
					charges: {
						create: async (params, opts) => {
							calls.charges.push({ params, opts });
							if (stripe && stripe.charge) return stripe.charge(params, opts);
							return { id: "ch_1", status: "succeeded", paid: true, amount: params.amount, currency: params.currency };
						},
					},
					refunds: { create: async (p) => (calls.refunds.push(p), { id: "re_1" }) },
			  };
	return { db, repo, calls, ctx: { repo, stripe: fake, now: NOW } };
}
const actor = { userId: "buyer", role: "student" };
const run = (s, body, who = actor) => runCheckout(s.ctx, who, { stripeToken: "tok_visa123", ...body });
const denied = (promise, status, code) => assert.rejects(promise, (e) => e instanceof CheckoutError && e.status === status && (!code || e.code === code));

test("coupon rules: only active, site-wide, unexpired, sane percentages are valid", () => {
	const ok = { discount: 20, active_for_full_site: true, status: true, exp_date: null };
	assert.equal(couponIsValid(ok, NOW), true);
	assert.equal(couponIsValid(null, NOW), false);
	assert.equal(couponIsValid({ ...ok, status: false }, NOW), false);
	assert.equal(couponIsValid({ ...ok, active_for_full_site: false }, NOW), false);
	assert.equal(couponIsValid({ ...ok, exp_date: new Date(NOW - 1) }, NOW), false);
	assert.equal(couponIsValid({ ...ok, exp_date: new Date(NOW + 1000) }, NOW), true);
	assert.equal(couponIsValid({ ...ok, deleted_at: new Date() }, NOW), false);
	for (const d of [0, -5, 101, NaN, "abc"]) assert.equal(couponIsValid({ ...ok, discount: d }, NOW), false, String(d));
});

test("coupon codes are normalised and unsafe input is rejected", () => {
	assert.equal(normalizeCode(" SAVE_10 "), "SAVE_10");
	assert.equal(normalizeCode({ coupon: "SAVE10" }), "SAVE10", "legacy object shape");
	for (const bad of ["", "   ", "a b", "x".repeat(41), "a'; DROP", { $ne: "" }, { coupon: { $ne: "" } }, 5, null, undefined, ["A"]]) assert.equal(normalizeCode(bad), null, JSON.stringify(bad));
	assert.equal(discountedCents(25, 50), 1250);
	assert.equal(discountedCents(19.99, 15), toCents(16.99));
});

test("unauthenticated, empty and malformed carts are refused before anything else", async () => {
	const s = setup();
	await denied(runCheckout(s.ctx, null, { cartItems: [{ id: "c1" }] }), 401);
	for (const cartItems of [undefined, [], "c1", [null], [{ id: 5 }], [{ id: "c1" }, { id: "c1" }]]) await denied(run(s, { cartItems }), 422);
	assert.equal(s.calls.charges.length, 0);
	assert.equal(s.db.enrolments.length, 0);
});

test("the price comes from the database: tampered prices are refused and nothing is charged", async () => {
	const s = setup();
	for (const price of [0, 0.01, 24.99, -1, "free"]) await denied(run(s, { cartItems: [{ id: "c1", price }] }), 422, "price_changed");
	assert.equal(s.calls.charges.length, 0);
	assert.equal(s.db.enrolments.length, 0);
});

test("a paid purchase charges exactly the server price, for the verified buyer only", async () => {
	const s = setup();
	const r = await run(s, { cartItems: [{ id: "c1", price: 25 }, { id: "c2", price: 40 }], userId: "teacher", buyer_email: "evil@example.com", amount: 1 });
	assert.equal(r.status, 200);
	assert.equal(s.calls.charges.length, 1);
	const { params, opts } = s.calls.charges[0];
	assert.equal(params.amount, 6500);
	assert.equal(params.source, "tok_visa123");
	assert.equal(params.receipt_email, "bea@example.com");
	assert.ok(opts.idempotencyKey);
	assert.deepEqual(s.db.enrolments.map((e) => [e.userId, e.courseId, e.buyer_email]), [["buyer", "c1", "bea@example.com"], ["buyer", "c2", "bea@example.com"]]);
	assert.deepEqual(s.db.earnings.map((e) => [e.userId, e.earnings]), [["teacher", 25], ["teacher", 40]]);
});

test("coupons are validated and applied on the server", async () => {
	const s = setup();
	await denied(run(s, { cartItems: [{ id: "c1", price: 12.5, coupon: "NOPE" }] }), 422, "invalid_coupon");
	for (const code of ["OLD", "OFF", "NOTSITE", "GONE", "WEIRD"]) await denied(run(s, { cartItems: [{ id: "c1", price: 12.5, coupon: code }] }), 422, "invalid_coupon");
	// A discounted price without a (valid) code is a tampered price
	await denied(run(s, { cartItems: [{ id: "c1", price: 12.5 }] }), 422, "price_changed");
	// A valid code with the wrong claimed price is refused too
	await denied(run(s, { cartItems: [{ id: "c1", price: 1, coupon: "HALF" }] }), 422, "price_changed");
	assert.equal(s.calls.charges.length, 0);
	const r = await run(s, { cartItems: [{ id: "c1", price: 12.5, coupon: "HALF" }] });
	assert.equal(r.status, 200);
	assert.equal(s.calls.charges[0].params.amount, 1250);
	assert.equal(s.db.enrolments[0].bought_price, 12.5);
});

test("a 100% coupon and free courses enrol without contacting Stripe", async () => {
	const s = setup({ stripe: null });
	const r1 = await runCheckout(s.ctx, actor, { cartItems: [{ id: "free", price: 0 }] });
	assert.equal(r1.status, 200);
	const r2 = await runCheckout(s.ctx, actor, { cartItems: [{ id: "c1", price: 0, coupon: "FREE" }] });
	assert.equal(r2.status, 200);
	assert.equal(s.db.enrolments.length, 2);
	assert.equal(s.db.enrolments[0].payment_method, "Free");
});

test("paid carts need a Stripe token and a configured Stripe", async () => {
	const s = setup();
	for (const stripeToken of [undefined, "", "not-a-token", 5, "tok_ bad"]) await denied(runCheckout(s.ctx, actor, { cartItems: [{ id: "c1", price: 25 }], stripeToken }), 422, "payment_required");
	const none = setup({ stripe: null });
	await denied(runCheckout(none.ctx, actor, { cartItems: [{ id: "c1", price: 25 }], stripeToken: "tok_x1" }), 503, "payments_unavailable");
	assert.equal(none.db.enrolments.length, 0);
});

test("declined cards, failed and mismatching charges never enrol", async () => {
	const cardError = Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
	let s = setup({ stripe: { charge: async () => { throw cardError; } } });
	await denied(run(s, { cartItems: [{ id: "c1", price: 25 }] }), 402, "card_declined");
	s = setup({ stripe: { charge: async () => { throw new Error("socket hang up"); } } });
	await denied(run(s, { cartItems: [{ id: "c1", price: 25 }] }), 502, "payment_error");
	for (const charge of [
		{ id: "ch", status: "failed", paid: false, amount: 2500, currency: "usd" },
		{ id: "ch", status: "succeeded", paid: false, amount: 2500, currency: "usd" },
		{ id: "ch", status: "succeeded", paid: true, amount: 1, currency: "usd" },
		{ id: "ch", status: "succeeded", paid: true, amount: 2500, currency: "eur" },
	]) {
		s = setup({ stripe: { charge: async () => charge } });
		await denied(run(s, { cartItems: [{ id: "c1", price: 25 }] }), 402, "payment_failed");
		assert.equal(s.db.enrolments.length, 0, JSON.stringify(charge));
	}
});

test("pending payments grant nothing and return 202", async () => {
	const s = setup({ stripe: { charge: async (p) => ({ id: "ch_p", status: "pending", paid: false, amount: p.amount, currency: "usd" }) } });
	const r = await run(s, { cartItems: [{ id: "c1", price: 25 }] });
	assert.equal(r.status, 202);
	assert.equal(r.body.status, "pending");
	assert.equal(s.db.enrolments.length, 0);
	assert.equal(s.db.earnings.length, 0);
});

test("duplicates: already enrolled, own course, drafts and concurrent submissions", async () => {
	const s = setup();
	await run(s, { cartItems: [{ id: "c1", price: 25 }] });
	await denied(run(s, { cartItems: [{ id: "c1", price: 25 }] }), 409, "already_enrolled");
	await denied(run(s, { cartItems: [{ id: "mine", price: 10 }] }), 422, "own_course");
	await denied(run(s, { cartItems: [{ id: "draft", price: 10 }] }), 404, "unavailable");
	await denied(run(s, { cartItems: [{ id: "ghost", price: 10 }] }), 404, "unavailable");
	assert.equal(s.db.enrolments.length, 1);
	assert.equal(s.calls.charges.length, 1);

	const slow = setup({ stripe: { charge: async (p) => (await new Promise((r) => setTimeout(r, 30)), { id: "ch_s", status: "succeeded", paid: true, amount: p.amount, currency: "usd" }) } });
	const [a, b] = await Promise.allSettled([run(slow, { cartItems: [{ id: "c2", price: 40 }] }), run(slow, { cartItems: [{ id: "c2", price: 40 }] })]);
	assert.equal([a, b].filter((x) => x.status === "fulfilled").length, 1, "second concurrent submit is refused");
	assert.equal(slow.calls.charges.length, 1);
	assert.equal(slow.db.enrolments.length, 1);
});

test("idempotency key is stable for the same purchase and different otherwise", () => {
	const k = (u, ids, t, tok) => idempotencyKey(u, ids, t, tok);
	assert.equal(k("u", ["a", "b"], 100, "tok_1"), k("u", ["b", "a"], 100, "tok_1"));
	assert.notEqual(k("u", ["a"], 100, "tok_1"), k("u", ["a"], 100, "tok_2"));
	assert.notEqual(k("u", ["a"], 100, "tok_1"), k("v", ["a"], 100, "tok_1"));
	assert.notEqual(k("u", ["a"], 100, "tok_1"), k("u", ["a"], 200, "tok_1"));
});

test("if enrolment fails after a successful charge, the charge is refunded", async () => {
	const s = setup();
	s.repo.createEnrolment = async () => {
		throw new Error("db down");
	};
	await denied(run(s, { cartItems: [{ id: "c1", price: 25 }] }), 500, "enrol_failed");
	assert.deepEqual(s.calls.refunds, [{ charge: "ch_1" }]);
});
