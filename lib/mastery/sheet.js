// Worksheet generation: generateSheet(levelId, setId, worksheetNo, variant).
// Deterministic — identical arguments always produce identical worksheets,
// on the server, in the study player and on printed copies.

import { createRng, sheetSeed, seedCode } from "./rng.js";
import { getLevel, getSet } from "./curriculum.js";
import { math as mathBasic } from "./generators/math.js";
import { mathAdvanced } from "./generators/math_advanced.js";
import { english } from "./generators/english.js";
import { physics, chemistry } from "./generators/science.js";
import { stripAnswers } from "./problem.js";
import { checkAnswer } from "./answers.js";

const math = { ...mathBasic, ...mathAdvanced };
const GENERATORS = { math, english, physics, chemistry };

export class SheetError extends Error {
	constructor(message, code = "invalid_sheet") {
		super(message);
		this.code = code;
	}
}

// Identity of a question: the same words with a different diagram or
// different choices is a different question ("How many dots?").
export const problemKey = (p) =>
	JSON.stringify([p.text, p.scene ? [p.scene.kind, p.scene.count, p.scene.resistors, p.scene.forces, p.scene.emoji] : null, p.layout || null, p.choices ? p.choices.map((c) => c.text).sort() : null]);

export function getGenerator(key) {
	if (!key) return null;
	const [group, name] = key.split(".");
	const fn = GENERATORS[group] && GENERATORS[group][name];
	return typeof fn === "function" ? fn : null;
}

// Generate one problem for a set from an explicit seed (used for tutor
// "similar example" problems and for self-checks).
export function generateProblem(set, seed) {
	const gen = getGenerator(set.gen);
	if (!gen) throw new SheetError(`Set ${set.id} has no generator yet`, "not_ready");
	return gen(createRng(seed), set.params);
}

export function generateSheet(levelId, setId, worksheetNo, variant = 0) {
	const level = getLevel(levelId);
	if (!level) throw new SheetError(`Unknown level ${levelId}`);
	const set = getSet(levelId, setId);
	if (!set) throw new SheetError(`Unknown set ${setId} for level ${levelId}`);
	const ws = Number(worksheetNo);
	if (!Number.isInteger(ws) || ws < 1 || ws > set.worksheets) {
		throw new SheetError(`Worksheet ${worksheetNo} is out of range for set ${setId}`);
	}
	const v = Number(variant);
	if (!Number.isInteger(v) || v < 0 || v > 1e6) throw new SheetError("Invalid variant");
	if (!set.ready) throw new SheetError(`Set ${setId} is not available yet`, "not_ready");

	const gen = getGenerator(set.gen);
	if (!gen) throw new SheetError(`Generator ${set.gen} missing`, "not_ready");

	const seed = sheetSeed(levelId, setId, ws, v);
	const rng = createRng(seed);
	const problems = [];
	const seen = new Set();
	let guard = 0;
	while (problems.length < set.questions) {
		const p = gen(rng, set.params);
		// Avoid repeating a question within one sheet (small pools may still
		// repeat after 25 tries; that is preferable to an infinite loop).
		const key = problemKey(p);
		if (seen.has(key) && guard++ < 25) continue;
		// Self-check: a generator must accept its own answer.
		if (!checkAnswer(p.answer, p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value)) {
			throw new SheetError(`Generator ${set.gen} produced an answer that fails its own check`, "generator_bug");
		}
		seen.add(key);
		problems.push({ ...p, index: problems.length });
	}

	return {
		subject: level.subject,
		levelId,
		levelTitle: level.title,
		setId,
		setTitle: set.title,
		worksheetNo: ws,
		worksheets: set.worksheets,
		variant: v,
		seed,
		seedCode: seedCode(seed),
		targetSeconds: set.targetSeconds,
		lesson: set.lesson,
		problems,
	};
}

export function publicSheet(sheet) {
	return { ...sheet, problems: sheet.problems.map(stripAnswers) };
}

// Print copies use variants far away from the ones used in study so a printed
// "equivalent" sheet does not reveal the next study attempt's questions.
export const PRINT_VARIANT_BASE = 500000;
