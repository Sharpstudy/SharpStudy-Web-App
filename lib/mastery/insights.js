// Where does a learner need more support? Pure function over recent attempts
// (as returned by attemptResult in service.js), newest first.
//
// A worksheet/set is flagged when, in the recent history:
//   - the same worksheet needed 2+ attempts that were not mastered, or
//   - accuracy over the last 3 attempts in the set is below the mastery bar, or
//   - hints averaged 3+ per worksheet in the set.
import { RULES } from "./rules.js";

export function supportAreas(attempts, { limit = 5 } = {}) {
	const bySet = new Map();
	for (const a of attempts) {
		if (!a.counted && a.outcome === "review") continue; // review practice does not count against the learner
		const key = `${a.subject}|${a.setId}`;
		if (!bySet.has(key)) bySet.set(key, []);
		bySet.get(key).push(a);
	}
	const out = [];
	for (const list of bySet.values()) {
		const first = list[0];
		const reasons = [];
		const byWs = new Map();
		for (const a of list) if (a.status !== "mastered") byWs.set(a.worksheetNo, (byWs.get(a.worksheetNo) || 0) + 1);
		const stuck = [...byWs.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1])[0];
		if (stuck) reasons.push(`worksheet ${stuck[0]} needed ${stuck[1]} repeat attempts`);
		const last3 = list.slice(0, 3);
		const avg = last3.reduce((s, a) => s + a.accuracy, 0) / last3.length;
		if (last3.length >= 2 && avg < RULES.masteryAccuracy) reasons.push(`recent accuracy ${Math.round(avg * 100)}%`);
		const hints = list.reduce((s, a) => s + (a.hintsUsed || 0), 0) / list.length;
		if (list.length >= 2 && hints >= 3) reasons.push(`about ${Math.round(hints)} hints per worksheet`);
		if (reasons.length) {
			out.push({
				subject: first.subject,
				levelId: first.levelId,
				setId: first.setId,
				worksheetNo: stuck ? stuck[0] : first.worksheetNo,
				reasons,
				score: reasons.length * 10 + (stuck ? stuck[1] : 0),
			});
		}
	}
	return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...rest }) => rest); // eslint-disable-line no-unused-vars
}
