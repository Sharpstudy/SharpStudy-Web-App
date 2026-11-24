// Exact rational arithmetic on BigInt, used for grading fractions/decimals and
// for polynomial coefficients. Never uses floating point for equality.

const babs = (a) => (a < 0n ? -a : a);
const bgcd = (a, b) => {
	a = babs(a);
	b = babs(b);
	while (b) [a, b] = [b, a % b];
	return a;
};

export class Rational {
	constructor(n, d = 1n) {
		n = BigInt(n);
		d = BigInt(d);
		if (d === 0n) throw new RangeError("Zero denominator");
		if (d < 0n) {
			n = -n;
			d = -d;
		}
		const g = bgcd(n, d) || 1n;
		this.n = n / g;
		this.d = d / g;
	}
	static from(x) {
		if (x instanceof Rational) return x;
		if (typeof x === "bigint") return new Rational(x);
		if (typeof x === "number") {
			if (Number.isInteger(x)) return new Rational(BigInt(x));
			const r = parseDecimal(String(x));
			if (!r) throw new RangeError(`Cannot convert ${x}`);
			return r;
		}
		const r = parseNumber(String(x));
		if (!r) throw new RangeError(`Cannot convert ${x}`);
		return r;
	}
	add(o) {
		o = Rational.from(o);
		return new Rational(this.n * o.d + o.n * this.d, this.d * o.d);
	}
	sub(o) {
		o = Rational.from(o);
		return new Rational(this.n * o.d - o.n * this.d, this.d * o.d);
	}
	mul(o) {
		o = Rational.from(o);
		return new Rational(this.n * o.n, this.d * o.d);
	}
	div(o) {
		o = Rational.from(o);
		if (o.n === 0n) throw new RangeError("Division by zero");
		return new Rational(this.n * o.d, this.d * o.n);
	}
	neg() {
		return new Rational(-this.n, this.d);
	}
	eq(o) {
		o = Rational.from(o);
		return this.n === o.n && this.d === o.d;
	}
	isZero() {
		return this.n === 0n;
	}
	isInteger() {
		return this.d === 1n;
	}
	toNumber() {
		return Number(this.n) / Number(this.d);
	}
	toString() {
		return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`;
	}
}

// "12", "-3", "1,200" (thousands separators allowed only in groups of 3)
const INT_RE = /^[+-]?(\d{1,3}(,\d{3})+|\d+)$/;
const DEC_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function parseInteger(s) {
	s = String(s).trim();
	if (!INT_RE.test(s)) return null;
	return new Rational(BigInt(s.replace(/,/g, "")));
}

export function parseDecimal(s) {
	s = String(s).trim();
	if (INT_RE.test(s)) return parseInteger(s);
	if (!DEC_RE.test(s)) return null;
	let sign = 1n;
	if (s[0] === "-" || s[0] === "+") {
		if (s[0] === "-") sign = -1n;
		s = s.slice(1);
	}
	const [whole, frac = ""] = s.split(".");
	const digits = (whole || "0") + frac;
	return new Rational(sign * BigInt(digits), 10n ** BigInt(frac.length));
}

// Fraction syntax: "3/4", "-3/4", "1 1/2" (mixed number), or an integer.
// Returns { value: Rational, simplest: boolean, mixed: boolean } or null.
export function parseFractionDetailed(s) {
	s = String(s).trim().replace(/\s+/g, " ");
	let m = s.match(/^([+-])?(\d+) (\d+)\s?\/\s?(\d+)$/);
	if (m) {
		const sign = m[1] === "-" ? -1n : 1n;
		const w = BigInt(m[2]);
		const n = BigInt(m[3]);
		const d = BigInt(m[4]);
		if (d === 0n || n >= d) return null; // "1 5/4" is not a proper mixed number
		const value = new Rational(sign * (w * d + n), d);
		return { value, simplest: bgcd(n, d) === 1n, mixed: true };
	}
	m = s.match(/^([+-])?(\d+)\s?\/\s?([+-]?\d+)$/);
	if (m) {
		const sign = m[1] === "-" ? -1n : 1n;
		const n = BigInt(m[2]);
		const d = BigInt(m[3]);
		if (d === 0n) return null;
		const value = new Rational(sign * n, d);
		const simplest = bgcd(n, babs(d)) === 1n && d > 0n && !(babs(d) === 1n);
		return { value, simplest, mixed: false };
	}
	const i = parseInteger(s);
	if (i) return { value: i, simplest: true, mixed: false };
	return null;
}

export function parseNumber(s) {
	const f = parseFractionDetailed(s);
	if (f) return f.value;
	return parseDecimal(s);
}

export { bgcd as gcd };
