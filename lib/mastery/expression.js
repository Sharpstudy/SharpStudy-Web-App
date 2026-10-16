// Safe algebraic-expression equivalence. Parses a small grammar into a
// canonical polynomial (rational coefficients, non-negative integer powers)
// and compares canonical forms. Nothing is ever passed to eval/Function.
//
//   expr   := term (("+" | "-") term)*
//   term   := unary (("*" | "/" | implicit) unary)*
//   unary  := ("+" | "-") unary | power
//   power  := atom ("^" unary)?        exponent must be a constant integer 0..12
//   atom   := number | variable | "(" expr ")"
//
// Division is only allowed by non-zero constants. Anything else is rejected as
// "unsupported" so a learner answer is never accepted by accident.

import { Rational, parseDecimal } from "./rational.js";

const MAX_LEN = 160;
const MAX_POWER = 12;
const MAX_TERMS = 200;

export class ExpressionError extends Error {}

const SUPERSCRIPTS = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

function tokenize(input) {
	let s = String(input)
		.replace(/[−–]/g, "-")
		.replace(/[×·∙]/g, "*")
		.replace(/÷/g, "/")
		.replace(/\*\*/g, "^");
	// x² -> x^2
	s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "^" + [...m].map((c) => SUPERSCRIPTS[c]).join(""));
	if (s.length > MAX_LEN) throw new ExpressionError("Expression too long");
	const tokens = [];
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === " " || c === "\t") {
			i++;
			continue;
		}
		if (/[0-9.]/.test(c)) {
			let j = i;
			while (j < s.length && /[0-9.]/.test(s[j])) j++;
			const raw = s.slice(i, j);
			const value = parseDecimal(raw);
			if (!value) throw new ExpressionError(`Bad number "${raw}"`);
			tokens.push({ t: "num", value });
			i = j;
			continue;
		}
		if (/[a-zA-Z]/.test(c)) {
			// Each letter is its own variable: "xy" means x*y.
			tokens.push({ t: "var", name: c });
			i++;
			continue;
		}
		if ("+-*/^()".includes(c)) {
			tokens.push({ t: c });
			i++;
			continue;
		}
		throw new ExpressionError(`Unexpected character "${c}"`);
	}
	return tokens;
}

// Polynomial: Map<monomialKey, Rational>. monomialKey = "x^2*y" style, "" for constant.
const monoKey = (vars) =>
	Object.keys(vars)
		.filter((v) => vars[v] > 0)
		.sort()
		.map((v) => (vars[v] === 1 ? v : `${v}^${vars[v]}`))
		.join("*");

const keyToVars = (key) => {
	const vars = {};
	if (!key) return vars;
	for (const part of key.split("*")) {
		const [v, p] = part.split("^");
		vars[v] = p ? Number(p) : 1;
	}
	return vars;
};

const polyConst = (r) => new Map(r.isZero() ? [] : [["", r]]);
const polyVar = (name) => new Map([[name, new Rational(1)]]);

function polyAdd(a, b, sign = 1) {
	const out = new Map(a);
	for (const [k, v] of b) {
		const cur = out.get(k) || new Rational(0);
		const next = sign === 1 ? cur.add(v) : cur.sub(v);
		if (next.isZero()) out.delete(k);
		else out.set(k, next);
	}
	return out;
}

function polyMul(a, b) {
	let out = new Map();
	for (const [ka, va] of a) {
		for (const [kb, vb] of b) {
			const vars = keyToVars(ka);
			for (const [v, p] of Object.entries(keyToVars(kb))) vars[v] = (vars[v] || 0) + p;
			for (const p of Object.values(vars)) if (p > MAX_POWER * 2) throw new ExpressionError("Power too large");
			out = polyAdd(out, new Map([[monoKey(vars), va.mul(vb)]]));
		}
	}
	if (out.size > MAX_TERMS) throw new ExpressionError("Expression too large");
	return out;
}

const isConst = (p) => p.size === 0 || (p.size === 1 && p.has(""));
const constValue = (p) => p.get("") || new Rational(0);

function parse(tokens) {
	let pos = 0;
	let depth = 0;
	const peek = () => tokens[pos];
	const eat = (t) => {
		if (peek() && peek().t === t) {
			pos++;
			return true;
		}
		return false;
	};

	function expr() {
		let left = term();
		for (;;) {
			if (eat("+")) left = polyAdd(left, term());
			else if (eat("-")) left = polyAdd(left, term(), -1);
			else return left;
		}
	}
	function term() {
		let left = unary();
		for (;;) {
			const tk = peek();
			if (!tk) return left;
			if (eat("*")) left = polyMul(left, unary());
			else if (eat("/")) {
				const right = unary();
				if (!isConst(right) || constValue(right).isZero()) {
					throw new ExpressionError("Only division by a non-zero number is supported");
				}
				left = polyMul(left, polyConst(new Rational(1).div(constValue(right))));
			} else if (tk.t === "num" || tk.t === "var" || tk.t === "(") {
				left = polyMul(left, unary()); // implicit multiplication: 2x, x(x+1)
			} else return left;
		}
	}
	function unary() {
		if (eat("-")) return polyMul(polyConst(new Rational(-1)), unary());
		if (eat("+")) return unary();
		return power();
	}
	function power() {
		const base = atom();
		if (eat("^")) {
			const e = unary();
			if (!isConst(e)) throw new ExpressionError("Exponent must be a number");
			const ev = constValue(e);
			if (!ev.isInteger() || ev.n < 0n || ev.n > BigInt(MAX_POWER)) {
				throw new ExpressionError("Exponent must be a whole number from 0 to 12");
			}
			let out = polyConst(new Rational(1));
			for (let i = 0n; i < ev.n; i++) out = polyMul(out, base);
			return out;
		}
		return base;
	}
	function atom() {
		const tk = peek();
		if (!tk) throw new ExpressionError("Unexpected end of expression");
		if (tk.t === "num") {
			pos++;
			return polyConst(tk.value);
		}
		if (tk.t === "var") {
			pos++;
			return polyVar(tk.name);
		}
		if (eat("(")) {
			if (++depth > 20) throw new ExpressionError("Too deeply nested");
			const inner = expr();
			depth--;
			if (!eat(")")) throw new ExpressionError("Missing )");
			return inner;
		}
		throw new ExpressionError(`Unexpected "${tk.t}"`);
	}

	const result = expr();
	if (pos !== tokens.length) throw new ExpressionError("Unexpected input after expression");
	return result;
}

export function parsePolynomial(input) {
	const tokens = tokenize(input);
	if (tokens.length === 0) throw new ExpressionError("Empty expression");
	return parse(tokens);
}

// Canonical string, e.g. "x^2 + 3*x - 1/2".
export function canonical(poly) {
	const keys = [...poly.keys()].sort((a, b) => {
		const deg = (k) => Object.values(keyToVars(k)).reduce((s, p) => s + p, 0);
		return deg(b) - deg(a) || (a < b ? -1 : a > b ? 1 : 0);
	});
	if (keys.length === 0) return "0";
	return keys.map((k) => `${poly.get(k).toString()}${k ? "*" + k : ""}`).join(" + ");
}

// Number of additive terms written at the top level ("3x + 5x - 2x" -> 3).
// Used to insist that an answer is fully simplified, not merely equivalent.
export function countWrittenTerms(input) {
	const tokens = tokenize(input);
	let depth = 0;
	let count = tokens.length ? 1 : 0;
	tokens.forEach((tk, i) => {
		if (tk.t === "(") depth++;
		else if (tk.t === ")") depth--;
		else if ((tk.t === "+" || tk.t === "-") && depth === 0 && i > 0) {
			const prev = tokens[i - 1].t;
			if (prev === "num" || prev === "var" || prev === ")") count++;
		}
	});
	return count;
}

export function expressionsEquivalent(a, b) {
	return canonical(parsePolynomial(a)) === canonical(parsePolynomial(b));
}
