// Advanced mathematics generators (levels J–O): completing the square, the
// quadratic formula, functions and graphs, exponentials, trigonometry,
// sequences, limits, differentiation and integration.
//
// Same contract as math.js: (rng, params) -> Problem. Every answer is exact
// (integer, fraction or polynomial expression) so grading never depends on
// floating point.

import { integerProblem, fractionProblem, expressionProblem, multiProblem, choiceProblem } from "../problem.js";
import { gcd } from "../rational.js";

const gcdN = (a, b) => Number(gcd(BigInt(Math.abs(a)), BigInt(Math.abs(b))));
const sup = (n) => (n === 1 ? "" : String(n).replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[d]));
const minus = (s) => String(s).replace(/-/g, "−");

// Polynomial from [{ c, n }] (coefficient, power) terms, highest power first.
// Returns { plain: "3x^2 - x + 4" (for grading), pretty: "3x² − x + 4" }.
function poly(terms) {
	const parts = [];
	for (const { c, n } of terms) {
		if (c === 0) continue;
		const abs = Math.abs(c);
		const body = n === 0 ? String(abs) : `${abs === 1 ? "" : abs}x${n === 1 ? "" : `^${n}`}`;
		parts.push(parts.length === 0 ? (c < 0 ? `-${body}` : body) : c < 0 ? ` - ${body}` : ` + ${body}`);
	}
	const plain = parts.join("") || "0";
	const pretty = minus(plain.replace(/\^(\d+)/g, (_, d) => sup(Number(d))));
	return { plain, pretty };
}
const polyText = (terms) => poly(terms).pretty;
const withConst = (b) => (b === 0 ? "" : b < 0 ? ` − ${-b}` : ` + ${b}`);
const fracText = (n, d) => (d === 1 ? String(n) : `${n}/${d}`);
const reduce = (n, d) => {
	const k = gcdN(n, d) || 1;
	const s = d < 0 ? -1 : 1;
	return [(s * n) / k, (s * d) / k];
};

export const mathAdvanced = {
	// ---- J: quadratics ----
	completeSquare(rng) {
		const p = rng.int(-8, 8) || 3;
		const q = rng.int(-20, 20);
		const b = 2 * p;
		const c = p * p + q;
		const expr = `x²${b === 0 ? "" : b < 0 ? ` − ${-b}x` : ` + ${b}x`}${withConst(c)}`;
		return multiProblem(
			[`Write ${expr} in the form (x + p)² + q. Find p and q.`],
			[
				{ kind: "integer", value: String(p) },
				{ kind: "integer", value: String(q) },
			],
			["p", "q"],
			{
				solution: [
					`Half of the x coefficient (${b}) is ${p}, so p = ${p}.`,
					`(x ${p < 0 ? "−" : "+"} ${Math.abs(p)})² = x² ${b < 0 ? "−" : "+"} ${Math.abs(b)}x + ${p * p}.`,
					`q = ${c} − ${p * p} = ${q}.`,
				],
			}
		);
	},

	quadraticFormula(rng) {
		if (rng.int(0, 1) === 0) {
			const a = rng.int(1, 4);
			const b = rng.int(-9, 9);
			const c = rng.int(-9, 9);
			const d = b * b - 4 * a * c;
			const eq = `${a === 1 ? "" : a}x²${b === 0 ? "" : b < 0 ? ` − ${-b === 1 ? "" : -b}x` : ` + ${b === 1 ? "" : b}x`}${withConst(c)}`;
			return integerProblem(`For ${eq} = 0, work out the discriminant b² − 4ac.`, d, {
				solution: [`a = ${a}, b = ${b}, c = ${c}.`, `b² − 4ac = ${b * b} − ${4 * a * c < 0 ? `(${4 * a * c})` : 4 * a * c} = ${d}.`],
			});
		}
		let r1, r2;
		do {
			r1 = rng.int(-6, 6);
			r2 = rng.int(-6, 6);
		} while (r1 === r2);
		const a = rng.int(1, 3);
		const b = -a * (r1 + r2);
		const c = a * r1 * r2;
		const eq = `${a === 1 ? "" : a}x²${b === 0 ? "" : b < 0 ? ` − ${-b}x` : ` + ${b}x`}${withConst(c)}`;
		const d = b * b - 4 * a * c;
		const root = Math.round(Math.sqrt(d));
		return multiProblem(
			[`Use the quadratic formula to solve ${eq} = 0.`],
			[
				{ kind: "integer", value: String(r1) },
				{ kind: "integer", value: String(r2) },
			],
			["x", "x"],
			{
				ordered: false,
				solution: [
					`x = (−b ± √(b² − 4ac)) ÷ 2a with a = ${a}, b = ${b}, c = ${c}.`,
					`b² − 4ac = ${d}, and √${d} = ${root}.`,
					`x = (${-b} + ${root}) ÷ ${2 * a} = ${(-b + root) / (2 * a)} or x = (${-b} − ${root}) ÷ ${2 * a} = ${(-b - root) / (2 * a)}.`,
				],
			}
		);
	},

	// ---- K: functions & graphs ----
	functionValue(rng) {
		const k = rng.int(-5, 6);
		if (rng.int(0, 1) === 0) {
			const a = rng.int(-6, 7) || 2;
			const b = rng.int(-9, 9);
			return integerProblem(`f(x) = ${polyText([{ c: a, n: 1 }, { c: b, n: 0 }])}. Find f(${minus(k)}).`, a * k + b, {
				solution: [`Replace x with ${minus(k)}: ${a} × ${minus(k)}${withConst(b)} = ${minus(a * k + b)}.`],
			});
		}
		const a = rng.int(1, 4);
		const b = rng.int(-5, 5);
		const c = rng.int(-9, 9);
		return integerProblem(`f(x) = ${polyText([{ c: a, n: 2 }, { c: b, n: 1 }, { c, n: 0 }])}. Find f(${minus(k)}).`, a * k * k + b * k + c, {
			solution: [`Replace x with ${minus(k)}: ${a} × ${k * k}${b === 0 ? "" : ` + (${b})(${k})`}${withConst(c)} = ${minus(a * k * k + b * k + c)}.`],
		});
	},

	composeFunctions(rng) {
		const a = rng.int(1, 5);
		const b = rng.int(-6, 6);
		const c = rng.int(1, 4);
		const d = rng.int(-6, 6);
		const k = rng.int(-3, 4);
		const inner = c * k + d;
		return integerProblem(
			`f(x) = ${polyText([{ c: a, n: 1 }, { c: b, n: 0 }])} and g(x) = ${polyText([{ c, n: 1 }, { c: d, n: 0 }])}. Find f(g(${minus(k)})).`,
			a * inner + b,
			{ solution: [`g(${minus(k)}) = ${minus(inner)}.`, `f(${minus(inner)}) = ${minus(a * inner + b)}.`] }
		);
	},

	lineGradient(rng) {
		const m = rng.int(-5, 6) || 2;
		const x1 = rng.int(-4, 4);
		const dx = rng.int(1, 4);
		const y1 = rng.int(-8, 8);
		const x2 = x1 + dx;
		const y2 = y1 + m * dx;
		return integerProblem(`A straight line passes through (${minus(x1)}, ${minus(y1)}) and (${minus(x2)}, ${minus(y2)}). What is its gradient?`, m, {
			solution: [`gradient = (y₂ − y₁) ÷ (x₂ − x₁) = ${minus(y2 - y1)} ÷ ${dx} = ${minus(m)}.`],
		});
	},

	lineIntercept(rng) {
		const m = rng.int(-5, 6) || 3;
		const c = rng.int(-9, 9);
		const x = rng.int(-4, 5);
		if (rng.int(0, 1) === 0) {
			return integerProblem(`A line has the equation y = ${polyText([{ c: m, n: 1 }, { c, n: 0 }])}. Where does it cross the y-axis? (give the y value)`, c, {
				solution: [`The line crosses the y-axis where x = 0, so y = ${minus(c)}.`],
			});
		}
		return integerProblem(`A line has the equation y = ${polyText([{ c: m, n: 1 }, { c, n: 0 }])}. Find y when x = ${minus(x)}.`, m * x + c, {
			solution: [`y = ${m} × ${minus(x)}${withConst(c)} = ${minus(m * x + c)}.`],
		});
	},

	parabolaFeatures(rng) {
		const h = rng.int(-6, 6);
		const k = rng.int(-9, 9);
		const mode = rng.int(0, 2);
		if (mode === 0) {
			return integerProblem(`The graph of y = (x ${h < 0 ? "+" : "−"} ${Math.abs(h) || 0})² ${k < 0 ? "−" : "+"} ${Math.abs(k)} has its turning point at (h, k). Find h.`, h, {
				solution: [`In y = (x − h)² + k the turning point is (h, k). Here h = ${minus(h)}.`],
			});
		}
		if (mode === 1) {
			return integerProblem(`What is the smallest value of y = (x ${h < 0 ? "+" : "−"} ${Math.abs(h) || 0})² ${k < 0 ? "−" : "+"} ${Math.abs(k)}?`, k, {
				solution: [`A squared bracket is never below 0, so the minimum is ${minus(k)}.`],
			});
		}
		const b = 2 * rng.int(-6, 6);
		const c = rng.int(-9, 9);
		return integerProblem(`The graph of y = ${polyText([{ c: 1, n: 2 }, { c: b, n: 1 }, { c, n: 0 }])} has its turning point at x = h. Find h.`, -b / 2, {
			solution: [`h = −b ÷ 2 = ${minus(-b / 2)}.`],
		});
	},

	// ---- L: exponentials, logarithms, trigonometry ----
	exponentLaw(rng) {
		const base = rng.pick([2, 3, 5, 10]);
		const m = rng.int(2, 9);
		const n = rng.int(2, 9);
		const kind = rng.int(0, 2);
		if (kind === 0) return integerProblem(`${base}${sup(m)} × ${base}${sup(n)} = ${base}^?  Find the missing power.`, m + n, { solution: [`Add the powers: ${m} + ${n} = ${m + n}.`] });
		if (kind === 1) {
			const hi = Math.max(m, n) + 1;
			return integerProblem(`${base}${sup(hi + n)} ÷ ${base}${sup(n)} = ${base}^?  Find the missing power.`, hi, { solution: [`Subtract the powers: ${hi + n} − ${n} = ${hi}.`] });
		}
		return integerProblem(`(${base}${sup(m)})${sup(n)} = ${base}^?  Find the missing power.`, m * n, { solution: [`Multiply the powers: ${m} × ${n} = ${m * n}.`] });
	},

	logarithm(rng) {
		const base = rng.pick([2, 3, 5, 10]);
		const n = rng.int(1, base === 10 ? 4 : 5);
		if (rng.int(0, 1) === 0) {
			return integerProblem(`log${subscript(base)}(${base ** n}) = ?`, n, {
				solution: [`log${subscript(base)}(${base ** n}) asks: which power of ${base} gives ${base ** n}? ${base}${sup(n)} = ${base ** n}.`],
			});
		}
		return integerProblem(`Solve ${base}^x = ${base ** n}.`, n, { solution: [`${base}${sup(n)} = ${base ** n}, so x = ${n}.`] });
	},

	exactTrig(rng) {
		const table = [
			["sin 30°", [1, 2]],
			["cos 60°", [1, 2]],
			["sin 90°", [1, 1]],
			["cos 0°", [1, 1]],
			["tan 45°", [1, 1]],
			["sin 0°", [0, 1]],
			["cos 90°", [0, 1]],
			["cos 180°", [-1, 1]],
			["sin 150°", [1, 2]],
			["cos 120°", [-1, 2]],
		];
		const [label, [n, d]] = rng.pick(table);
		return fractionProblem(`Write the exact value of ${label}.`, fracText(n, d), {
			simplest: true,
			solution: [`${label} = ${fracText(n, d)} (use the unit circle or a 30°–60°–90° triangle).`],
		});
	},

	rightTriangleRatio(rng) {
		const [a, b, c] = rng.pick([[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29]]);
		const fn = rng.pick(["sin", "cos", "tan"]);
		const opp = rng.int(0, 1) ? a : b;
		const adj = opp === a ? b : a;
		const [n, d] = fn === "sin" ? [opp, c] : fn === "cos" ? [adj, c] : [opp, adj];
		return fractionProblem(`A right triangle has opposite side ${opp}, adjacent side ${adj} and hypotenuse ${c}. Find ${fn} θ as a fraction.`, `${n}/${d}`, {
			simplest: true,
			solution: [`${fn} θ = ${fn === "sin" ? "opposite ÷ hypotenuse" : fn === "cos" ? "adjacent ÷ hypotenuse" : "opposite ÷ adjacent"} = ${n}/${d}.`],
		});
	},

	// ---- M: identities & sequences ----
	trigIdentity(rng) {
		const [s, c, h] = rng.pick([[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25]]);
		const kind = rng.int(0, 2);
		if (kind === 0) {
			return fractionProblem(`sin²θ = ${s * s}/${h * h}. Use sin²θ + cos²θ = 1 to find cos²θ.`, `${c * c}/${h * h}`, {
				simplest: true,
				solution: [`cos²θ = 1 − ${s * s}/${h * h} = ${c * c}/${h * h}.`],
			});
		}
		if (kind === 1) {
			return fractionProblem(`sin θ = ${s}/${h} and cos θ = ${c}/${h}. Find tan θ = sin θ ÷ cos θ.`, fracText(...reduce(s, c)), {
				simplest: true,
				solution: [`tan θ = (${s}/${h}) ÷ (${c}/${h}) = ${fracText(...reduce(s, c))}.`],
			});
		}
		const a = rng.pick([10, 15, 20, 25, 30, 35, 40, 50, 55, 60, 65, 70, 75, 80]);
		const correct = `sin ${90 - a}°`;
		return choiceProblem(rng, `cos ${a}° is equal to which of these?`, correct, [`sin ${a}°`, `−sin ${90 - a}°`, `cos ${90 - a}°`], {
			solution: [`cos θ = sin(90° − θ), so cos ${a}° = sin ${90 - a}°.`],
		});
	},

	sequenceTerm(rng) {
		const a = rng.int(-9, 12);
		const kind = rng.int(0, 1);
		const n = rng.int(8, 25);
		if (kind === 0) {
			const d = rng.int(2, 9) * (rng.int(0, 1) ? 1 : -1);
			const terms = [a, a + d, a + 2 * d, a + 3 * d].map(minus).join(", ");
			return integerProblem(`An arithmetic sequence begins ${terms}, … Find term number ${n}.`, a + (n - 1) * d, {
				solution: [`Common difference d = ${minus(d)}.`, `Term n = a + (n − 1)d = ${minus(a)} + ${n - 1} × ${minus(d)} = ${minus(a + (n - 1) * d)}.`],
			});
		}
		const first = rng.int(1, 5);
		const r = rng.int(2, 4);
		const m = rng.int(4, 7);
		return integerProblem(`A geometric sequence begins ${first}, ${first * r}, ${first * r * r}, … Find term number ${m}.`, first * r ** (m - 1), {
			solution: [`Common ratio r = ${r}.`, `Term n = a × r^(n−1) = ${first} × ${r}^${m - 1} = ${first * r ** (m - 1)}.`],
		});
	},

	seriesSum(rng) {
		if (rng.int(0, 1) === 0) {
			const a = rng.int(1, 10);
			const d = rng.int(1, 6);
			const n = rng.int(5, 20);
			const sum = (n * (2 * a + (n - 1) * d)) / 2;
			return integerProblem(`Find the sum of the first ${n} terms of the arithmetic series ${a} + ${a + d} + ${a + 2 * d} + …`, sum, {
				solution: [`S = n ÷ 2 × (2a + (n − 1)d) = ${n} ÷ 2 × (${2 * a} + ${(n - 1) * d}) = ${sum}.`],
			});
		}
		const a = rng.int(1, 4);
		const r = rng.int(2, 3);
		const n = rng.int(3, 7);
		const sum = (a * (r ** n - 1)) / (r - 1);
		return integerProblem(`Find the sum of the first ${n} terms of the geometric series ${a} + ${a * r} + ${a * r * r} + …`, sum, {
			solution: [`S = a(rⁿ − 1) ÷ (r − 1) = ${a} × (${r ** n} − 1) ÷ ${r - 1} = ${sum}.`],
		});
	},

	// ---- N: limits & derivatives ----
	limit(rng) {
		const kind = rng.int(0, 2);
		if (kind === 0) {
			const a = rng.int(-4, 5);
			const p = rng.int(1, 4);
			const q = rng.int(-6, 6);
			const r = rng.int(-9, 9);
			return integerProblem(`Find the limit as x → ${minus(a)} of ${polyText([{ c: p, n: 2 }, { c: q, n: 1 }, { c: r, n: 0 }])}.`, p * a * a + q * a + r, {
				solution: [`The expression is smooth, so substitute x = ${minus(a)}: ${minus(p * a * a + q * a + r)}.`],
			});
		}
		if (kind === 1) {
			const a = rng.int(-6, 7) || 3;
			return integerProblem(`Find the limit as x → ${minus(a)} of (x² − ${a * a}) ÷ (x − ${minus(a)}).`.replace(/− −/g, "+ "), 2 * a, {
				solution: [`x² − ${a * a} = (x − ${minus(a)})(x + ${minus(a)}), so the fraction simplifies to x + ${minus(a)}.`, `At x = ${minus(a)} this is ${minus(2 * a)}.`],
			});
		}
		const p = rng.int(1, 9);
		const q = rng.int(-5, 5);
		const r = rng.pick([1, 2, 3, 4, 5].filter((v) => gcdN(p, v) === 1 || v === 1));
		const s = rng.int(-5, 5);
		const [n, d] = reduce(p, r);
		return fractionProblem(`Find the limit as x → ∞ of (${polyText([{ c: p, n: 1 }, { c: q, n: 0 }])}) ÷ (${polyText([{ c: r, n: 1 }, { c: s, n: 0 }])}).`, fracText(n, d), {
			simplest: true,
			solution: [`For very large x the constants do not matter, so the ratio tends to ${p}x ÷ ${r}x = ${fracText(n, d)}.`],
		});
	},

	derivative(rng, { atPoint = false } = {}) {
		const degree = rng.int(2, 5);
		const terms = [];
		for (let n = degree; n >= 0; n--) {
			const keep = n === degree || n === 0 || rng.int(0, 1) === 1;
			terms.push({ c: keep ? rng.int(-7, 8) || n + 1 : 0, n });
		}
		const d = terms.filter((t) => t.n > 0).map((t) => ({ c: t.c * t.n, n: t.n - 1 }));
		const f = polyText(terms);
		if (atPoint) {
			const k = rng.int(-3, 4);
			const val = d.reduce((s, t) => s + t.c * k ** t.n, 0);
			return integerProblem(`f(x) = ${f}. Find f′(${minus(k)}).`, val, {
				solution: [`f′(x) = ${polyText(d)}.`, `Substitute x = ${minus(k)}: ${minus(val)}.`],
			});
		}
		const ans = poly(d);
		return expressionProblem(`Differentiate: ${f}`, ans.plain, {
			expanded: true,
			simplified: true,
			display: ans.pretty,
			solution: [`Bring the power down and reduce it by one for each term (constants vanish).`, `f′(x) = ${ans.pretty}.`],
		});
	},

	derivativeAtPoint(rng) {
		return mathAdvanced.derivative(rng, { atPoint: true });
	},

	stationaryPoint(rng) {
		const b = 2 * rng.int(-6, 6);
		const c = rng.int(-9, 9);
		const a = rng.int(1, 3);
		const A = a;
		const B = a * b;
		const x = -b / 2;
		return integerProblem(`y = ${polyText([{ c: A, n: 2 }, { c: B, n: 1 }, { c, n: 0 }])}. At what x is dy/dx = 0?`, x, {
			solution: [`dy/dx = ${polyText([{ c: 2 * A, n: 1 }, { c: B, n: 0 }])}.`, `Set it to 0: x = ${minus(x)}.`],
		});
	},

	// ---- O: integration ----
	antiderivative(rng) {
		const degree = rng.int(2, 5);
		const terms = [];
		for (let n = degree; n >= 0; n--) {
			if (n === degree || rng.int(0, 1) === 1) terms.push({ c: (rng.int(1, 5) * (rng.int(0, 1) ? 1 : -1)) * (n + 1), n });
		}
		const ans = poly(terms.map((t) => ({ c: t.c / (t.n + 1), n: t.n + 1 })));
		return expressionProblem(`Integrate: ${polyText(terms)}  (leave out "+ C")`, ans.plain, {
			expanded: true,
			simplified: true,
			display: ans.pretty,
			solution: [`Add 1 to each power and divide by the new power.`, `∫ = ${ans.pretty} + C.`],
		});
	},

	definiteIntegral(rng) {
		const n = rng.int(1, 3);
		const c = rng.int(1, 5) * (n + 1);
		const a = rng.int(0, 2);
		const b = a + rng.int(1, 3);
		const F = (x) => (c / (n + 1)) * x ** (n + 1);
		return integerProblem(`Evaluate the definite integral from ${a} to ${b} of ${polyText([{ c, n }])} dx.`, F(b) - F(a), {
			solution: [`Antiderivative: ${polyText([{ c: c / (n + 1), n: n + 1 }])}.`, `Value = F(${b}) − F(${a}) = ${F(b)} − ${F(a)} = ${F(b) - F(a)}.`],
		});
	},

	calculusApplication(rng) {
		const kind = rng.int(0, 2);
		if (kind === 0) {
			const a = rng.int(1, 4);
			const b = rng.int(-6, 6);
			const t = rng.int(1, 5);
			return integerProblem(`A particle's position is s = ${polyText([{ c: a, n: 2 }, { c: b, n: 1 }])} metres at time t seconds. Find its velocity when t = ${t}.`, 2 * a * t + b, {
				unit: "m/s",
				solution: [`v = ds/dt = ${polyText([{ c: 2 * a, n: 1 }, { c: b, n: 0 }])}.`, `At t = ${t}: v = ${2 * a * t + b} m/s.`],
			});
		}
		if (kind === 1) {
			const v = rng.int(1, 4) * 2;
			const T = rng.int(2, 5);
			return integerProblem(`A car's speed is v = ${v}t metres per second. How far does it travel in the first ${T} seconds?`, (v * T * T) / 2, {
				unit: "m",
				solution: [`Distance = ∫ ${v}t dt from 0 to ${T} = ${v / 2}t² evaluated from 0 to ${T}.`, `= ${(v * T * T) / 2} m.`],
			});
		}
		const k = rng.int(1, 3);
		const b = 3 * rng.int(1, 3);
		return integerProblem(`Find the area under y = ${k === 1 ? "" : k}x² between x = 0 and x = ${b}.`, (k * b ** 3) / 3, {
			solution: [`Area = ∫ ${k}x² dx from 0 to ${b} = ${k}x³/3 at ${b} = ${(k * b ** 3) / 3}.`],
		});
	},
};

const subscript = (n) => String(n).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[d]);

// Mixed generators used by sets that cover more than one question type.
const mix = (...names) => (rng, params) => mathAdvanced[names[rng.int(0, names.length - 1)]](rng, params);
mathAdvanced.functionNotation = mix("functionValue", "composeFunctions");
mathAdvanced.linearGraphs = mix("lineGradient", "lineIntercept");
mathAdvanced.exponentsLogs = mix("exponentLaw", "logarithm");
mathAdvanced.trigFunctions = mix("exactTrig", "rightTriangleRatio");
mathAdvanced.sequencesSeries = mix("sequenceTerm", "seriesSum");
mathAdvanced.derivatives = mix("derivative", "derivativeAtPoint", "stationaryPoint");
mathAdvanced.integrals = mix("antiderivative", "definiteIntegral");
