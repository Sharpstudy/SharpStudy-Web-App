// Mastery rules: stars, status and progression. Pure functions.
//
// Every tunable product rule lives in RULES so it can be adjusted in one place
// once the full Mastery Ladder specification is confirmed. Values below are
// derived from the acceptance criteria:
//   8/8 in 1m50s on a 3-minute set -> 3 stars, mastered
//   8/8 in 2m40s                   -> 2 stars, mastered
//   8/8 in 3m10s                   -> 1 star,  practice-speed
//   7/8                            -> 0 stars, repeat
//   last worksheet 8/8             -> advance to next set
//   last worksheet 7/8             -> restart the set (exit-accuracy rule)
// Thresholds: mastery accuracy 0.9, exit accuracy 1.0, speed factor 1.0,
// brisk factor 0.7, target 180 s, 10 worksheets of 8 questions per set.

export const RULES = {
	questionsPerWorksheet: 8,
	worksheetsPerSet: 10,
	// Target completion time for every worksheet, in seconds.
	targetSeconds: 180,
	// First-attempt accuracy needed for a worksheet to count as passed
	// (with 8 questions this means 8/8: 7/8 = 0.875 is below 0.9).
	masteryAccuracy: 0.9,
	// Accuracy needed on the LAST worksheet of a set to exit the set. Missing it
	// sends the learner back to worksheet 1 of the set.
	exitAccuracy: 1.0,
	// Finishing within targetSeconds * speedFactor counts as "at speed" (mastered).
	speedFactor: 1.0,
	// Finishing within targetSeconds * briskFactor earns 3 stars.
	briskFactor: 0.7,
	// An accurate but slower-than-target result is "practice-speed": the learner
	// stays on the same worksheet (new numbers) until they beat the target time.
	requireSpeedToAdvance: true,
};

export const STATUS = {
	MASTERED: "mastered",
	PRACTICE_SPEED: "practice-speed",
	REPEAT: "repeat",
};

export const OUTCOME = {
	NEXT_WORKSHEET: "next-worksheet",
	NEXT_SET: "next-set",
	NEXT_LEVEL: "next-level",
	SUBJECT_COMPLETE: "subject-complete",
	REPEAT_WORKSHEET: "repeat-worksheet",
	RESTART_SET: "restart-set",
	REVIEW: "review", // attempt on an already-passed worksheet; no placement change
};

// Score a finished worksheet.
//   correctFirst: questions answered correctly on the first try
//   total:        questions on the sheet
//   durationSec:  elapsed seconds
//   targetSec:    target completion time for the set
export function scoreAttempt({ correctFirst, total, durationSec, targetSec }, rules = RULES) {
	if (!Number.isInteger(total) || total <= 0) throw new RangeError("total must be a positive integer");
	if (!Number.isInteger(correctFirst) || correctFirst < 0 || correctFirst > total) {
		throw new RangeError("correctFirst must be between 0 and total");
	}
	if (!(durationSec >= 0) || !(targetSec > 0)) throw new RangeError("invalid duration/target");
	const accuracy = correctFirst / total;
	if (accuracy < rules.masteryAccuracy) {
		return { accuracy, stars: 0, status: STATUS.REPEAT };
	}
	if (durationSec <= targetSec * rules.briskFactor + 1e-9) {
		return { accuracy, stars: 3, status: STATUS.MASTERED };
	}
	if (durationSec <= targetSec * rules.speedFactor + 1e-9) return { accuracy, stars: 2, status: STATUS.MASTERED };
	return { accuracy, stars: 1, status: STATUS.PRACTICE_SPEED };
}

// Decide the learner's next position after an attempt on their CURRENT worksheet.
//   position: { levelId, setId, worksheetNo }
//   ladder:   { worksheetsInSet(levelId, setId), nextSet(levelId, setId) -> {levelId, setId} | null }
export function decideProgression(position, score, ladder, rules = RULES) {
	const { levelId, setId, worksheetNo } = position;
	const lastNo = ladder.worksheetsInSet(levelId, setId);
	const isLast = worksheetNo >= lastNo;
	const passed =
		score.status === STATUS.MASTERED ||
		(score.status === STATUS.PRACTICE_SPEED && !rules.requireSpeedToAdvance);

	if (isLast && score.accuracy < rules.exitAccuracy) {
		return { outcome: OUTCOME.RESTART_SET, next: { levelId, setId, worksheetNo: 1 } };
	}
	if (!passed) {
		return { outcome: OUTCOME.REPEAT_WORKSHEET, next: { levelId, setId, worksheetNo } };
	}
	if (!isLast) {
		return { outcome: OUTCOME.NEXT_WORKSHEET, next: { levelId, setId, worksheetNo: worksheetNo + 1 } };
	}
	const nxt = ladder.nextSet(levelId, setId);
	if (!nxt) return { outcome: OUTCOME.SUBJECT_COMPLETE, next: { levelId, setId, worksheetNo }, complete: true };
	return {
		outcome: nxt.levelId === levelId ? OUTCOME.NEXT_SET : OUTCOME.NEXT_LEVEL,
		next: { levelId: nxt.levelId, setId: nxt.setId, worksheetNo: 1 },
	};
}

// Friendly next-action copy for the results screen.
export function nextActionLabel(outcome) {
	switch (outcome) {
		case OUTCOME.NEXT_WORKSHEET:
			return "Next worksheet unlocked";
		case OUTCOME.NEXT_SET:
			return "Set complete — next set unlocked!";
		case OUTCOME.NEXT_LEVEL:
			return "Level complete — next level unlocked!";
		case OUTCOME.SUBJECT_COMPLETE:
			return "You have finished every available level!";
		case OUTCOME.REPEAT_WORKSHEET:
			return "Let's try this worksheet again with new questions";
		case OUTCOME.RESTART_SET:
			return "The last worksheet needs every answer right first time — back to the start of this set";
		case OUTCOME.REVIEW:
			return "Review practice saved";
		default:
			return "";
	}
}
