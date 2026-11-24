// Answer checking. Pure functions shared by the worksheet player (instant
// feedback) and the server (authoritative re-grading of submitted attempts).
//
// Answer shapes (problem.answer):
//   { kind: "integer", value: "12" }
//   { kind: "decimal", value: "0.25" }                     exact decimal value
//   { kind: "fraction", value: "3/4", simplest?: true }    simplest = must be in lowest terms
//   { kind: "text", value: "cats", accept?: ["..."], caseSensitive?: false }
//   { kind: "choice", value: "B" }                         value is the correct choice label
//   { kind: "multi", parts: [Answer, ...], ordered?: true } one input per part
//   { kind: "expression", value: "x^2+3x+2", expanded?: true, simplified?: true }
//     expanded   = no brackets allowed; simplified = like terms must be collected

import { parseInteger, parseDecimal, parseFractionDetailed } from "./rational.js";
import { parsePolynomial, canonical, countWrittenTerms, ExpressionError } from "./expression.js";

export const MAX_INPUT_LENGTH = 160;

export function normalizeInput(raw) {
	if (raw === null || raw === undefined) return "";
	return String(raw)
		.slice(0, MAX_INPUT_LENGTH)
		.replace(/[−–]/g, "-") // unicode minus / en dash
		.replace(/⁄/g, "/") // fraction slash
		.replace(/\s+/g, " ")
		.trim();
}

const normText = (s, caseSensitive) => {
	const t = normalizeInput(s).replace(/[.!?]+$/, "");
	return caseSensitive ? t : t.toLowerCase();
};

function checkScalar(answer, input) {
	const s = normalizeInput(input);
	if (s === "") return false;
	switch (answer.kind) {
		case "integer": {
			const got = parseInteger(s);
			return !!got && got.eq(parseInteger(answer.value));
		}
		case "decimal": {
			const got = parseDecimal(s);
			return !!got && got.eq(parseDecimal(answer.value));
		}
		case "fraction": {
			const got = parseFractionDetailed(s);
			const want = parseFractionDetailed(answer.value);
			if (!got || !want) return false;
			if (!got.value.eq(want.value)) return false;
			if (answer.simplest && !got.simplest && !got.value.isInteger()) return false;
			if (answer.simplest && got.value.isInteger() && s.includes("/")) return false; // "4/2" when 2 expected
			return true;
		}
		case "text": {
			const cs = !!answer.caseSensitive;
			const accepted = [answer.value, ...(answer.accept || [])].map((a) => normText(a, cs));
			return accepted.includes(normText(s, cs));
		}
		case "choice":
			return s.toUpperCase() === String(answer.value).toUpperCase();
		case "expression": {
			if (answer.expanded && /[()]/.test(s)) return false;
			try {
				const want = parsePolynomial(answer.value);
				if (canonical(parsePolynomial(s)) !== canonical(want)) return false;
				// "simplified": no more written terms than the simplest form has
				if (answer.simplified && countWrittenTerms(s) > Math.max(1, want.size)) return false;
				return true;
			} catch (e) {
				if (e instanceof ExpressionError) return false;
				throw e;
			}
		}
		default:
			return false;
	}
}

// `input` is a string for scalar kinds, and an array of strings for "multi".
export function checkAnswer(answer, input) {
	if (!answer) return false;
	if (answer.kind !== "multi") return checkScalar(answer, Array.isArray(input) ? input[0] : input);
	const parts = answer.parts || [];
	const given = Array.isArray(input) ? input : String(input || "").split(/[,;]/);
	if (given.length !== parts.length) return false;
	if (answer.ordered !== false) return parts.every((p, i) => checkScalar(p, given[i]));
	// Unordered: each given value must match a distinct part.
	const used = new Set();
	return given.every((g) => {
		const idx = parts.findIndex((p, i) => !used.has(i) && checkScalar(p, g));
		if (idx === -1) return false;
		used.add(idx);
		return true;
	});
}

// Human-readable answer for answer keys and results screens.
export function formatAnswer(answer) {
	if (!answer) return "";
	if (answer.kind === "multi") {
		return answer.parts
			.map((p, i) => (answer.labels && answer.labels[i] ? `${answer.labels[i]} = ${formatAnswer(p)}` : formatAnswer(p)))
			.join(", ");
	}
	return String(answer.display || answer.value);
}
