// Problem / RichText / Scene structures (plain objects, JSON-serialisable).
//
// Problem {
//   type:     "integer" | "decimal" | "fraction" | "text" | "choice" | "multi" | "expression"
//   prompt:   RichText               what the learner sees
//   text:     string                 plain-language version (screen readers, print, tutor)
//   scene?:   Scene                  optional diagram
//   layout?:  { kind: "vertical", top: number|string, bottom: number|string, op: "+"|"-"|"×" }
//   choices?: [{ label: "A", text: "..." }]
//   inputs?:  [{ label, suffix? }]   one per part for "multi"
//   unit?:    string                 shown after the input box
//   answer:   Answer                 see answers.js
//   solution: string[]               worked steps (answer keys, tutor examples)
// }
//
// RichText = Array<string | { frac: [n, d] } | { sup: [base, exp] } | { blank: true }>
//
// Scene =
//   { kind: "dots", count, label }
//   { kind: "tenframe", count, label }
//   { kind: "numberline", from, to, marks: number[], label }
//   { kind: "objects", emoji, count, label }
//   { kind: "circuit", resistors: number[], voltage?, label }
//   { kind: "forces", mass?, forces: [{ dir: "left"|"right"|"up"|"down", value }], label }

const LABELS = ["A", "B", "C", "D", "E"];

export function plainText(rich) {
	if (typeof rich === "string") return rich;
	return (rich || [])
		.map((seg) => {
			if (typeof seg === "string") return seg;
			if (seg.frac) return `${seg.frac[0]}/${seg.frac[1]}`;
			if (seg.sup) return `${seg.sup[0]}^${seg.sup[1]}`;
			if (seg.blank) return "___";
			return "";
		})
		.join("");
}

const base = (type, prompt, answer, extra = {}) => ({
	type,
	prompt: Array.isArray(prompt) ? prompt : [prompt],
	text: extra.text || plainText(Array.isArray(prompt) ? prompt : [prompt]),
	answer,
	solution: extra.solution || [],
	...(extra.scene && { scene: extra.scene }),
	...(extra.layout && { layout: extra.layout }),
	...(extra.unit && { unit: extra.unit }),
	...(extra.inputs && { inputs: extra.inputs }),
});

export const integerProblem = (prompt, value, extra) =>
	base("integer", prompt, { kind: "integer", value: String(value) }, extra);

export const decimalProblem = (prompt, value, extra) =>
	base("decimal", prompt, { kind: "decimal", value: String(value) }, extra);

export const fractionProblem = (prompt, value, extra = {}) =>
	base(
		"fraction",
		prompt,
		{ kind: "fraction", value: String(value), simplest: !!extra.simplest, ...(extra.display && { display: extra.display }) },
		extra
	);

export const textProblem = (prompt, value, extra = {}) =>
	base("text", prompt, { kind: "text", value, ...(extra.accept && { accept: extra.accept }) }, extra);

export const expressionProblem = (prompt, value, extra = {}) =>
	base(
		"expression",
		prompt,
		{
			kind: "expression",
			value,
			...(extra.expanded && { expanded: true }),
			...(extra.simplified && { simplified: true }),
			...(extra.display && { display: extra.display }),
		},
		extra
	);

// parts: [{ kind, value, ... }], labels: ["x", "y"]
export const multiProblem = (prompt, parts, labels, extra = {}) => {
	const p = base("multi", prompt, { kind: "multi", parts, labels, ordered: extra.ordered !== false }, extra);
	p.inputs = labels.map((label) => ({ label }));
	return p;
};

// Builds a lettered multiple-choice problem. `options` contains the correct
// option plus distractors (must all be distinct); order is shuffled by rng.
export function choiceProblem(rng, prompt, correct, distractors, extra = {}) {
	const all = [String(correct), ...distractors.map(String)];
	if (new Set(all).size !== all.length) throw new Error("choice options must be distinct");
	const ordered = extra.keepOrder ? all : rng.shuffle(all);
	const choices = ordered.map((text, i) => ({ label: LABELS[i], text }));
	const right = choices.find((c) => c.text === String(correct));
	const p = base("choice", prompt, { kind: "choice", value: right.label, display: `${right.label} (${right.text})` }, extra);
	p.choices = choices;
	return p;
}

// Pick `n` distinct values from candidates excluding `exclude`.
export function distinct(rng, candidates, n, exclude = []) {
	const pool = rng.shuffle([...new Set(candidates.map(String))].filter((c) => !exclude.map(String).includes(c)));
	if (pool.length < n) throw new Error("not enough distractor candidates");
	return pool.slice(0, n);
}

// Remove answers/solutions before sending a sheet somewhere answers must not go.
export function stripAnswers(problem) {
	// eslint-disable-next-line no-unused-vars
	const { answer, solution, ...rest } = problem;
	return rest;
}
