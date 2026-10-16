// Grades a completed worksheet from the raw answer log. The server always
// re-runs this against a freshly regenerated sheet, so client-reported scores
// are never trusted.
//
// responses[i] = every answer the learner entered for question i, in order:
//   ["12", "13"]           scalar question (first try wrong, corrected)
//   [["4", "2"]]           multi-part question, one array per try

import { checkAnswer, MAX_INPUT_LENGTH } from "./answers.js";

export const MAX_TRIES_PER_QUESTION = 30;

export class GradingError extends Error {
	constructor(message, code = "invalid_responses") {
		super(message);
		this.code = code;
	}
}

const cleanTry = (t, multi) => {
	if (multi) {
		if (!Array.isArray(t) || t.length > 10) throw new GradingError("Multi-part answers must be arrays");
		return t.map((x) => String(x == null ? "" : x).slice(0, MAX_INPUT_LENGTH));
	}
	if (Array.isArray(t) || (typeof t === "object" && t !== null)) throw new GradingError("Answer must be a string");
	return String(t == null ? "" : t).slice(0, MAX_INPUT_LENGTH);
};

export function gradeResponses(sheet, responses) {
	const problems = sheet.problems;
	if (!Array.isArray(responses) || responses.length !== problems.length) {
		throw new GradingError(`Expected answers for ${problems.length} questions`);
	}
	let correctFirst = 0;
	const perQuestion = problems.map((p, i) => {
		const tries = responses[i];
		if (!Array.isArray(tries) || tries.length === 0 || tries.length > MAX_TRIES_PER_QUESTION) {
			throw new GradingError(`Question ${i + 1} has no answers`, "incomplete");
		}
		const multi = p.answer.kind === "multi";
		const clean = tries.map((t) => cleanTry(t, multi));
		const firstCorrect = checkAnswer(p.answer, clean[0]);
		const finalCorrect = checkAnswer(p.answer, clean[clean.length - 1]);
		if (!finalCorrect) {
			// Worksheets are only complete once every question has been corrected.
			throw new GradingError(`Question ${i + 1} was never answered correctly`, "incomplete");
		}
		if (firstCorrect) correctFirst++;
		return { firstCorrect, tries: clean.length, first: clean[0] };
	});
	return { total: problems.length, correctFirst, perQuestion };
}
