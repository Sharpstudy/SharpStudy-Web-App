import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createOfflineStore, newClientAttemptId, MAX_SYNC_TRIES } from "../../lib/mastery/offline.js";
import { createMemoryRepo } from "./memoryRepo.mjs";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";

const memStorage = () => {
	const m = new Map();
	return {
		getJSON: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f),
		setJSON: (k, v) => m.set(k, JSON.stringify(v)),
		remove: (k) => m.delete(k),
	};
};
const right = (p) => (p.answer.kind === "multi" ? p.answer.parts.map((x) => x.value) : p.answer.value);

test("client attempt ids are unique v4 UUIDs", () => {
	const ids = new Set(Array.from({ length: 500 }, newClientAttemptId));
	assert.equal(ids.size, 500);
	for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("in-progress worksheets persist per learner", () => {
	const store = createOfflineStore(memStorage());
	store.saveInProgress("L1", { index: 3 });
	assert.equal(store.loadInProgress("L1").index, 3);
	assert.equal(store.loadInProgress("L2"), null);
	store.clearInProgress("L1");
	assert.equal(store.loadInProgress("L1"), null);
});

test("offline attempts synchronise without duplicates", async () => {
	const repo = createMemoryRepo();
	repo._db.users.push({ id: "p1", email: "p@example.com", role: "student" });
	const parent = { kind: "account", userId: "p1", role: "student", permissions: resolvePermissions("student", ["learners.create"]) };
	const kid = await svc.createLearner(repo, parent, { displayName: "Mo", pin: "1111" });
	const actor = { kind: "learner", learnerId: kid.id, accountUserId: "p1" };
	const store = createOfflineStore(memStorage());

	// Two worksheets completed while offline.
	for (let n = 0; n < 2; n++) {
		const s = await svc.startWorksheet(repo, actor, { subject: "math", levelId: "7A", setId: "7A-1", worksheetNo: 1 });
		store.enqueue({ learnerId: kid.id, startToken: s.startToken, clientAttemptId: newClientAttemptId(), responses: s.sheet.problems.map((p) => [right(p)]), durationMs: 60000 });
	}
	// Enqueue the same item twice: ignored.
	const first = store.queue()[0];
	store.enqueue(first);
	assert.equal(store.queue().length, 2);

	// Still offline: network errors keep items queued, in order.
	const offlineSend = async () => {
		throw { status: 0, code: "network" };
	};
	let r = await store.sync(offlineSend);
	assert.equal(r.sent, 0);
	assert.equal(store.queue().length, 2);

	// Back online, but the first response is lost after the server stored it
	// (simulates a dropped connection). The retry must not duplicate.
	let calls = 0;
	const flakySend = async (item) => {
		calls++;
		const res = await svc.submitAttempt(repo, actor, item);
		if (calls === 1) throw { status: 0, code: "network" };
		return res;
	};
	r = await store.sync(flakySend);
	assert.equal(r.sent, 0);
	r = await store.sync(flakySend);
	assert.equal(r.sent, 2);
	assert.equal(store.queue().length, 0);
	assert.equal(repo._db.attempts.length, 2, "exactly one row per client attempt");
	assert.equal(repo._db.activity[0].worksheets, 2);
	assert.equal(r.results[0].result.duplicate, true, "retried item is recognised as already stored");

	// Both attempts were for worksheet 1: only the first advances placement.
	assert.equal((await repo.getProgress(kid.id, "math")).worksheet_no, 2);
	assert.deepEqual(repo._db.attempts.map((a) => a.outcome).sort(), ["next-worksheet", "review"]);

	// Syncing again is a no-op.
	r = await store.sync(flakySend);
	assert.equal(r.sent, 0);
	assert.equal(repo._db.attempts.length, 2);
});

test("permanently rejected items are dropped and reported; transient ones retried with a cap", async () => {
	const store = createOfflineStore(memStorage());
	store.enqueue({ clientAttemptId: "bad-item-000001" });
	store.enqueue({ clientAttemptId: "good-item-00001" });
	const r = await store.sync(async (item) => {
		if (item.clientAttemptId.startsWith("bad")) throw { status: 422, code: "incomplete", message: "nope" };
		return { ok: true };
	});
	assert.equal(r.failed.length, 1);
	assert.equal(r.sent, 1);
	assert.equal(store.queue().length, 0);

	store.enqueue({ clientAttemptId: "server-down-0001" });
	for (let i = 0; i < MAX_SYNC_TRIES; i++) await store.sync(async () => { throw { status: 503, code: "server_error" }; });
	assert.equal(store.queue().length, 0, "gives up after the retry cap");
	store.enqueue({ clientAttemptId: "offline-forever1" });
	for (let i = 0; i < MAX_SYNC_TRIES + 3; i++) await store.sync(async () => { throw { status: 0, code: "network" }; });
	assert.equal(store.queue().length, 1, "never drops work just because the device is offline");
});
