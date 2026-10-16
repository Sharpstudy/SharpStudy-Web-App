import test from "node:test";
import assert from "node:assert/strict";

import { fnv1a, mulberry32, createRng, sheetSeed } from "../../lib/mastery/rng.js";
import { checkAnswer } from "../../lib/mastery/answers.js";
import { expressionsEquivalent } from "../../lib/mastery/expression.js";
import { scoreAttempt, decideProgression, STATUS, OUTCOME, RULES } from "../../lib/mastery/rules.js";
import {
	SUBJECTS,
	getLevel,
	ladder,
	ladderNav,
	isUnlocked,
	firstPosition,
	positionIndex,
} from "../../lib/mastery/curriculum.js";
import { generateSheet, publicSheet, SheetError } from "../../lib/mastery/sheet.js";
import { gradeResponses, GradingError } from "../../lib/mastery/grading.js";
import { computeStreak, habitGrid, localDate, bucketActivity } from "../../lib/mastery/habits.js";

const correctInput = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);

test("FNV-1a matches reference vectors", () => {
	assert.equal(fnv1a(""), 0x811c9dc5);
	assert.equal(fnv1a("a"), 0xe40c292c);
	assert.equal(fnv1a("foobar"), 0xbf9cf968);
});

test("mulberry32 is deterministic and in [0,1)", () => {
	const a = mulberry32(42);
	const b = mulberry32(42);
	for (let i = 0; i < 1000; i++) {
		const x = a();
		assert.equal(x, b());
		assert.ok(x >= 0 && x < 1);
	}
});

test("rng int/pick/shuffle are deterministic and bounded", () => {
	const r1 = createRng("seed");
	const r2 = createRng("seed");
	for (let i = 0; i < 500; i++) {
		const v = r1.int(3, 7);
		assert.equal(v, r2.int(3, 7));
		assert.ok(v >= 3 && v <= 7);
	}
	assert.deepEqual(r1.shuffle([1, 2, 3, 4, 5]), r2.shuffle([1, 2, 3, 4, 5]));
	const arr = [1, 2, 3];
	r1.shuffle(arr);
	assert.deepEqual(arr, [1, 2, 3], "shuffle must not mutate input");
	assert.equal(r1.pick(["x"]), "x");
	assert.throws(() => r1.int(5, 1));
	assert.throws(() => r1.pick([]));
});

test("identical seed produces identical worksheets", () => {
	const a = generateSheet("7A", "7A-2", 3, 0);
	const b = generateSheet("7A", "7A-2", 3, 0);
	assert.deepEqual(a, b);
	assert.equal(a.seed, sheetSeed("7A", "7A-2", 3, 0));
	const c = generateSheet("7A", "7A-2", 3, 1);
	assert.notDeepEqual(a.problems, c.problems, "different variant should differ");
});

test("every ready set generates valid, self-consistent sheets", () => {
	let sets = 0;
	for (const subj of SUBJECTS) {
		for (const lv of subj.levels) {
			for (const set of lv.sets) {
				if (!set.ready) {
					assert.throws(() => generateSheet(lv.id, set.id, 1, 0), (e) => e instanceof SheetError && e.code === "not_ready");
					continue;
				}
				sets++;
				for (let ws = 1; ws <= set.worksheets; ws++) {
					for (let v = 0; v < 6; v++) {
						const sheet = generateSheet(lv.id, set.id, ws, v);
						assert.equal(sheet.problems.length, 8);
						for (const p of sheet.problems) {
							assert.ok(p.text && p.text.length > 0, `${set.id} text`);
							assert.ok(checkAnswer(p.answer, correctInput(p)), `${set.id} answer self-check: ${p.text}`);
							if (p.type === "choice") {
								assert.ok(p.choices.some((c) => c.label === p.answer.value));
								assert.equal(new Set(p.choices.map((c) => c.text)).size, p.choices.length);
							}
						}
					}
				}
			}
		}
	}
	assert.ok(sets > 60, `expected many ready sets, got ${sets}`);
});

test("curriculum covers required levels", () => {
	const math = ["7A", "6A", "5A", "4A", "3A", "2A", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"];
	const eng = ["E7A", "E6A", "E5A", "E4A", "E3A", "E2A", "EA", "EB", "EC"];
	const ph = ["PH1", "PH2", "PH3", "PH4", "PH5", "PH6", "PH7"];
	const ch = ["CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7"];
	for (const [subject, ids] of [["math", math], ["english", eng], ["physics", ph], ["chemistry", ch]]) {
		for (const id of ids) {
			const lv = getLevel(id);
			assert.ok(lv, `missing level ${id}`);
			assert.equal(lv.subject, subject);
		}
	}
	// Every required level must be fully implemented: every set has a working generator.
	for (const id of [...math, ...eng, ...ph, ...ch]) {
		assert.ok(getLevel(id).sets.length > 0, `${id} has sets`);
		assert.ok(getLevel(id).sets.every((s) => s.ready && s.gen), `${id} must be fully implemented`);
	}
});

test("public sheet strips answers and solutions", () => {
	const pub = publicSheet(generateSheet("C", "C-5", 1, 0));
	for (const p of pub.problems) {
		assert.equal(p.answer, undefined);
		assert.equal(p.solution, undefined);
	}
});

test("rejects unknown/out-of-range sheets", () => {
	assert.throws(() => generateSheet("ZZ", "ZZ-1", 1, 0), SheetError);
	assert.throws(() => generateSheet("7A", "6A-1", 1, 0), SheetError);
	assert.throws(() => generateSheet("7A", "7A-1", 0, 0), SheetError);
	assert.throws(() => generateSheet("7A", "7A-1", 99, 0), SheetError);
	assert.throws(() => generateSheet("7A", "7A-1", 1, -1), SheetError);
});

// ---- answer checking ----

test("integer answers", () => {
	const a = { kind: "integer", value: "1200" };
	assert.ok(checkAnswer(a, "1200"));
	assert.ok(checkAnswer(a, " 1,200 "));
	assert.ok(checkAnswer(a, "+1200"));
	assert.ok(!checkAnswer(a, "1200.5"));
	assert.ok(!checkAnswer(a, "12,00"));
	assert.ok(!checkAnswer(a, ""));
	assert.ok(checkAnswer({ kind: "integer", value: "-5" }, "−5"), "unicode minus");
});

test("decimal answers are exact", () => {
	const a = { kind: "decimal", value: "0.5" };
	assert.ok(checkAnswer(a, "0.5"));
	assert.ok(checkAnswer(a, ".50"));
	assert.ok(!checkAnswer(a, "0.49999"));
	assert.ok(!checkAnswer(a, "1/2"), "decimal questions want decimal notation");
	assert.ok(checkAnswer({ kind: "decimal", value: "18" }, "18.0"));
});

test("fraction answers with simplest form", () => {
	const a = { kind: "fraction", value: "3/4", simplest: true };
	assert.ok(checkAnswer(a, "3/4"));
	assert.ok(checkAnswer(a, "3 / 4"));
	assert.ok(!checkAnswer(a, "6/8"), "must be simplified");
	assert.ok(checkAnswer({ kind: "fraction", value: "3/4" }, "6/8"), "equivalent ok when not required simplest");
	const improper = { kind: "fraction", value: "5/4", simplest: true };
	assert.ok(checkAnswer(improper, "5/4"));
	assert.ok(checkAnswer(improper, "1 1/4"), "mixed number");
	assert.ok(!checkAnswer(improper, "1 2/8"));
	const whole = { kind: "fraction", value: "1", simplest: true };
	assert.ok(checkAnswer(whole, "1"));
	assert.ok(!checkAnswer(whole, "4/4"));
	assert.ok(!checkAnswer(a, "3/0"));
});

test("text, choice and multi answers", () => {
	assert.ok(checkAnswer({ kind: "text", value: "Children" }, " children "));
	assert.ok(checkAnswer({ kind: "text", value: "small", accept: ["little"] }, "Little"));
	assert.ok(!checkAnswer({ kind: "text", value: "mice" }, "mouses"));
	assert.ok(checkAnswer({ kind: "choice", value: "B" }, "b"));
	assert.ok(!checkAnswer({ kind: "choice", value: "B" }, "A"));
	const ordered = { kind: "multi", parts: [{ kind: "integer", value: "7" }, { kind: "integer", value: "2" }] };
	assert.ok(checkAnswer(ordered, ["7", "2"]));
	assert.ok(!checkAnswer(ordered, ["2", "7"]));
	assert.ok(!checkAnswer(ordered, ["7"]));
	const unordered = { ...ordered, ordered: false };
	assert.ok(checkAnswer(unordered, ["2", "7"]));
	assert.ok(!checkAnswer({ ...unordered, parts: [{ kind: "integer", value: "3" }, { kind: "integer", value: "3" }] }, ["3", "4"]));
});

test("expression equivalence without eval", () => {
	assert.ok(expressionsEquivalent("x^2+5x+6", "(x+2)(x+3)"));
	assert.ok(expressionsEquivalent("2(x+1)", "2x+2"));
	assert.ok(expressionsEquivalent("x²-1", "(x-1)(x+1)"));
	assert.ok(expressionsEquivalent("xy", "y*x"));
	assert.ok(expressionsEquivalent("x/2", "0.5x"));
	assert.ok(!expressionsEquivalent("x+1", "x+2"));
	const expand = { kind: "expression", value: "x^2+5x+6", expanded: true, simplified: true };
	assert.ok(checkAnswer(expand, "x^2 + 5x + 6"));
	assert.ok(checkAnswer(expand, "6 + 5x + x²"));
	assert.ok(!checkAnswer(expand, "(x+2)(x+3)"), "expanded form required");
	assert.ok(!checkAnswer(expand, "x^2+2x+3x+6"), "like terms must be collected");
	const simp = { kind: "expression", value: "6x", simplified: true };
	assert.ok(checkAnswer(simp, "6x"));
	assert.ok(!checkAnswer(simp, "3x+5x-2x"));
	// Unsafe or unsupported input is simply wrong, never evaluated.
	for (const bad of ["alert(1)", "process.exit()", "x/(x+1)", "x^99", "2^-1", "((((", "constructor", "1;2"]) {
		assert.equal(checkAnswer({ kind: "expression", value: "x" }, bad), false, bad);
	}
});

// ---- scoring & progression (acceptance criteria) ----

const ws = (n, last = false) => ({ levelId: "7A", setId: "7A-1", worksheetNo: last ? 10 : n });

test("8/8 in 1m50s on a 3-minute set -> 3 stars, mastered", () => {
	const s = scoreAttempt({ correctFirst: 8, total: 8, durationSec: 110, targetSec: 180 });
	assert.deepEqual([s.stars, s.status], [3, STATUS.MASTERED]);
});
test("8/8 in 2m40s -> 2 stars, mastered", () => {
	const s = scoreAttempt({ correctFirst: 8, total: 8, durationSec: 160, targetSec: 180 });
	assert.deepEqual([s.stars, s.status], [2, STATUS.MASTERED]);
});
test("8/8 in 3m10s -> 1 star, practice-speed", () => {
	const s = scoreAttempt({ correctFirst: 8, total: 8, durationSec: 190, targetSec: 180 });
	assert.deepEqual([s.stars, s.status], [1, STATUS.PRACTICE_SPEED]);
});
test("7/8 -> 0 stars, repeat", () => {
	const s = scoreAttempt({ correctFirst: 7, total: 8, durationSec: 60, targetSec: 180 });
	assert.deepEqual([s.stars, s.status], [0, STATUS.REPEAT]);
});

test("progression: mid-set pass advances, fail repeats", () => {
	const pass = scoreAttempt({ correctFirst: 8, total: 8, durationSec: 100, targetSec: 180 });
	const fail = scoreAttempt({ correctFirst: 7, total: 8, durationSec: 100, targetSec: 180 });
	assert.deepEqual(decideProgression(ws(2), pass, ladderNav).next, { levelId: "7A", setId: "7A-1", worksheetNo: 3 });
	const r = decideProgression(ws(2), fail, ladderNav);
	assert.equal(r.outcome, OUTCOME.REPEAT_WORKSHEET);
	assert.equal(r.next.worksheetNo, 2);
});

test("last worksheet 8/8 advances to the next set", () => {
	const pass = scoreAttempt({ correctFirst: 8, total: 8, durationSec: 100, targetSec: 180 });
	const r = decideProgression(ws(5, true), pass, ladderNav);
	assert.equal(r.outcome, OUTCOME.NEXT_SET);
	assert.deepEqual(r.next, { levelId: "7A", setId: "7A-2", worksheetNo: 1 });
});

test("last worksheet 7/8 restarts the set (exit-accuracy rule)", () => {
	const fail = scoreAttempt({ correctFirst: 7, total: 8, durationSec: 100, targetSec: 180 });
	const r = decideProgression(ws(5, true), fail, ladderNav);
	assert.equal(r.outcome, OUTCOME.RESTART_SET);
	assert.deepEqual(r.next, { levelId: "7A", setId: "7A-1", worksheetNo: 1 });
});

test("last set of a level advances to the next level; end of ladder completes", () => {
	const pass = scoreAttempt({ correctFirst: 8, total: 8, durationSec: 10, targetSec: 180 });
	const r = decideProgression({ levelId: "7A", setId: "7A-5", worksheetNo: 10 }, pass, ladderNav);
	assert.equal(r.outcome, OUTCOME.NEXT_LEVEL);
	assert.deepEqual(r.next, { levelId: "6A", setId: "6A-1", worksheetNo: 1 });
	const lastMath = ladder("math").at(-1);
	const end = decideProgression({ levelId: lastMath.levelId, setId: lastMath.id, worksheetNo: 10 }, pass, ladderNav);
	assert.equal(end.outcome, OUTCOME.SUBJECT_COMPLETE);
});

test("practice-speed stays on the same worksheet until the target time is beaten", () => {
	const slow = scoreAttempt({ correctFirst: 8, total: 8, durationSec: 999, targetSec: 180 });
	assert.equal(slow.status, STATUS.PRACTICE_SPEED);
	const r = decideProgression(ws(1), slow, ladderNav);
	assert.equal(r.outcome, OUTCOME.REPEAT_WORKSHEET);
	assert.equal(r.next.worksheetNo, 1);
	// On the last worksheet a slow-but-perfect result also repeats (it does not exit the set).
	assert.equal(decideProgression(ws(10, true), slow, ladderNav).outcome, OUTCOME.REPEAT_WORKSHEET);
	// The relaxed rule remains available through RULES.
	assert.equal(decideProgression(ws(1), slow, ladderNav, { ...RULES, requireSpeedToAdvance: false }).outcome, OUTCOME.NEXT_WORKSHEET);
});

test("spec constants: 10 worksheets x 8 questions, 180 s target, thresholds 0.9 / 1.0, speed 1.0, brisk 0.7", () => {
	assert.equal(RULES.worksheetsPerSet, 10);
	assert.equal(RULES.questionsPerWorksheet, 8);
	assert.equal(RULES.targetSeconds, 180);
	assert.equal(RULES.masteryAccuracy, 0.9);
	assert.equal(RULES.exitAccuracy, 1.0);
	assert.equal(RULES.speedFactor, 1.0);
	assert.equal(RULES.briskFactor, 0.7);
	for (const subj of SUBJECTS) for (const lv of subj.levels) for (const set of lv.sets) {
		assert.equal(set.worksheets, 10);
		assert.equal(set.targetSeconds, 180);
	}
	// Boundaries: 126 s (= 0.7 * 180) is brisk, 180 s is at speed, 181 s is practice-speed.
	assert.equal(scoreAttempt({ correctFirst: 8, total: 8, durationSec: 126, targetSec: 180 }).stars, 3);
	assert.equal(scoreAttempt({ correctFirst: 8, total: 8, durationSec: 126.5, targetSec: 180 }).stars, 2);
	assert.equal(scoreAttempt({ correctFirst: 8, total: 8, durationSec: 180, targetSec: 180 }).status, STATUS.MASTERED);
	assert.equal(scoreAttempt({ correctFirst: 8, total: 8, durationSec: 181, targetSec: 180 }).status, STATUS.PRACTICE_SPEED);
});


test("unlock rules follow ladder order", () => {
	const cur = { levelId: "7A", setId: "7A-2", worksheetNo: 3 };
	assert.ok(isUnlocked("math", { levelId: "7A", setId: "7A-1", worksheetNo: 10 }, cur));
	assert.ok(isUnlocked("math", { levelId: "7A", setId: "7A-2", worksheetNo: 3 }, cur));
	assert.ok(!isUnlocked("math", { levelId: "7A", setId: "7A-2", worksheetNo: 4 }, cur));
	assert.ok(!isUnlocked("math", { levelId: "C", setId: "C-1", worksheetNo: 1 }, cur));
	assert.ok(!isUnlocked("math", { levelId: "ZZ", setId: "ZZ-1", worksheetNo: 1 }, { levelId: "7A", setId: "7A-1", worksheetNo: 1 }), "unknown sets are never unlocked");
	assert.equal(positionIndex("english", cur), -1, "position from another subject is invalid");
	assert.deepEqual(firstPosition("math"), { levelId: "7A", setId: "7A-1", worksheetNo: 1 });
});

// ---- grading ----

test("server grading counts first attempts and requires correction", () => {
	const sheet = generateSheet("3A", "3A-1", 1, 0);
	const right = sheet.problems.map((p) => [correctInput(p)]);
	assert.equal(gradeResponses(sheet, right).correctFirst, 8);
	const oneWrong = right.map((r, i) => (i === 0 ? ["wrong", r[0]] : r));
	const g = gradeResponses(sheet, oneWrong);
	assert.equal(g.correctFirst, 7);
	assert.equal(g.perQuestion[0].tries, 2);
	const uncorrected = right.map((r, i) => (i === 0 ? ["wrong"] : r));
	assert.throws(() => gradeResponses(sheet, uncorrected), (e) => e instanceof GradingError && e.code === "incomplete");
	assert.throws(() => gradeResponses(sheet, right.slice(0, 7)), GradingError);
	assert.throws(() => gradeResponses(sheet, "all correct"), GradingError);
});

// ---- habits ----

test("local dates respect family time zone", () => {
	const t = Date.UTC(2026, 0, 15, 3, 30); // 03:30 UTC
	assert.equal(localDate(t, "UTC"), "2026-01-15");
	assert.equal(localDate(t, "America/Vancouver"), "2026-01-14");
	assert.equal(localDate(t, "Asia/Kolkata"), "2026-01-15");
	assert.equal(localDate(t, "Not/AZone"), "2026-01-15", "invalid zone falls back to UTC");
});

test("streaks and habit grid", () => {
	const act = [
		{ date: "2026-01-10", worksheets: 2 },
		{ date: "2026-01-11", worksheets: 1 },
		{ date: "2026-01-12", worksheets: 3 },
		{ date: "2026-01-13", worksheets: 2 },
	];
	assert.deepEqual(computeStreak(act, "2026-01-13", 2), { current: 2, longest: 2, todayMet: true });
	assert.deepEqual(computeStreak(act, "2026-01-14", 1), { current: 4, longest: 4, todayMet: false });
	assert.equal(computeStreak(act, "2026-01-16", 1).current, 0);
	const grid = habitGrid(act, "2026-01-13", 1);
	assert.equal(grid.length, 21);
	assert.equal(grid.at(-1).date, "2026-01-13");
	assert.ok(grid.at(-1).met && grid.at(-1).isToday);
	const weeks = bucketActivity(act, "2026-01-13", "week", 2);
	assert.equal(weeks.length, 2);
	assert.equal(weeks.reduce((s, w) => s + w.worksheets, 0), 8);
	const months = bucketActivity(act, "2026-01-13", "month", 3);
	assert.deepEqual(months.map((m) => m.label), ["2025-11", "2025-12", "2026-01"]);
});

test("diagram labels never announce the answer of counting questions", () => {
	for (const [lv, set] of [["7A", "7A-1"], ["7A", "7A-3"], ["7A", "7A-4"], ["7A", "7A-5"], ["6A", "6A-1"]]) {
		const sheet = generateSheet(lv, set, 1, 0);
		for (const p of sheet.problems) {
			const n = p.scene.count;
			assert.ok(!new RegExp(`\b${n}\b`).test(p.scene.label), `${set}: label "${p.scene.label}" reveals ${n}`);
			assert.equal(p.scene.label.split(",").length, n, "one spoken item per object");
		}
	}
});
