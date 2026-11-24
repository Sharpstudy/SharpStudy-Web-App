// Mastery Ladder curriculum: subject -> stage -> level -> set -> worksheet.
//
// Level ids are globally unique (7A, E7A, PH1, CH1 ...) so a level id alone
// identifies its subject. Set ids are "<levelId>-<n>". Each set has
// RULES.worksheetsPerSet worksheets of RULES.questionsPerWorksheet questions.
//
// A set with `ready: false` has no generator yet. It appears in the ladder
// (so placement/structure is visible) but cannot be opened, printed or
// progressed into — the ladder stops at the last ready set instead of serving
// placeholder content.

import { RULES } from "./rules.js";

// set(title, generator, params, targetSeconds, lesson)
const S = (title, gen, params, target, lesson) => ({ title, gen, params: params || {}, target, lesson, ready: true });
const TODO = (title) => ({ title, gen: null, params: {}, target: 300, lesson: "", ready: false });

const MATH = [
	{ stage: "Counting", levels: [
		["7A", "Counting to 10", [
			S("Count dots to 5", "math.countDots", { max: 5 }, 120, "Point to each dot once as you say the numbers. The last number you say is how many there are."),
			S("Count dots to 10", "math.countDots", { max: 10 }, 150, "Count carefully, touching each dot once. Do not skip any or count any twice."),
			S("Ten-frames", "math.tenFrame", { max: 10 }, 150, "A ten-frame has two rows of 5. A full top row is 5, then keep counting on."),
			S("Count pictures", "math.countObjects", { max: 10 }, 150, "Count each picture once. The last number you say is the total."),
			S("Match numbers to dots", "math.matchCount", { max: 10 }, 150, "Count the dots, then find the number that says the same amount."),
		]],
		["6A", "Counting to 30", [
			S("Count dots to 20", "math.countDots", { min: 8, max: 20 }, 180, "Count in a line, row by row. Touch each dot once."),
			S("What comes next to 20", "math.nextNumber", { max: 20 }, 150, "When we count, each number is one more than the one before."),
			S("What comes next to 30", "math.nextNumber", { max: 30 }, 150, "Say the numbers out loud and listen for the next one."),
			S("Number after", "math.numberAfter", { max: 30 }, 150, "The number after is one more."),
			S("Number before", "math.numberBefore", { max: 30 }, 150, "The number before is one less."),
		]],
		["5A", "Number sequences to 50", [
			S("Missing numbers to 30", "math.missingInSequence", { max: 30 }, 180, "Look at the numbers on each side of the gap. The missing one is in between."),
			S("Missing numbers to 50", "math.missingInSequence", { max: 50 }, 180, "Count on from the number before the gap."),
			S("Which is bigger?", "math.biggerNumber", { max: 50 }, 150, "The bigger number comes later when we count."),
			S("Number after to 50", "math.numberAfter", { max: 50 }, 150, "The number after is one more: after 39 comes 40."),
		]],
		["4A", "Numbers to 120", [
			S("Missing numbers to 100", "math.missingInSequence", { min: 20, max: 100 }, 180, "Use the tens and ones: after 39 comes 40."),
			S("Missing numbers to 120", "math.missingInSequence", { min: 50, max: 120 }, 180, "Past 100 the pattern repeats: 101, 102, 103 ..."),
			S("Count by 2s", "math.skipCount", { step: 2, max: 30 }, 150, "Counting by 2s skips every other number: 2, 4, 6, 8 ..."),
			S("Count by 5s", "math.skipCount", { step: 5, max: 60 }, 150, "Counting by 5s: 5, 10, 15, 20 ... the ones digit is always 5 or 0."),
			S("Count by 10s", "math.skipCount", { step: 10, max: 120 }, 150, "Counting by 10s only changes the tens digit: 10, 20, 30 ..."),
		]],
	]},
	{ stage: "Addition & subtraction", levels: [
		["3A", "Adding 1, 2 and 3", [
			S("Adding 1", "math.add", { a: [1, 20], b: [1, 1] }, 120, "Adding 1 gives the next number when you count."),
			S("Adding 2", "math.add", { a: [1, 20], b: [2, 2] }, 150, "Adding 2 is counting on two more."),
			S("Adding 3", "math.add", { a: [1, 20], b: [3, 3] }, 150, "Start at the bigger number and count on 3."),
			S("Adding 1 to 3", "math.add", { a: [1, 30], b: [1, 3] }, 150, "Read the second number to see how many to count on."),
		]],
		["2A", "Adding to 10", [
			S("Adding 4 and 5", "math.add", { a: [1, 15], b: [4, 5] }, 180, "Start at the first number and count on 4 or 5."),
			S("Adding 6 and 7", "math.add", { a: [1, 15], b: [6, 7] }, 180, "Adding 6 is the same as adding 5, then 1 more."),
			S("Adding 8, 9 and 10", "math.add", { a: [1, 15], b: [8, 10] }, 180, "Adding 10 adds one to the tens digit. Adding 9 is adding 10 then taking 1 away."),
			S("Missing numbers in sums", "math.missingAddend", { max: 20 }, 180, "Ask: what do I add to the first number to reach the total?"),
		]],
		["A", "Subtraction", [
			S("Subtracting 1 to 3", "math.sub", { a: [3, 20], b: [1, 3] }, 150, "Subtracting means counting back."),
			S("Subtracting within 20", "math.sub", { a: [5, 20], b: [2, 10] }, 180, "Count back from the bigger number, or think of the matching addition fact."),
			S("Mixed + and −", "math.addSub", { max: 20 }, 180, "Read the sign first: + means count on, − means count back."),
			S("Mixed to 50", "math.addSub", { max: 50 }, 210, "Work with the tens first, then the ones."),
		]],
		["B", "Column addition & subtraction", [
			S("2-digit addition, no carrying", "math.addVertical", { carry: false }, 180, "Add the ones column first, then the tens column."),
			S("2-digit addition with carrying", "math.addVertical", { carry: true }, 210, "If the ones add to 10 or more, write the ones digit and carry the 1 to the tens."),
			S("3-digit addition", "math.addVertical", { digitsA: 3, digitsB: 3, carry: true }, 240, "Work right to left: ones, tens, hundreds, carrying when needed."),
			S("2-digit subtraction, no borrowing", "math.subVertical", { borrow: false }, 180, "Subtract the ones, then the tens."),
			S("2-digit subtraction with borrowing", "math.subVertical", { borrow: true }, 240, "If the top ones digit is smaller, borrow 10 from the tens column."),
			S("3-digit subtraction", "math.subVertical", { digitsA: 3, digitsB: 3, borrow: true }, 270, "Work right to left and borrow from the next column when the top digit is smaller."),
		]],
	]},
	{ stage: "Multiplication & division", levels: [
		["C", "Multiplication & division", [
			S("Times tables 2–5", "math.times", { tables: [2, 3, 4, 5] }, 150, "3 × 4 means 3 groups of 4 (or 4 groups of 3). Skip count to find it."),
			S("Times tables 6–9", "math.times", { tables: [6, 7, 8, 9] }, 180, "Use facts you know: 7 × 6 is 7 × 5 plus one more 7."),
			S("2-digit × 1-digit", "math.multiply", { a: [10, 99], b: [2, 9] }, 240, "Multiply the ones, then the tens, and add the two parts."),
			S("Division facts", "math.divideExact", {}, 180, "Division undoes multiplication: 24 ÷ 6 asks 'what times 6 makes 24?'."),
			S("Division with remainders", "math.divideRemainder", {}, 240, "Find the biggest multiple that fits; what is left over is the remainder."),
		]],
		["D", "Long multiplication & fractions", [
			S("2-digit × 2-digit", "math.multiply", { a: [12, 99], b: [11, 99] }, 300, "Multiply by the ones digit, then by the tens digit (add a 0), then add."),
			S("3-digit × 1-digit", "math.multiply", { a: [100, 999], b: [2, 9] }, 240, "Multiply each digit by the single digit, carrying as you go."),
			S("Long division with remainders", "math.divideRemainder", { quotient: [10, 99] }, 300, "Divide, multiply, subtract, bring down — repeat until all digits are used."),
			S("Equivalent fractions", "math.equivalentFraction", {}, 210, "Multiply the top and the bottom by the same number to make an equal fraction."),
			S("Simplifying fractions", "math.reduceFraction", {}, 240, "Divide the top and bottom by their highest common factor."),
		]],
	]},
	{ stage: "Fractions & decimals", levels: [
		["E", "Fraction operations", [
			S("Adding with the same denominator", "math.fractionAddSame", {}, 210, "When the bottoms match, add the tops and keep the bottom. Simplify at the end."),
			S("Adding with different denominators", "math.fractionAdd", {}, 300, "Rewrite both fractions with a common denominator, then add the tops."),
			S("Subtracting fractions", "math.fractionAdd", { subtract: true }, 300, "Use a common denominator, then subtract the tops."),
			S("Multiplying fractions", "math.fractionMultiply", {}, 240, "Multiply top × top and bottom × bottom, then simplify."),
		]],
		["F", "Decimals & order of operations", [
			S("Adding & subtracting decimals (1 dp)", "math.decimalAddSub", { places: 1 }, 240, "Line up the decimal points before you add or subtract."),
			S("Adding & subtracting decimals (2 dp)", "math.decimalAddSub", { places: 2, max: 50 }, 270, "Line up the decimal points; fill empty places with zeros."),
			S("Decimal × whole number", "math.decimalTimesInt", { places: 1 }, 240, "Multiply as whole numbers, then put the decimal point back in."),
			S("Order of operations", "math.orderOfOperations", {}, 270, "Brackets first, then × and ÷, then + and −."),
		]],
	]},
	{ stage: "Algebra", levels: [
		["G", "Integers & expressions", [
			S("Adding & subtracting negatives", "math.integerAddSub", {}, 240, "Subtracting a negative is the same as adding a positive."),
			S("Multiplying negatives", "math.integerMultiply", {}, 210, "Same signs give a positive answer; different signs give a negative."),
			S("Collecting like terms", "math.likeTerms", {}, 240, "Like terms have the same letter. Add or subtract the numbers in front."),
			S("Substitution", "math.evaluate", {}, 270, "Replace the letter with its value, then work it out."),
		]],
		["H", "Linear equations", [
			S("One-sided equations", "math.solveLinear", {}, 300, "Undo the operations in reverse order, doing the same to both sides."),
			S("Unknowns on both sides", "math.solveLinear", { twoSided: true }, 360, "Collect the x terms on one side and the numbers on the other."),
			S("Simultaneous equations", "math.simultaneous", {}, 480, "Use one equation to write x in terms of y, substitute, then solve."),
		]],
		["I", "Expanding & roots", [
			S("Expanding single brackets", "math.expandBracket", {}, 270, "Multiply every term inside the bracket by the number outside."),
			S("Expanding double brackets", "math.expandBinomials", {}, 360, "Multiply each term in the first bracket by each term in the second, then collect like terms."),
			S("Square roots", "math.squareRoot", {}, 180, "The square root asks: which number times itself makes this?"),
			S("Pythagoras", "math.pythagoras", {}, 300, "In a right triangle, c² = a² + b², where c is the longest side."),
		]],
		["J", "Quadratic equations", [
			S("Solving factorable quadratics", "math.quadraticRoots", {}, 420, "Find two numbers that multiply to the constant and add to the x coefficient."),
			S("Completing the square", "math.completeSquare", {}, 180, "Halve the x coefficient to get p, then q is the constant minus p²."),
			S("The quadratic formula", "math.quadraticFormula", {}, 180, "x = (−b ± √(b² − 4ac)) ÷ 2a. The discriminant b² − 4ac tells you how many roots there are."),
		]],
	]},
	{ stage: "Functions", levels: [
		["K", "Functions & graphs", [
			S("Function notation", "math.functionNotation", {}, 180, "f(3) means: put 3 wherever you see x. For f(g(x)), work out the inside g first."),
			S("Linear graphs", "math.linearGraphs", {}, 180, "y = mx + c: m is the gradient (rise ÷ run) and c is where the line crosses the y-axis."),
			S("Quadratic graphs", "math.parabolaFeatures", {}, 180, "y = (x − h)² + k has its turning point at (h, k)."),
		]],
		["L", "Advanced functions", [
			S("Exponentials & logarithms", "math.exponentsLogs", {}, 180, "Powers with the same base: add when multiplying, subtract when dividing. log asks 'which power?'."),
			S("Trigonometric functions", "math.trigFunctions", {}, 180, "sin = opposite ÷ hypotenuse, cos = adjacent ÷ hypotenuse, tan = opposite ÷ adjacent."),
		]],
	]},
	{ stage: "Calculus", levels: [
		["M", "Trigonometry & sequences", [
			S("Trigonometric identities", "math.trigIdentity", {}, 180, "sin²θ + cos²θ = 1, tan θ = sin θ ÷ cos θ, and cos θ = sin(90° − θ)."),
			S("Sequences & series", "math.sequencesSeries", {}, 180, "Arithmetic: add the same d each time. Geometric: multiply by the same r each time."),
		]],
		["N", "Differentiation", [
			S("Limits", "math.limit", {}, 180, "Substitute if you can; if you get 0 ÷ 0, factorise and cancel first."),
			S("Derivatives", "math.derivatives", {}, 180, "d/dx of axⁿ is a·n·xⁿ⁻¹. A stationary point is where the derivative is 0."),
		]],
		["O", "Integration", [
			S("Integrals", "math.integrals", {}, 180, "Integration undoes differentiation: add 1 to the power and divide by the new power."),
			S("Applications of calculus", "math.calculusApplication", {}, 180, "Velocity is the derivative of position; distance and area come from definite integrals."),
		]],
	]},
];

const ENGLISH = [
	{ stage: "Letters & sounds", levels: [
		["E7A", "Letters", [
			S("Capital and small letters", "english.upperToLower", {}, 150, "Every letter has a capital (big) shape and a small shape. A and a are the same letter."),
			S("Alphabet order", "english.nextLetter", {}, 150, "Sing or say the alphabet to find what comes next."),
		]],
		["E6A", "First sounds", [
			S("First letter of a word", "english.firstLetter", {}, 180, "Say the word slowly and listen to the very first sound."),
		]],
		["E5A", "Rhyming words", [
			S("Rhymes", "english.rhyme", {}, 180, "Rhyming words end with the same sound, like cat and hat."),
		]],
	]},
	{ stage: "Words", levels: [
		["E4A", "Plurals", [S("Plural nouns", "english.plural", {}, 210, "Most words add -s. Words ending in s, x, ch or sh add -es. Some words change completely: child → children.")]],
		["E3A", "Opposites", [S("Opposites", "english.opposite", {}, 210, "An opposite means the reverse: hot and cold, up and down.")]],
		["E2A", "Alphabetical order", [S("Which word comes first?", "english.alphabeticalFirst", {}, 210, "Compare first letters; the word whose first letter is earliest in the alphabet comes first.")]],
	]},
	{ stage: "Grammar & vocabulary", levels: [
		["EA", "Past tense", [S("Past tense verbs", "english.pastTense", {}, 240, "Many verbs add -ed for the past (walk → walked), but some change: go → went.")]],
		["EB", "Word classes", [S("Nouns, verbs & adjectives", "english.wordClass", {}, 240, "Nouns name things, verbs are actions, adjectives describe.")]],
		["EC", "Synonyms", [S("Words with the same meaning", "english.synonym", {}, 240, "Synonyms are different words that mean the same thing, like big and large.")]],
	]},
];

const PHYSICS = [
	{ stage: "Measurement", levels: [["PH1", "Units & measurement", [S("Converting units", "physics.convertLength", {}, 300, "Know the conversion factor, then multiply to get smaller units or divide to get bigger units.")]]] },
	{ stage: "Motion & forces", levels: [
		["PH2", "Speed", [S("Speed, distance & time", "physics.speed", {}, 360, "speed = distance ÷ time. Rearrange to find distance or time.")]],
		["PH3", "Forces", [
			S("Resultant force", "physics.resultantForce", {}, 300, "Forces in opposite directions subtract; the resultant points the way of the bigger force."),
			S("Weight", "physics.weight", {}, 240, "Weight = mass × gravitational field strength (g)."),
			S("F = m × a", "physics.forceMassAcceleration", {}, 360, "Resultant force = mass × acceleration."),
		]],
	]},
	{ stage: "Energy", levels: [["PH4", "Work, energy & power", [
		S("Work done", "physics.work", {}, 300, "Work done = force × distance moved in the direction of the force."),
		S("Kinetic energy", "physics.kineticEnergy", {}, 360, "Kinetic energy = ½ × mass × speed²."),
		S("Power", "physics.power", {}, 300, "Power = energy transferred (work) ÷ time."),
	]]] },
	{ stage: "Matter", levels: [["PH5", "Density & pressure", [
		S("Density", "physics.density", {}, 300, "Density = mass ÷ volume."),
		S("Pressure", "physics.pressure", {}, 300, "Pressure = force ÷ area."),
	]]] },
	{ stage: "Electricity & waves", levels: [
		["PH6", "Electricity", [
			S("Ohm's law", "physics.ohmsLaw", {}, 360, "V = I × R. Cover the one you want to find and use the other two."),
			S("Series resistance", "physics.seriesResistance", {}, 300, "In a series circuit the total resistance is the sum of the resistances."),
			S("Electrical power", "physics.electricalPower", {}, 300, "Power = voltage × current."),
		]],
		["PH7", "Waves", [
			S("Wave speed", "physics.waveSpeed", {}, 360, "wave speed = frequency × wavelength."),
			S("Period & frequency", "physics.period", {}, 300, "period = 1 ÷ frequency."),
		]],
	]},
];

const CHEMISTRY = [
	{ stage: "Elements", levels: [
		["CH1", "Elements & states", [
			S("Element symbols", "chemistry.symbolFromName", {}, 300, "Each element has a one- or two-letter symbol; the first letter is a capital."),
			S("Element names", "chemistry.nameFromSymbol", {}, 300, "Some symbols come from Latin names: Na is sodium, K is potassium, Fe is iron."),
			S("States of matter", "chemistry.stateOfMatter", {}, 240, "Solids keep their shape, liquids flow, gases spread out to fill a space."),
		]],
		["CH2", "Atomic structure", [
			S("Protons", "chemistry.protons", {}, 240, "The atomic number is the number of protons."),
			S("Electrons", "chemistry.electronsNeutral", {}, 240, "A neutral atom has the same number of electrons as protons."),
			S("Neutrons", "chemistry.neutrons", {}, 300, "neutrons = mass number − atomic number."),
		]],
		["CH3", "The periodic table", [
			S("Groups", "chemistry.group", {}, 300, "Elements in the same group (column) have the same number of outer electrons."),
			S("Metals & non-metals", "chemistry.metalOrNonMetal", {}, 240, "Metals are on the left and centre of the periodic table; non-metals are on the right."),
		]],
	]},
	{ stage: "Compounds", levels: [["CH4", "Formulae", [
		S("Counting atoms", "chemistry.countAtoms", {}, 300, "The small number after a symbol tells you how many of that atom there are."),
		S("Relative formula mass", "chemistry.relativeFormulaMass", {}, 420, "Add up the relative atomic masses of every atom in the formula."),
	]]] },
	{ stage: "Quantitative chemistry", levels: [
		["CH5", "Moles", [S("Moles and mass", "chemistry.moles", {}, 420, "moles = mass ÷ Mr.")]],
		["CH6", "Concentration", [S("Concentration", "chemistry.concentration", {}, 420, "concentration (mol/dm³) = moles ÷ volume (dm³). 1000 cm³ = 1 dm³.")]],
	]},
	{ stage: "Reactions", levels: [["CH7", "Balancing equations", [S("Balancing equations", "chemistry.balance", {}, 480, "Count each type of atom on both sides and change the big numbers in front until they match.")]]] },
];

const SUBJECT_DEFS = [
	{ id: "math", name: "Mathematics", icon: "ri-calculator-line", stages: MATH },
	{ id: "english", name: "English", icon: "ri-book-open-line", stages: ENGLISH },
	{ id: "physics", name: "Physics", icon: "ri-flashlight-line", stages: PHYSICS },
	{ id: "chemistry", name: "Chemistry", icon: "ri-flask-line", stages: CHEMISTRY },
];

// ---- Build indexes ----

const levelsById = new Map();
const setsById = new Map();
export const SUBJECTS = SUBJECT_DEFS.map((subj) => {
	const levels = [];
	for (const st of subj.stages) {
		for (const [id, title, sets] of st.levels) {
			const level = {
				id,
				subject: subj.id,
				stage: st.stage,
				title,
				sets: sets.map((s, i) => ({
					...s,
					id: `${id}-${i + 1}`,
					levelId: id,
					subject: subj.id,
					index: i,
					worksheets: RULES.worksheetsPerSet,
					questions: RULES.questionsPerWorksheet,
					targetSeconds: RULES.targetSeconds, // one target for every worksheet (spec: 180 s)
				})),
			};
			level.ready = level.sets.some((s) => s.ready);
			levels.push(level);
			levelsById.set(id, level);
			level.sets.forEach((s) => setsById.set(s.id, s));
		}
	}
	return { id: subj.id, name: subj.name, icon: subj.icon, stages: subj.stages.map((s) => s.stage), levels };
});

export const SUBJECT_IDS = SUBJECTS.map((s) => s.id);

export const getSubject = (id) => SUBJECTS.find((s) => s.id === id) || null;
export const getLevel = (id) => levelsById.get(id) || null;
export const getSet = (levelId, setId) => {
	const s = setsById.get(setId);
	return s && s.levelId === levelId ? s : null;
};

// Flattened ordered list of READY sets per subject — the actual ladder.
const ladderCache = new Map();
export function ladder(subjectId) {
	if (!ladderCache.has(subjectId)) {
		const subj = getSubject(subjectId);
		const list = [];
		if (subj) for (const lv of subj.levels) for (const s of lv.sets) if (s.ready) list.push(s);
		ladderCache.set(subjectId, list);
	}
	return ladderCache.get(subjectId);
}

export function firstPosition(subjectId) {
	const first = ladder(subjectId)[0];
	return first ? { levelId: first.levelId, setId: first.id, worksheetNo: 1 } : null;
}

// Ordering key for a position; -1 if the position is not on the ladder.
export function positionIndex(subjectId, pos) {
	if (!pos) return -1;
	const list = ladder(subjectId);
	const i = list.findIndex((s) => s.id === pos.setId && s.levelId === pos.levelId);
	if (i === -1) return -1;
	const ws = Number(pos.worksheetNo);
	if (!Number.isInteger(ws) || ws < 1 || ws > list[i].worksheets) return -1;
	return i * 1000 + ws;
}

export function isValidPosition(subjectId, pos) {
	return positionIndex(subjectId, pos) !== -1;
}

// A worksheet is unlocked when it is at or before the learner's current position.
export function isUnlocked(subjectId, target, current) {
	const t = positionIndex(subjectId, target);
	const c = positionIndex(subjectId, current);
	return t !== -1 && c !== -1 && t <= c;
}

export const ladderNav = {
	worksheetsInSet: (levelId, setId) => {
		const s = getSet(levelId, setId);
		return s ? s.worksheets : RULES.worksheetsPerSet;
	},
	nextSet: (levelId, setId) => {
		const s = getSet(levelId, setId);
		if (!s) return null;
		const list = ladder(s.subject);
		const i = list.findIndex((x) => x.id === setId);
		const nxt = list[i + 1];
		return nxt ? { levelId: nxt.levelId, setId: nxt.id } : null;
	},
};

// Fraction of the subject's ready ladder completed at `pos` (0..1).
export function ladderProgress(subjectId, pos) {
	const list = ladder(subjectId);
	const i = list.findIndex((s) => s.id === (pos && pos.setId));
	if (i === -1 || list.length === 0) return 0;
	return (i + (pos.worksheetNo - 1) / list[i].worksheets) / list.length;
}

// Public, answer-free summary of the curriculum for the UI.
export function curriculumSummary() {
	return SUBJECTS.map((subj) => ({
		id: subj.id,
		name: subj.name,
		icon: subj.icon,
		stages: subj.stages,
		levels: subj.levels.map((lv) => ({
			id: lv.id,
			stage: lv.stage,
			title: lv.title,
			ready: lv.ready,
			sets: lv.sets.map((s) => ({
				id: s.id,
				title: s.title,
				ready: s.ready,
				worksheets: s.worksheets,
				questions: s.questions,
				targetSeconds: s.targetSeconds,
			})),
		})),
	}));
}
