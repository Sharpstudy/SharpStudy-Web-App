// Coupon rules, shared by the coupon lookup and checkout. Pure.
// Coupons in this project are site-wide percentage discounts
// (Coupon.active_for_full_site); there is no per-course coupon field.

export const COUPON_CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;

// Accepts a string or the legacy { coupon: "CODE" } shape; returns a clean code or null.
export function normalizeCode(input) {
	const raw = input && typeof input === "object" ? input.coupon : input;
	if (typeof raw !== "string") return null;
	const code = raw.trim();
	return COUPON_CODE_RE.test(code) ? code : null;
}

// A coupon row is usable when it is active, site-wide, not deleted/expired and has a sane percentage.
export function couponIsValid(c, now = Date.now()) {
	if (!c) return false;
	if (c.deleted_at) return false;
	if (c.status === false) return false;
	if (!c.active_for_full_site) return false;
	if (c.exp_date && new Date(c.exp_date).getTime() <= now) return false;
	const d = Number(c.discount);
	return Number.isFinite(d) && d > 0 && d <= 100;
}

export const toCents = (n) => Math.round(Number(n) * 100);

// Price in cents after a percentage discount (same arithmetic as the storefront).
export const discountedCents = (listPrice, percent) => {
	const before = parseFloat(Number(listPrice).toFixed(2));
	const amount = parseFloat(((before * percent) / 100).toFixed(2));
	return toCents(parseFloat((before - amount).toFixed(2)));
};
