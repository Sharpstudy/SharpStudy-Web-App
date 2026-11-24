import test from "node:test";
import assert from "node:assert/strict";
import { supportAreas } from "../../lib/mastery/insights.js";

// attempts are newest first, as returned by the dashboard query
const att = (o) => ({ subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1, accuracy: 1, status: "mastered", outcome: "next-worksheet", counted: true, hintsUsed: 0, ...o });

test("no attempts -> nothing flagged", () => {
	assert.deepEqual(supportAreas([]), []);
});

test("successful attempts -> nothing flagged", () => {
	assert.deepEqual(supportAreas([att({ worksheetNo: 3 }), att({ worksheetNo: 2 }), att({ worksheetNo: 1 })]), []);
});

test("a single unsuccessful attempt is insufficient data", () => {
	assert.deepEqual(supportAreas([att({ accuracy: 0.5, status: "repeat", outcome: "repeat-worksheet" })]), []);
});

test("repeated unsuccessful attempts on one worksheet are flagged with a reason and location", () => {
	const r = supportAreas([
		att({ accuracy: 0.75, status: "repeat", outcome: "repeat-worksheet" }),
		att({ accuracy: 0.875, status: "repeat", outcome: "repeat-worksheet" }),
	]);
	assert.equal(r.length, 1);
	assert.deepEqual([r[0].subject, r[0].setId, r[0].worksheetNo], ["math", "7A-1", 1]);
	assert.ok(r[0].reasons.some((x) => /2 repeat attempts/.test(x)));
	assert.ok(r[0].reasons.some((x) => /accuracy/.test(x)), "accuracy below the 0.9 mastery bar is explained");
});

test("slow-but-accurate attempts (practice-speed) also count as not mastered", () => {
	const r = supportAreas([att({ status: "practice-speed" }), att({ status: "practice-speed" })]);
	assert.equal(r.length, 1);
});

test("heavy hint use is flagged; review practice and other sets are not mixed in", () => {
	const r = supportAreas([
		att({ setId: "7A-2", hintsUsed: 4 }),
		att({ setId: "7A-2", hintsUsed: 5, worksheetNo: 2 }),
		att({ setId: "7A-1", outcome: "review", counted: false, accuracy: 0.1, status: "repeat" }),
		att({ setId: "7A-1", outcome: "review", counted: false, accuracy: 0.1, status: "repeat" }),
	]);
	assert.deepEqual(r.map((x) => x.setId), ["7A-2"]);
});

test("results are limited and ranked", () => {
	const many = [];
	for (let i = 1; i <= 8; i++) many.push(att({ setId: `7A-${i}`, status: "repeat", accuracy: 0.5 }), att({ setId: `7A-${i}`, status: "repeat", accuracy: 0.5 }));
	assert.equal(supportAreas(many).length, 5);
});
