// Mathematics generators. Each generator is (rng, params) -> Problem.
// All arithmetic is integer/rational so answers are exact.

import {
	integerProblem,
	decimalProblem,
	fractionProblem,
	expressionProblem,
	multiProblem,
	choiceProblem,
	distinct,
} from "../problem.js";
import { gcd } from "../rational.js";

const g = (a, b) => Number(gcd(BigInt(a), BigInt(b)));
const signed = (n) => (n < 0 ? `(−${-n})` : String(n));
const num = (n) => (n < 0 ? `−${-n}` : String(n));
const term = (coef, v, first = false) => {
	// formats +3x, −x, 2x for building expressions in prompts
	const abs = Math.abs(coef);
	const body = abs === 1 && v ? v : `${abs}${v}`;
	if (first) return coef < 0 ? `−${body}` : body;
	return coef < 0 ? ` − ${body}` : ` + ${body}`;
};
const constTerm = (c) => (c === 0 ? "" : c < 0 ? ` − ${-c}` : ` + ${c}`);
// Decimal string from an integer number of hundredths/thousandths, trimmed.
// Screen-reader labels list items one by one so the learner can count by
// listening, without the label announcing the total (which is the answer).
const countLabel = (noun, n, extra = "") => `${extra}${Array.from({ length: n }, () => noun).join(", ")}`;
const fracStr = (n, d) => (d === 1 ? String(n) : `${n}/${d}`);
// "x^2 - x + 6" style answer string from coefficients [x^2, x, 1].
const quadStr = (a2, a1, a0) => {
	const parts = [];
	const push = (c, v) => {
		if (c === 0) return;
		const abs = Math.abs(c);
		const body = v && abs === 1 ? v : `${abs}${v}`;
		parts.push(parts.length === 0 ? (c < 0 ? `-${body}` : body) : c < 0 ? ` - ${body}` : ` + ${body}`);
	};
	push(a2, "x^2");
	push(a1, "x");
	push(a0, "");
	return parts.join("") || "0";
};
const pretty = (s) => s.replace(/\^2/g, "²").replace(/-/g, "−");
const fromScaled = (n, places) => {
	const neg = n < 0;
	const s = String(Math.abs(n)).padStart(places + 1, "0");
	let out = `${s.slice(0, -places)}.${s.slice(-places)}`.replace(/\.?0+$/, "");
	return (neg ? "-" : "") + out;
};

export const math = {
	// ---- Counting (7A–4A) ----
	countDots(rng, { min = 1, max = 10 }) {
		const n = rng.int(min, max);
		return integerProblem("How many dots are there?", n, {
			scene: { kind: "dots", count: n, label: countLabel("dot", n, "Dots: ") },
			solution: [`Touch each dot once and count: there are ${n} dots.`],
		});
	},
	tenFrame(rng, { min = 1, max = 10 }) {
		const n = rng.int(min, max);
		return integerProblem("How many counters are in the ten-frame?", n, {
			scene: { kind: "tenframe", count: n, label: countLabel("counter", n, "Ten-frame counters: ") },
			solution: [`Full rows have 5. Count the counters: ${n}.`],
		});
	},
	countObjects(rng, { min = 1, max = 10 }) {
		const items = [
			["🍎", "apples"],
			["⭐", "stars"],
			["🐟", "fish"],
			["🌸", "flowers"],
			["🚗", "cars"],
		];
		const [emoji, name] = rng.pick(items);
		const n = rng.int(min, max);
		return integerProblem(`How many ${name} are there?`, n, {
			scene: { kind: "objects", emoji, count: n, label: countLabel(name.replace(/s$/, ""), n, `${name[0].toUpperCase() + name.slice(1)}: `) },
			solution: [`Count each one: there are ${n} ${name}.`],
		});
	},
	matchCount(rng, { min = 1, max = 10 }) {
		const n = rng.int(min, max);
		const near = [];
		for (let d = -3; d <= 3; d++) if (d !== 0 && n + d >= Math.max(0, min - 1)) near.push(n + d);
		return choiceProblem(rng, "Which number matches the dots?", n, distinct(rng, near, 3), {
			scene: { kind: "dots", count: n, label: countLabel("dot", n, "Dots: ") },
			solution: [`There are ${n} dots, so the answer is ${n}.`],
		});
	},
	nextNumber(rng, { min = 1, max = 10, step = 1, shown = 3 }) {
		const start = rng.int(min, max - step * shown);
		const seq = Array.from({ length: shown }, (_, i) => start + i * step);
		const ans = start + shown * step;
		return integerProblem([`What comes next? ${seq.join(", ")}, `, { blank: true }], ans, {
			solution: [`The numbers go up by ${step} each time, so after ${seq[seq.length - 1]} comes ${ans}.`],
		});
	},
	missingInSequence(rng, { min = 1, max = 30, step = 1, length = 5 }) {
		const start = rng.int(min, max - step * (length - 1));
		const seq = Array.from({ length }, (_, i) => start + i * step);
		const hole = rng.int(1, length - 2);
		const prompt = ["Fill in the missing number: "];
		seq.forEach((v, i) => {
			if (i) prompt.push(", ");
			prompt.push(i === hole ? { blank: true } : String(v));
		});
		return integerProblem(prompt, seq[hole], {
			solution: [`The numbers count up by ${step}. ${seq[hole - 1]} + ${step} = ${seq[hole]}.`],
		});
	},
	numberAfter(rng, { min = 1, max = 50 }) {
		const n = rng.int(min, max - 1);
		return integerProblem(`What number comes just after ${n}?`, n + 1, {
			solution: [`Count on one from ${n}: ${n + 1}.`],
		});
	},
	numberBefore(rng, { min = 2, max = 50 }) {
		const n = rng.int(min, max);
		return integerProblem(`What number comes just before ${n}?`, n - 1, {
			solution: [`Count back one from ${n}: ${n - 1}.`],
		});
	},
	biggerNumber(rng, { min = 1, max = 50 }) {
		const a = rng.int(min, max);
		let b = rng.int(min, max);
		while (b === a) b = rng.int(min, max);
		const big = Math.max(a, b);
		return choiceProblem(rng, `Which number is bigger: ${a} or ${b}?`, big, [Math.min(a, b)], {
			keepOrder: false,
			solution: [`${big} comes later when counting, so ${big} is bigger.`],
		});
	},
	skipCount(rng, { step = 10, max = 120 }) {
		const k = rng.int(1, Math.floor(max / step) - 3);
		const seq = [k, k + 1, k + 2].map((x) => x * step);
		return integerProblem([`Count by ${step}s: ${seq.join(", ")}, `, { blank: true }], (k + 3) * step, {
			solution: [`Add ${step} each time: ${seq[2]} + ${step} = ${(k + 3) * step}.`],
		});
	},

	// ---- Addition & subtraction (3A–B) ----
	add(rng, { a = [1, 10], b = [1, 3] }) {
		const x = rng.int(a[0], a[1]);
		const y = rng.int(b[0], b[1]);
		return integerProblem([`${x} + ${y} = `, { blank: true }], x + y, {
			solution: [`Start at ${x} and count on ${y}: ${x + y}.`],
		});
	},
	sub(rng, { a = [2, 20], b = [1, 3] }) {
		const y = rng.int(b[0], b[1]);
		const x = rng.int(Math.max(a[0], y), a[1]);
		return integerProblem([`${x} − ${y} = `, { blank: true }], x - y, {
			solution: [`Start at ${x} and count back ${y}: ${x - y}.`],
		});
	},
	addSub(rng, { max = 20 }) {
		if (rng.int(0, 1)) {
			const x = rng.int(1, max - 1);
			const y = rng.int(1, max - x);
			return integerProblem([`${x} + ${y} = `, { blank: true }], x + y, { solution: [`${x} + ${y} = ${x + y}.`] });
		}
		const x = rng.int(2, max);
		const y = rng.int(1, x - 1);
		return integerProblem([`${x} − ${y} = `, { blank: true }], x - y, { solution: [`${x} − ${y} = ${x - y}.`] });
	},
	missingAddend(rng, { max = 20 }) {
		const total = rng.int(3, max);
		const x = rng.int(1, total - 1);
		return integerProblem([`${x} + `, { blank: true }, ` = ${total}`], total - x, {
			solution: [`What do we add to ${x} to make ${total}? ${total} − ${x} = ${total - x}.`],
		});
	},
	addVertical(rng, { digitsA = 2, digitsB = 2, carry = true }) {
		const lo = (d) => (d === 1 ? 1 : 10 ** (d - 1));
		const hi = (d) => 10 ** d - 1;
		let x, y;
		for (let i = 0; i < 50; i++) {
			x = rng.int(lo(digitsA), hi(digitsA));
			y = rng.int(lo(digitsB), hi(digitsB));
			const hasCarry = (x % 10) + (y % 10) >= 10;
			if (hasCarry === carry) break;
		}
		return integerProblem(`${x} + ${y}`, x + y, {
			layout: { kind: "vertical", top: x, bottom: y, op: "+" },
			solution: [`Add the ones, then the tens, carrying when a column makes 10 or more: ${x} + ${y} = ${x + y}.`],
		});
	},
	subVertical(rng, { digitsA = 2, digitsB = 2, borrow = true }) {
		const lo = (d) => (d === 1 ? 1 : 10 ** (d - 1));
		const hi = (d) => 10 ** d - 1;
		let x, y;
		for (let i = 0; i < 80; i++) {
			x = rng.int(lo(digitsA), hi(digitsA));
			const upper = Math.min(hi(digitsB), x - 1);
			if (upper < lo(digitsB)) continue;
			y = rng.int(lo(digitsB), upper);
			const needsBorrow = x % 10 < y % 10;
			if (needsBorrow === borrow) break;
		}
		return integerProblem(`${x} − ${y}`, x - y, {
			layout: { kind: "vertical", top: x, bottom: y, op: "−" },
			solution: [`Subtract the ones, then the tens, borrowing when the top digit is smaller: ${x} − ${y} = ${x - y}.`],
		});
	},

	// ---- Multiplication & division (C–D) ----
	times(rng, { tables = [2, 3, 4, 5], max = 10 }) {
		const t = rng.pick(tables);
		const n = rng.int(1, max);
		return integerProblem([`${t} × ${n} = `, { blank: true }], t * n, {
			solution: [`${n} groups of ${t}: ${t} × ${n} = ${t * n}.`],
		});
	},
	multiply(rng, { a = [10, 99], b = [2, 9] }) {
		const x = rng.int(a[0], a[1]);
		const y = rng.int(b[0], b[1]);
		return integerProblem(`${x} × ${y}`, x * y, {
			layout: { kind: "vertical", top: x, bottom: y, op: "×" },
			solution: [`Multiply each digit of ${x} by ${y} and add the parts: ${x * y}.`],
		});
	},
	divideExact(rng, { divisors = [2, 3, 4, 5, 6, 7, 8, 9], quotient = [1, 10] }) {
		const d = rng.pick(divisors);
		const q = rng.int(quotient[0], quotient[1]);
		return integerProblem([`${d * q} ÷ ${d} = `, { blank: true }], q, {
			solution: [`Which number times ${d} makes ${d * q}? ${d} × ${q} = ${d * q}, so the answer is ${q}.`],
		});
	},
	divideRemainder(rng, { divisors = [2, 3, 4, 5, 6, 7, 8, 9], quotient = [2, 12] }) {
		const d = rng.pick(divisors);
		const q = rng.int(quotient[0], quotient[1]);
		const r = rng.int(1, d - 1);
		const n = d * q + r;
		return multiProblem(
			[`${n} ÷ ${d} = `, { blank: true }, " R ", { blank: true }],
			[
				{ kind: "integer", value: String(q) },
				{ kind: "integer", value: String(r) },
			],
			["quotient", "remainder"],
			{ solution: [`${d} × ${q} = ${d * q}, and ${n} − ${d * q} = ${r}, so ${n} ÷ ${d} = ${q} R ${r}.`] }
		);
	},
	reduceFraction(rng, { maxDen = 12, maxFactor = 6 }) {
		let n, d;
		do {
			d = rng.int(2, maxDen);
			n = rng.int(1, d - 1);
		} while (g(n, d) !== 1);
		const k = rng.int(2, maxFactor);
		return fractionProblem(["Simplify ", { frac: [n * k, d * k] }], `${n}/${d}`, {
			simplest: true,
			solution: [`Divide top and bottom by ${k}: ${n * k}/${d * k} = ${n}/${d}.`],
		});
	},
	equivalentFraction(rng, { maxDen = 10, maxFactor = 6 }) {
		const d = rng.int(2, maxDen);
		const n = rng.int(1, d - 1);
		const k = rng.int(2, maxFactor);
		return integerProblem([{ frac: [n, d] }, " = ", { frac: ["?", d * k] }, "  What is the missing number?"], n * k, {
			solution: [`${d} × ${k} = ${d * k}, so multiply the top by ${k} too: ${n} × ${k} = ${n * k}.`],
		});
	},

	// ---- Fractions & decimals (E–F) ----
	fractionAddSame(rng, { maxDen = 12 }) {
		const d = rng.int(3, maxDen);
		const a = rng.int(1, d - 1);
		const b = rng.int(1, d - 1);
		const s = a + b;
		const k = g(s, d);
		return fractionProblem([{ frac: [a, d] }, " + ", { frac: [b, d] }, " = "], fracStr(s / k, d / k), {
			simplest: true,
			solution: [`Same denominators: add the tops. ${a} + ${b} = ${s}, so ${s}/${d}${k > 1 ? ` = ${fracStr(s / k, d / k)}` : ""}.`],
		});
	},
	fractionAdd(rng, { dens = [2, 3, 4, 5, 6, 8, 10, 12], subtract = false }) {
		let d1, d2;
		do {
			d1 = rng.pick(dens);
			d2 = rng.pick(dens);
		} while (d1 === d2);
		const a = rng.int(1, d1 - 1);
		const b = rng.int(1, d2 - 1);
		let num = a * d2 + (subtract ? -b * d1 : b * d1);
		const den = d1 * d2;
		if (subtract && num <= 0) {
			// keep answers positive: swap the order
			return math.fractionAdd(rng, { dens, subtract });
		}
		const k = g(Math.abs(num), den);
		const lcd = (d1 * d2) / g(d1, d2);
		return fractionProblem(
			[{ frac: [a, d1] }, subtract ? " − " : " + ", { frac: [b, d2] }, " = "],
			fracStr(num / k, den / k),
			{
				simplest: true,
				solution: [
					`Use a common denominator of ${lcd}: ${(a * lcd) / d1}/${lcd} ${subtract ? "−" : "+"} ${(b * lcd) / d2}/${lcd}.`,
					`That gives ${fracStr(num / k, den / k)} in lowest terms.`,
				],
			}
		);
	},
	fractionMultiply(rng, { maxDen = 9 }) {
		const d1 = rng.int(2, maxDen);
		const d2 = rng.int(2, maxDen);
		const a = rng.int(1, d1 - 1);
		const b = rng.int(1, d2 - 1);
		const k = g(a * b, d1 * d2);
		return fractionProblem([{ frac: [a, d1] }, " × ", { frac: [b, d2] }, " = "], fracStr((a * b) / k, (d1 * d2) / k), {
			simplest: true,
			solution: [`Multiply tops and bottoms: ${a * b}/${d1 * d2}, then simplify to ${fracStr((a * b) / k, (d1 * d2) / k)}.`],
		});
	},
	decimalAddSub(rng, { places = 1, max = 100 }) {
		const scale = 10 ** places;
		const x = rng.int(1, max * scale);
		const y = rng.int(1, max * scale);
		const sub = rng.int(0, 1) === 1;
		const [a, b] = sub ? [Math.max(x, y), Math.min(x, y)] : [x, y];
		const res = sub ? a - b : a + b;
		const A = fromScaled(a, places);
		const B = fromScaled(b, places);
		return decimalProblem([`${A} ${sub ? "−" : "+"} ${B} = `, { blank: true }], fromScaled(res, places) || "0", {
			solution: [`Line up the decimal points and ${sub ? "subtract" : "add"}: ${fromScaled(res, places) || "0"}.`],
		});
	},
	decimalTimesInt(rng, { places = 1 }) {
		const scale = 10 ** places;
		const x = rng.int(1, 9 * scale);
		const n = rng.int(2, 9);
		const A = fromScaled(x, places);
		return decimalProblem([`${A} × ${n} = `, { blank: true }], fromScaled(x * n, places), {
			solution: [`Multiply as whole numbers (${x} × ${n} = ${x * n}) then put back ${places} decimal place${places > 1 ? "s" : ""}.`],
		});
	},
	orderOfOperations(rng) {
		const a = rng.int(2, 12);
		const b = rng.int(2, 9);
		const c = rng.int(2, 9);
		const forms = [
			[`${a} + ${b} × ${c}`, a + b * c, `Multiply first: ${b} × ${c} = ${b * c}, then add ${a}.`],
			[`(${a} + ${b}) × ${c}`, (a + b) * c, `Brackets first: ${a} + ${b} = ${a + b}, then × ${c}.`],
			[`${a * c} ÷ ${c} + ${b}`, a + b, `Divide first: ${a * c} ÷ ${c} = ${a}, then add ${b}.`],
			[`${b} × ${c} − ${a}`, b * c - a, `Multiply first: ${b} × ${c} = ${b * c}, then subtract ${a}.`],
		];
		const [expr, val, step] = rng.pick(forms);
		return integerProblem([`${expr} = `, { blank: true }], val, { solution: [step, `Answer: ${val}.`] });
	},

	// ---- Algebra (G–J) ----
	integerAddSub(rng, { max = 20 }) {
		const a = rng.int(-max, max);
		let b = rng.int(-max, max);
		if (b === 0) b = -3;
		const sub = rng.int(0, 1) === 1;
		const res = sub ? a - b : a + b;
		return integerProblem([`${a < 0 ? "−" + -a : a} ${sub ? "−" : "+"} ${signed(b)} = `, { blank: true }], res, {
			solution: [sub ? `Subtracting ${signed(b)} is the same as adding ${-b}.` : `Adding ${signed(b)} moves ${b < 0 ? "down" : "up"} the number line.`, `Answer: ${res}.`],
		});
	},
	integerMultiply(rng, { max = 12 }) {
		let a = rng.int(-max, max);
		let b = rng.int(-max, max);
		if (a === 0) a = -2;
		if (b === 0) b = 3;
		return integerProblem([`${signed(a)} × ${signed(b)} = `, { blank: true }], a * b, {
			solution: [`${(a < 0) === (b < 0) ? "Same signs give a positive" : "Different signs give a negative"}: ${a * b}.`],
		});
	},
	likeTerms(rng, { vars = ["x", "y", "a", "n"] }) {
		const v = rng.pick(vars);
		const a = rng.int(2, 9);
		const b = rng.int(2, 9);
		const c = rng.int(1, 9);
		const total = a + b - c;
		if (total === 0) return math.likeTerms(rng, { vars });
		const ans = total === 1 ? v : total === -1 ? `-${v}` : `${total}${v}`;
		return expressionProblem(`Simplify: ${a}${v} + ${b}${v} − ${c === 1 ? "" : c}${v}`, ans, {
			expanded: true,
			simplified: true,
			display: pretty(ans),
			solution: [`Add the numbers in front of ${v}: ${a} + ${b} − ${c} = ${total}.`, `Answer: ${ans}.`],
		});
	},
	evaluate(rng) {
		const a = rng.int(2, 9);
		const b = rng.int(-9, 9);
		const x = rng.int(-5, 9);
		return integerProblem(`Find the value of ${a}x${constTerm(b)} when x = ${num(x)}.`, a * x + b, {
			solution: [`Replace x with ${x}: ${a} × ${signed(x)}${constTerm(b)} = ${a * x + b}.`],
		});
	},
	solveLinear(rng, { twoSided = false }) {
		const x = rng.int(-9, 12);
		const a = rng.int(2, 9);
		const b = rng.int(-15, 15);
		if (!twoSided) {
			const c = a * x + b;
			return integerProblem(`Solve for x:  ${a}x${constTerm(b)} = ${num(c)}`, x, {
				solution: [`${b >= 0 ? "Subtract" : "Add"} ${Math.abs(b)} on both sides: ${a}x = ${c - b}.`, `Divide by ${a}: x = ${x}.`],
			});
		}
		let c = rng.int(1, 8);
		if (c === a) c = a + 1;
		const d = a * x + b - c * x;
		return integerProblem(`Solve for x:  ${a}x${constTerm(b)} = ${c}x${constTerm(d)}`, x, {
			solution: [`Collect x terms: ${a - c}x = ${d - b}.`, `Divide by ${a - c}: x = ${x}.`],
		});
	},
	simultaneous(rng) {
		const x = rng.int(-6, 10);
		const y = rng.int(-6, 10);
		const a = rng.int(1, 4);
		const b = rng.int(1, 4);
		const s1 = a * x + y;
		const s2 = x - b * y;
		return multiProblem(
			[`Solve: ${a === 1 ? "" : a}x + y = ${num(s1)}  and  x − ${b === 1 ? "" : b}y = ${num(s2)}`],
			[
				{ kind: "integer", value: String(x) },
				{ kind: "integer", value: String(y) },
			],
			["x", "y"],
			{ solution: [`From the second equation x = ${s2} + ${b}y. Substitute into the first and solve: y = ${y}, then x = ${x}.`] }
		);
	},
	expandBracket(rng) {
		const k = rng.int(2, 9) * (rng.int(0, 3) === 0 ? -1 : 1);
		const a = rng.int(1, 9);
		const b = rng.int(-9, 9) || 4;
		const ans = quadStr(0, k * a, k * b);
		return expressionProblem(`Expand: ${k < 0 ? "−" + -k : k}(${a === 1 ? "" : a}x${constTerm(b)})`, ans, {
			expanded: true,
			simplified: true,
			display: pretty(ans),
			solution: [`Multiply each term inside the bracket by ${k}.`, `Answer: ${ans}.`],
		});
	},
	expandBinomials(rng) {
		const p = rng.int(-9, 9) || 2;
		const q = rng.int(-9, 9) || -3;
		const B = p + q;
		const C = p * q;
		const ans = quadStr(1, B, C);
		return expressionProblem(`Expand: (x${constTerm(p)})(x${constTerm(q)})`, ans, {
			expanded: true,
			simplified: true,
			display: pretty(ans),
			solution: [`x·x = x², outer + inner = ${B}x, last terms ${p} × ${q} = ${C}.`, `Answer: ${pretty(ans)}.`],
		});
	},
	squareRoot(rng, { max = 20 }) {
		const n = rng.int(2, max);
		return integerProblem(["√", `${n * n} = `, { blank: true }], n, {
			solution: [`${n} × ${n} = ${n * n}, so √${n * n} = ${n}.`],
		});
	},
	pythagoras(rng) {
		const [a, b, c] = rng.pick([
			[3, 4, 5],
			[5, 12, 13],
			[8, 15, 17],
			[7, 24, 25],
		]);
		const k = rng.int(1, 3);
		return integerProblem(`A right triangle has shorter sides ${a * k} and ${b * k}. How long is the longest side?`, c * k, {
			solution: [`c² = ${a * k}² + ${b * k}² = ${(c * k) ** 2}.`, `c = √${(c * k) ** 2} = ${c * k}.`],
		});
	},
	quadraticRoots(rng) {
		let r1, r2;
		do {
			r1 = rng.int(-9, 9);
			r2 = rng.int(-9, 9);
		} while (r1 === r2);
		const B = -(r1 + r2);
		const C = r1 * r2;
		const eq = `x²${B === 0 ? "" : term(B, "x")}${constTerm(C)} = 0`;
		return multiProblem(
			[`Solve: ${eq}`],
			[
				{ kind: "integer", value: String(r1) },
				{ kind: "integer", value: String(r2) },
			],
			["x", "x"],
			{
				ordered: false,
				solution: [`Factorise: (x${constTerm(-r1)})(x${constTerm(-r2)}) = 0.`, `So x = ${r1} or x = ${r2}.`],
			}
		);
	},
};
