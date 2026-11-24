// Physics and Chemistry generators. Numbers are chosen so answers are exact
// (integers or short terminating decimals). Element data is curated.

import { integerProblem, decimalProblem, textProblem, choiceProblem, multiProblem } from "../problem.js";

// Trim a decimal string computed from integer scaling.
const dec = (num, scale) => {
	const s = (num / scale).toFixed(String(scale).length - 1);
	return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

const ELEMENTS = [
	// [symbol, name, atomic number, common mass number, group (1-8, 0 = transition), metal]
	["H", "hydrogen", 1, 1, 1, false],
	["He", "helium", 2, 4, 8, false],
	["Li", "lithium", 3, 7, 1, true],
	["Be", "beryllium", 4, 9, 2, true],
	["B", "boron", 5, 11, 3, false],
	["C", "carbon", 6, 12, 4, false],
	["N", "nitrogen", 7, 14, 5, false],
	["O", "oxygen", 8, 16, 6, false],
	["F", "fluorine", 9, 19, 7, false],
	["Ne", "neon", 10, 20, 8, false],
	["Na", "sodium", 11, 23, 1, true],
	["Mg", "magnesium", 12, 24, 2, true],
	["Al", "aluminium", 13, 27, 3, true],
	["Si", "silicon", 14, 28, 4, false],
	["P", "phosphorus", 15, 31, 5, false],
	["S", "sulfur", 16, 32, 6, false],
	["Cl", "chlorine", 17, 35, 7, false],
	["Ar", "argon", 18, 40, 8, false],
	["K", "potassium", 19, 39, 1, true],
	["Ca", "calcium", 20, 40, 2, true],
	["Fe", "iron", 26, 56, 0, true],
	["Cu", "copper", 29, 63, 0, true],
	["Zn", "zinc", 30, 64, 0, true],
];

// Relative atomic masses as commonly rounded in school chemistry.
const AR = { H: 1, C: 12, N: 14, O: 16, Na: 23, Mg: 24, S: 32, Cl: 35.5, K: 39, Ca: 40 };

// [formula display, composition]
const FORMULAE = [
	["H₂O", { H: 2, O: 1 }],
	["CO₂", { C: 1, O: 2 }],
	["CH₄", { C: 1, H: 4 }],
	["NH₃", { N: 1, H: 3 }],
	["NaCl", { Na: 1, Cl: 1 }],
	["MgO", { Mg: 1, O: 1 }],
	["H₂SO₄", { H: 2, S: 1, O: 4 }],
	["CaCO₃", { Ca: 1, C: 1, O: 3 }],
	["HCl", { H: 1, Cl: 1 }],
	["C₆H₁₂O₆", { C: 6, H: 12, O: 6 }],
	["KCl", { K: 1, Cl: 1 }],
	["NaOH", { Na: 1, O: 1, H: 1 }],
	["MgCl₂", { Mg: 1, Cl: 2 }],
	["C₂H₆", { C: 2, H: 6 }],
];

// Balanced equations: [reactants, products] each as [coefficient, formula].
const EQUATIONS = [
	[[[2, "H₂"], [1, "O₂"]], [[2, "H₂O"]]],
	[[[1, "CH₄"], [2, "O₂"]], [[1, "CO₂"], [2, "H₂O"]]],
	[[[2, "Mg"], [1, "O₂"]], [[2, "MgO"]]],
	[[[1, "N₂"], [3, "H₂"]], [[2, "NH₃"]]],
	[[[2, "Na"], [1, "Cl₂"]], [[2, "NaCl"]]],
	[[[4, "Fe"], [3, "O₂"]], [[2, "Fe₂O₃"]]],
	[[[1, "C"], [1, "O₂"]], [[1, "CO₂"]]],
	[[[2, "H₂O₂"]], [[2, "H₂O"], [1, "O₂"]]],
	[[[1, "CaCO₃"]], [[1, "CaO"], [1, "CO₂"]]],
	[[[2, "K"], [2, "H₂O"]], [[2, "KOH"], [1, "H₂"]]],
];

const mr = (comp) => Object.entries(comp).reduce((s, [el, n]) => s + AR[el] * n, 0);

export const physics = {
	convertLength(rng) {
		const kinds = [
			["m", "cm", 100],
			["cm", "mm", 10],
			["km", "m", 1000],
			["kg", "g", 1000],
			["min", "s", 60],
			["h", "min", 60],
		];
		const [from, to, f] = rng.pick(kinds);
		const n = rng.int(2, 25);
		if (rng.int(0, 1)) {
			return integerProblem(`Convert ${n} ${from} to ${to}.`, n * f, {
				unit: to,
				solution: [`1 ${from} = ${f} ${to}, so ${n} ${from} = ${n} × ${f} = ${n * f} ${to}.`],
			});
		}
		return integerProblem(`Convert ${n * f} ${to} to ${from}.`, n, {
			unit: from,
			solution: [`1 ${from} = ${f} ${to}, so divide by ${f}: ${n * f} ÷ ${f} = ${n} ${from}.`],
		});
	},
	speed(rng) {
		const v = rng.int(2, 30);
		const t = rng.int(2, 12);
		const d = v * t;
		const ask = rng.pick(["speed", "distance", "time"]);
		if (ask === "speed")
			return integerProblem(`A cyclist travels ${d} m in ${t} s. What is the average speed?`, v, {
				unit: "m/s",
				solution: [`speed = distance ÷ time = ${d} ÷ ${t} = ${v} m/s.`],
			});
		if (ask === "distance")
			return integerProblem(`A car moves at ${v} m/s for ${t} s. How far does it travel?`, d, {
				unit: "m",
				solution: [`distance = speed × time = ${v} × ${t} = ${d} m.`],
			});
		return integerProblem(`How long does it take to travel ${d} m at ${v} m/s?`, t, {
			unit: "s",
			solution: [`time = distance ÷ speed = ${d} ÷ ${v} = ${t} s.`],
		});
	},
	forceMassAcceleration(rng) {
		const m = rng.int(2, 20);
		const a = rng.int(1, 10);
		const F = m * a;
		if (rng.int(0, 1))
			return integerProblem(`A ${m} kg trolley accelerates at ${a} m/s². What resultant force acts on it?`, F, {
				unit: "N",
				scene: { kind: "forces", mass: m, forces: [{ dir: "right", value: "F = ?" }], label: `A ${m} kg block pushed to the right` },
				solution: [`F = m × a = ${m} × ${a} = ${F} N.`],
			});
		return integerProblem(`A resultant force of ${F} N acts on a ${m} kg mass. What is its acceleration?`, a, {
			unit: "m/s²",
			scene: { kind: "forces", mass: m, forces: [{ dir: "right", value: `${F} N` }], label: `${F} newton force on a ${m} kg block` },
			solution: [`a = F ÷ m = ${F} ÷ ${m} = ${a} m/s².`],
		});
	},
	weight(rng) {
		const m = rng.int(2, 90);
		return integerProblem(`Taking g = 10 N/kg, what is the weight of a ${m} kg object?`, m * 10, {
			unit: "N",
			solution: [`W = m × g = ${m} × 10 = ${m * 10} N.`],
		});
	},
	resultantForce(rng) {
		const left = rng.int(5, 40);
		const right = rng.int(5, 40);
		if (left === right) return physics.resultantForce(rng);
		const net = Math.abs(right - left);
		return integerProblem(`A box is pulled right with ${right} N and left with ${left} N. What is the size of the resultant force?`, net, {
			unit: "N",
			scene: {
				kind: "forces",
				forces: [
					{ dir: "right", value: `${right} N` },
					{ dir: "left", value: `${left} N` },
				],
				label: `${right} newtons to the right and ${left} newtons to the left`,
			},
			solution: [`Opposite forces subtract: ${Math.max(left, right)} − ${Math.min(left, right)} = ${net} N.`],
		});
	},
	work(rng) {
		const F = rng.int(2, 50);
		const d = rng.int(2, 20);
		return integerProblem(`A force of ${F} N moves a box ${d} m. How much work is done?`, F * d, {
			unit: "J",
			solution: [`W = F × d = ${F} × ${d} = ${F * d} J.`],
		});
	},
	kineticEnergy(rng) {
		const m = rng.int(1, 10) * 2;
		const v = rng.int(1, 10);
		return integerProblem(`What is the kinetic energy of a ${m} kg object moving at ${v} m/s?`, (m * v * v) / 2, {
			unit: "J",
			solution: [`KE = ½ × m × v² = ½ × ${m} × ${v}² = ${(m * v * v) / 2} J.`],
		});
	},
	power(rng) {
		const t = rng.int(2, 20);
		const P = rng.int(5, 100);
		return integerProblem(`A motor does ${P * t} J of work in ${t} s. What is its power?`, P, {
			unit: "W",
			solution: [`P = W ÷ t = ${P * t} ÷ ${t} = ${P} W.`],
		});
	},
	density(rng) {
		const rho = rng.int(1, 20);
		const V = rng.int(2, 50);
		return integerProblem(`A block has mass ${rho * V} g and volume ${V} cm³. What is its density?`, rho, {
			unit: "g/cm³",
			solution: [`density = mass ÷ volume = ${rho * V} ÷ ${V} = ${rho} g/cm³.`],
		});
	},
	pressure(rng) {
		const p = rng.int(2, 50);
		const A = rng.int(2, 10);
		return integerProblem(`A force of ${p * A} N acts on an area of ${A} m². What is the pressure?`, p, {
			unit: "Pa",
			solution: [`p = F ÷ A = ${p * A} ÷ ${A} = ${p} Pa.`],
		});
	},
	ohmsLaw(rng) {
		const I = rng.int(1, 10);
		const R = rng.int(2, 24);
		const V = I * R;
		const ask = rng.pick(["V", "I", "R"]);
		if (ask === "V")
			return integerProblem(`A current of ${I} A flows through a ${R} Ω resistor. What is the voltage across it?`, V, {
				unit: "V",
				solution: [`V = I × R = ${I} × ${R} = ${V} V.`],
			});
		if (ask === "I")
			return integerProblem(`A ${V} V supply is connected across a ${R} Ω resistor. What current flows?`, I, {
				unit: "A",
				scene: { kind: "circuit", resistors: [R], voltage: V, label: `A ${V} volt cell with one ${R} ohm resistor` },
				solution: [`I = V ÷ R = ${V} ÷ ${R} = ${I} A.`],
			});
		return integerProblem(`A ${V} V supply drives ${I} A through a resistor. What is its resistance?`, R, {
			unit: "Ω",
			solution: [`R = V ÷ I = ${V} ÷ ${I} = ${R} Ω.`],
		});
	},
	seriesResistance(rng) {
		const n = rng.int(2, 3);
		const rs = Array.from({ length: n }, () => rng.int(2, 30));
		const total = rs.reduce((a, b) => a + b, 0);
		return integerProblem(`What is the total resistance of ${rs.map((r) => `${r} Ω`).join(", ")} in series?`, total, {
			unit: "Ω",
			scene: { kind: "circuit", resistors: rs, label: `${n} resistors in series: ${rs.join(", ")} ohms` },
			solution: [`In series, add the resistances: ${rs.join(" + ")} = ${total} Ω.`],
		});
	},
	electricalPower(rng) {
		const V = rng.int(2, 24);
		const I = rng.int(1, 10);
		return integerProblem(`A device runs at ${V} V with a current of ${I} A. What is its power?`, V * I, {
			unit: "W",
			solution: [`P = V × I = ${V} × ${I} = ${V * I} W.`],
		});
	},
	waveSpeed(rng) {
		const f = rng.int(2, 50);
		const lambda = rng.int(1, 20);
		if (rng.int(0, 1))
			return integerProblem(`A wave has frequency ${f} Hz and wavelength ${lambda} m. What is its speed?`, f * lambda, {
				unit: "m/s",
				solution: [`v = f × λ = ${f} × ${lambda} = ${f * lambda} m/s.`],
			});
		return integerProblem(`A wave travels at ${f * lambda} m/s with frequency ${f} Hz. What is its wavelength?`, lambda, {
			unit: "m",
			solution: [`λ = v ÷ f = ${f * lambda} ÷ ${f} = ${lambda} m.`],
		});
	},
	period(rng) {
		const f = rng.pick([2, 4, 5, 8, 10, 20, 25, 50]);
		return decimalProblem(`A wave has a frequency of ${f} Hz. What is its period?`, dec(1000 / f, 1000), {
			unit: "s",
			solution: [`T = 1 ÷ f = 1 ÷ ${f} = ${dec(1000 / f, 1000)} s.`],
		});
	},
};

export const chemistry = {
	symbolFromName(rng) {
		const [sym, name] = rng.pick(ELEMENTS);
		return textProblem(`What is the chemical symbol for ${name}?`, sym, {
			solution: [`The symbol for ${name} is ${sym}.`],
		});
	},
	nameFromSymbol(rng) {
		const [sym, name] = rng.pick(ELEMENTS);
		const alt = name === "aluminium" ? ["aluminum"] : name === "sulfur" ? ["sulphur"] : [];
		return textProblem(`Which element has the symbol ${sym}?`, name, {
			accept: alt,
			solution: [`${sym} is the symbol for ${name}.`],
		});
	},
	stateOfMatter(rng) {
		const items = [
			["ice", "solid"], ["steam", "gas"], ["water at room temperature", "liquid"],
			["oxygen at room temperature", "gas"], ["iron at room temperature", "solid"],
			["mercury at room temperature", "liquid"], ["carbon dioxide at room temperature", "gas"],
			["salt at room temperature", "solid"],
		];
		const [thing, state] = rng.pick(items);
		return choiceProblem(rng, `Is ${thing} a solid, a liquid or a gas?`, state, ["solid", "liquid", "gas"].filter((s) => s !== state), {
			keepOrder: false,
			solution: [`${thing[0].toUpperCase() + thing.slice(1)} is a ${state}.`],
		});
	},
	protons(rng) {
		const [sym, name, Z] = rng.pick(ELEMENTS);
		return integerProblem(`How many protons are in an atom of ${name} (${sym})? Its atomic number is ${Z}.`, Z, {
			solution: [`The atomic number is the number of protons: ${Z}.`],
		});
	},
	neutrons(rng) {
		const [sym, name, Z, A] = rng.pick(ELEMENTS.filter((e) => e[0] !== "Cl"));
		return integerProblem(`An atom of ${name} has atomic number ${Z} and mass number ${A}. How many neutrons does it have?`, A - Z, {
			solution: [`neutrons = mass number − atomic number = ${A} − ${Z} = ${A - Z}.`],
			text: `An atom of ${name} (${sym}) has atomic number ${Z} and mass number ${A}. How many neutrons does it have?`,
		});
	},
	electronsNeutral(rng) {
		const [sym, name, Z] = rng.pick(ELEMENTS.filter((e) => e[2] <= 20));
		return integerProblem(`How many electrons does a neutral atom of ${name} (${sym}, atomic number ${Z}) have?`, Z, {
			solution: [`A neutral atom has equal numbers of protons and electrons: ${Z}.`],
		});
	},
	group(rng) {
		const [sym, name, , , grp] = rng.pick(ELEMENTS.filter((e) => e[4] > 0 && e[2] <= 20 && e[0] !== "H" && e[0] !== "He"));
		return integerProblem(`Which group of the periodic table is ${name} (${sym}) in? (Use groups 1–8, with noble gases as group 8.)`, grp, {
			solution: [`${name[0].toUpperCase() + name.slice(1)} is in group ${grp}.`],
		});
	},
	metalOrNonMetal(rng) {
		// Boron and silicon are metalloids, so they are left out of this question.
		const [sym, name, , , , metal] = rng.pick(ELEMENTS.filter((e) => e[0] !== "B" && e[0] !== "Si"));
		const ans = metal ? "metal" : "non-metal";
		return choiceProblem(rng, `Is ${name} (${sym}) a metal or a non-metal?`, ans, [metal ? "non-metal" : "metal"], {
			solution: [`${name[0].toUpperCase() + name.slice(1)} is a ${ans}.`],
		});
	},
	countAtoms(rng) {
		const [formula, comp] = rng.pick(FORMULAE);
		const total = Object.values(comp).reduce((a, b) => a + b, 0);
		return integerProblem(`How many atoms in total are in one molecule/formula unit of ${formula}?`, total, {
			solution: [`Add the atoms: ${Object.entries(comp).map(([el, n]) => `${n} ${el}`).join(" + ")} = ${total}.`],
		});
	},
	relativeFormulaMass(rng) {
		const [formula, comp] = rng.pick(FORMULAE);
		const m = mr(comp);
		const used = Object.keys(comp).map((el) => `${el} = ${AR[el]}`).join(", ");
		return decimalProblem(`Calculate the relative formula mass (Mr) of ${formula}. (Ar: ${used})`, String(m), {
			solution: [
				`Mr = ${Object.entries(comp).map(([el, n]) => `${n} × ${AR[el]}`).join(" + ")} = ${m}.`,
			],
		});
	},
	moles(rng) {
		const [formula, comp] = rng.pick(FORMULAE.filter(([, c]) => Number.isInteger(mr(c))));
		const M = mr(comp);
		const n = rng.int(1, 6);
		if (rng.int(0, 1))
			return integerProblem(`How many moles are in ${n * M} g of ${formula}? (Mr = ${M})`, n, {
				unit: "mol",
				solution: [`moles = mass ÷ Mr = ${n * M} ÷ ${M} = ${n} mol.`],
			});
		return integerProblem(`What is the mass of ${n} mol of ${formula}? (Mr = ${M})`, n * M, {
			unit: "g",
			solution: [`mass = moles × Mr = ${n} × ${M} = ${n * M} g.`],
		});
	},
	concentration(rng) {
		const volumes = [[250, 0.25], [500, 0.5], [1000, 1], [2000, 2]];
		const [mL, L] = rng.pick(volumes);
		const c = rng.pick([0.5, 1, 2, 4]);
		const n = c * L;
		if (!Number.isInteger(n * 100)) return chemistry.concentration(rng);
		return decimalProblem(`${n} mol of solute is dissolved to make ${mL} cm³ of solution. What is the concentration in mol/dm³?`, String(c), {
			unit: "mol/dm³",
			solution: [`${mL} cm³ = ${L} dm³. c = n ÷ V = ${n} ÷ ${L} = ${c} mol/dm³.`],
		});
	},
	balance(rng) {
		const [reactants, products] = rng.pick(EQUATIONS);
		const all = [...reactants, ...products];
		const side = (list) => list.map(([, f]) => `__ ${f}`).join(" + ");
		return multiProblem(
			[`Balance the equation: ${side(reactants)} → ${side(products)}`],
			all.map(([c]) => ({ kind: "integer", value: String(c) })),
			all.map(([, f]) => f),
			{
				solution: [
					`Balanced: ${reactants.map(([c, f]) => `${c === 1 ? "" : c}${f}`).join(" + ")} → ${products
						.map(([c, f]) => `${c === 1 ? "" : c}${f}`)
						.join(" + ")}`,
					"Use the smallest whole numbers (write 1 where no number is shown).",
				],
			}
		);
	},
};

