import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createMemoryRepo } from "./memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { generateSheet, PRINT_VARIANT_BASE, problemKey } from "../../lib/mastery/sheet.js";
import { reminderIcs } from "../../lib/mastery/calendar.js";

// Accounts named parent* model family accounts that hold the "Family" role (learners.create).
const account = (userId, role = "student", extra = /^(parent|p[0-9])/.test(userId) ? ["learners.create"] : []) => ({ kind: "account", userId, role, permissions: resolvePermissions(role, extra) });

async function setup() {
	const repo = createMemoryRepo();
	repo._db.users.push({ id: "p1", email: "p@example.com", role: "student" }, { id: "t1", email: "t@example.com", role: "instructor" }, { id: "x", email: "x@example.com", role: "student" });
	const kid = await svc.createLearner(repo, account("p1"), { displayName: "Ivy", pin: "8642" });
	return { repo, kid, kidActor: { kind: "learner", learnerId: kid.id, accountUserId: "p1" } };
}
const ws = (n, set = "7A-1", level = "7A") => ({ subject: "math", levelId: level, setId: set, worksheetNo: n });

test("print uses the same deterministic generator as study", async () => {
	const { repo, kid } = await setup();
	const r = await svc.printSheets(repo, account("p1"), { learnerId: kid.id, ...ws(1), copies: 2 });
	assert.equal(r.sheets.length, 2);
	const ref = generateSheet("7A", "7A-1", 1, PRINT_VARIANT_BASE);
	assert.equal(r.sheets[0].seed, ref.seed);
	assert.deepEqual(r.sheets[0].problems.map(problemKey), ref.problems.map(problemKey));
	assert.notDeepEqual(r.sheets[0].problems.map(problemKey), r.sheets[1].problems.map(problemKey), "variants differ");
	assert.ok(r.sheets[0].problems.every((p) => p.answer === undefined), "no answers without a key");
	assert.equal(r.sheets[0].answerKey, null);
	assert.equal(r.learnerName, "Ivy");
});

test("locked worksheets cannot be printed", async () => {
	const { repo, kid, kidActor } = await setup();
	await assert.rejects(svc.printSheets(repo, account("p1"), { learnerId: kid.id, ...ws(2) }), { code: "locked" });
	await assert.rejects(svc.printSheets(repo, kidActor, ws(3)), { code: "locked" });
	await assert.rejects(svc.printSheets(repo, account("x"), { learnerId: kid.id, ...ws(1) }), { status: 404 });
	await assert.rejects(svc.printSheets(repo, account("p1"), ws(1)), { status: 403 }, "parents print for a learner");
	await assert.rejects(svc.printSheets(repo, account("p1"), { learnerId: kid.id, ...ws(1, "ZZ-1", "ZZ") }), { status: 404 }, "not-ready sets");
	// Instructors may print any ready worksheet (curriculum.print_any)
	const t = await svc.printSheets(repo, account("t1", "instructor"), { ...ws(1, "C-2", "C"), answerKey: true });
	assert.equal(t.sheets[0].answerKey.length, 8);
});

test("answer keys and prefilled copies are adult-only", async () => {
	const { repo, kid, kidActor } = await setup();
	await assert.rejects(svc.printSheets(repo, kidActor, { ...ws(1), answerKey: true }), { status: 403 });
	await assert.rejects(svc.printSheets(repo, kidActor, { ...ws(1), prefilled: true }), { status: 403 });
	const ok = await svc.printSheets(repo, kidActor, ws(1));
	assert.equal(ok.sheets.length, 1);
	const adult = await svc.printSheets(repo, account("p1"), { learnerId: kid.id, ...ws(1), answerKey: true, prefilled: true });
	assert.ok(adult.sheets[0].answerKey[0].answer);
	assert.ok(adult.sheets[0].problems[0].filled);
	await svc.setAdultMode(repo, account("p1"), kid.id, true);
	const selfKey = await svc.printSheets(repo, kidActor, { ...ws(1), answerKey: true });
	assert.ok(selfKey.sheets[0].answerKey);
});

test("calendar reminder is a valid daily iCalendar event", () => {
	const ics = reminderIcs({ learnerId: "L1", learnerName: "Ivy, Jr.", timeZone: "America/Vancouver", reminderTime: "17:30", startDate: "2026-10-12", dailyGoal: 2, url: "https://example.com/study/", now: new Date(Date.UTC(2026, 9, 12)) });
	assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
	assert.match(ics, /DTSTART;TZID=America\/Vancouver:20261012T173000/);
	assert.match(ics, /RRULE:FREQ=DAILY/);
	assert.match(ics, /SUMMARY:Ivy\\, Jr\.: SharpStudy practice/);
	assert.ok(ics.split("\r\n").every((l) => l.length <= 75));
	assert.match(ics, /END:VCALENDAR\r\n$/);
});
