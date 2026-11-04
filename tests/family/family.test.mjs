// Family & child devices: setup, PIN, pairing, approval, revocation, child sign-in.
import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";

import { createFamilyRepo } from "./memoryRepo.mjs";
import * as fam from "../../lib/family/service.js";
import { redeemParentLink } from "../../lib/family/links.js";
import { parentCode } from "./helpers.mjs";
import { normalizeCode, CODE_ALPHABET, generateCode, deviceLabel, hashCode } from "../../lib/family/codes.js";
import * as svc from "../../lib/mastery/service.js";
import { resolvePermissions } from "../../lib/mastery/policy.js";
import { verifyLearnerToken, verifyGrownupToken } from "../../lib/mastery/tokens.js";
import bcrypt from "bcrypt";

const account = (userId, role = "student", extra = []) => ({ kind: "account", userId, role, permissions: resolvePermissions(role, extra) });
const T0 = Date.parse("2026-10-23T10:00:00Z");
const ctx = (t = T0, extra = {}) => ({ now: t, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1", ...extra });
const MIN = 60000;

// Learner profiles are created by an instructor (the existing createLearner); parents are then linked with a code.
async function setup() {
	const repo = createFamilyRepo();
	repo._db.users.push(
		{ id: "t1", email: "t1@example.com", role: "instructor", status: true },
		{ id: "p1", email: "p1@example.com", role: "student", status: true },
		{ id: "p2", email: "p2@example.com", role: "student", status: true },
		{ id: "plain", email: "plain@example.com", role: "student", status: true },
		{ id: "outsider", email: "o@example.com", role: "student", status: true }
	);
	const T1 = account("t1", "instructor");
	const P1 = account("p1");
	const P2 = account("p2");
	const mk = async (name, band, picture) => {
		const l = await svc.createLearner(repo, T1, { displayName: name, pin: "1234" }, ctx());
		await repo.updateLearner(l.id, { avatar: "🚀", age_band: band, ...(picture ? { picture_hash: await bcrypt.hash(picture.join("-"), 4) } : {}) });
		return l;
	};
	const link = async (parent, learner) => {
		const issued = await parentCode(repo, learner.id, ctx());
		return (await redeemParentLink(repo, parent, { code: issued.code }, ctx())).child;
	};
	const maya = { ...(await link(P1, await mk("Maya", "7-8", ["sun", "star", "moon"]))), pictureCode: true };
	const leo = { ...(await link(P1, await mk("Leo", "6-7"))), pictureCode: false };
	const other = await link(P2, await mk("Zed", "8-9", ["heart", "heart", "heart"]));
	return { repo, T1, P1, P2, maya, leo, other };
}

async function pairedDevice(s, learnerIds = [s.maya.id], t = T0) {
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx(t)).catch(() => {});
	const p = await fam.createPairing(s.repo, s.P1, { learnerIds }, ctx(t));
	const r = await fam.redeemPairing(s.repo, { code: p.display.toLowerCase() }, ctx(t + 1000));
	const deviceId = r.deviceToken.split(".")[0];
	await fam.decideDevice(s.repo, s.P1, deviceId, { action: "approve", name: "Maya's iPad" }, ctx(t + 2000));
	return { p, r, deviceId, token: r.deviceToken };
}

// ------------------------------------------------------------------ codes

test("pairing codes: 6 chars, no I/O/0/1, secure alphabet, normalised input", () => {
	for (const ch of "IO01") assert.ok(!CODE_ALPHABET.includes(ch));
	const seen = new Set();
	for (let i = 0; i < 500; i++) {
		const c = generateCode();
		assert.match(c, /^[A-HJ-NP-Z2-9]{6}$/);
		seen.add(c);
	}
	assert.ok(seen.size > 495, "random, not repeating");
	assert.equal(normalizeCode(" k7q-4m2 "), "K7Q4M2");
	for (const bad of ["K7Q4M", "K7Q4M2X", "K7Q4MI", "K7Q4M0", "", null, 5, {}, "K7Q 4M2 ;DROP"]) assert.equal(normalizeCode(bad), null, String(bad));
	assert.notEqual(hashCode("K7Q4M2"), "K7Q4M2");
	assert.equal(deviceLabel("Mozilla/5.0 (iPad; CPU OS 17_0) Safari/604.1"), "iPad · Safari");
});

// ------------------------------------------------------------------ children

test("linked children: owned by the instructor, parent link only, picture code is the one parent edit", async () => {
	const s = await setup();
	const learner = s.repo._db.learners.find((l) => l.id === s.maya.id);
	assert.equal(learner.owner_user_id, "t1", "the instructor keeps ownership; linking never transfers it");
	assert.equal(s.repo._db.guardians.find((g) => g.learner_id === s.maya.id && g.user_id === "p1").relation, "parent");
	assert.ok(learner.picture_hash && !learner.picture_hash.includes("sun"), "picture code is hashed");
	assert.equal(typeof fam.createChild, "undefined", "parents have no way to create a child profile");

	const u = await fam.setChildPicture(s.repo, s.P1, s.leo.id, { picture: ["leaf", "fish", "ball"] }, ctx());
	assert.equal(u.pictureCode, true);
	assert.ok(!JSON.stringify(s.repo._db.learners.find((l) => l.id === s.leo.id)).includes("leaf-fish"), "stored hashed");
	for (const bad of [{ picture: ["sun", "star"] }, { picture: ["sun", "star", "nope"] }, {}, { nickname: "Hacked", picture: ["sun", "sun", "sun"] }, { avatar: "⭐" }]) {
		await assert.rejects(fam.setChildPicture(s.repo, s.P1, s.leo.id, bad, ctx()), { status: 422 }, JSON.stringify(bad));
	}
	await assert.rejects(fam.setChildPicture(s.repo, null, s.leo.id, { picture: null }, ctx()), { status: 401 });
	await assert.rejects(fam.setChildPicture(s.repo, { kind: "learner", learnerId: s.maya.id }, s.maya.id, { picture: null }, ctx()), { status: 401 }, "a child session cannot change it");
	assert.equal(s.repo._db.learners.find((l) => l.id === s.leo.id).display_name, "Leo");
});

test("one family cannot see or edit another family's children", async () => {
	const s = await setup();
	const f1 = await fam.getFamily(s.repo, s.P1, ctx());
	assert.deepEqual(f1.children.map((c) => c.nickname).sort(), ["Leo", "Maya"]);
	const f2 = await fam.getFamily(s.repo, s.P2, ctx());
	assert.deepEqual(f2.children.map((c) => c.nickname), ["Zed"]);
	assert.ok(!JSON.stringify(f1).includes("Zed"));
	await assert.rejects(fam.setChildPicture(s.repo, s.P2, s.maya.id, { picture: null }, ctx()), { status: 404 });
	await assert.rejects(fam.createPairing(s.repo, s.P2, { learnerIds: [s.maya.id] }, ctx()), { status: 404 });
	assert.equal(s.repo._db.learners.find((l) => l.id === s.maya.id).picture_hash !== null, true);
});

// ------------------------------------------------------------------ family PIN

test("family PIN: hashed, 4–6 digits, changing needs the current PIN or password", async () => {
	const s = await setup();
	for (const pin of ["123", "1234567", "12a4", "", null, 1234]) await assert.rejects(fam.setFamilyPin(s.repo, s.P1, { pin }, ctx()), { status: 422 }, String(pin));
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	const row = s.repo._fam.pins[0];
	assert.ok(row.pin_hash.startsWith("$2") && !row.pin_hash.includes("2468"), "bcrypt hash, never plain text");
	assert.equal((await fam.getFamily(s.repo, s.P1, ctx())).pinSet, true);

	await assert.rejects(fam.setFamilyPin(s.repo, s.P1, { pin: "1357" }, ctx()), { status: 422 }, "no proof, no change");
	await assert.rejects(fam.setFamilyPin(s.repo, s.P1, { pin: "1357", currentPin: "0000" }, ctx()), { status: 401, code: "wrong_pin" });
	await assert.rejects(fam.setFamilyPin(s.repo, s.P1, { pin: "1357", password: "x" }, ctx()), { status: 401 });
	await fam.setFamilyPin(s.repo, s.P1, { pin: "1357", currentPin: "2468" }, ctx());
	assert.ok(await bcrypt.compare("1357", s.repo._fam.pins[0].pin_hash));

	s.repo._db.users.find((u) => u.id === "p1").password = await bcrypt.hash("pw-12345", 4);
	await fam.setFamilyPin(s.repo, s.P1, { pin: "9999", password: "pw-12345" }, ctx());
	assert.ok(await bcrypt.compare("9999", s.repo._fam.pins[0].pin_hash), "reset from the signed-in phone with the account password");
});

test("family PIN: lockout after repeated failures, and a wrong PIN says nothing about the real one", async () => {
	const s = await setup();
	const d = await pairedDevice(s);
	let last;
	for (let i = 1; i <= 5; i++) {
		last = await fam.grownupAccess(s.repo, d.token, { pin: "0000" }, ctx(T0 + 10 * MIN + i)).catch((e) => e);
		assert.equal(last.status, 401);
		assert.ok(!/2468/.test(last.message));
	}
	assert.equal(last.extra.remaining, 0);
	const locked = await fam.grownupAccess(s.repo, d.token, { pin: "2468" }, ctx(T0 + 10 * MIN + 10)).catch((e) => e);
	assert.equal(locked.status, 423, "even the right PIN is refused while locked");
	const after = await fam.grownupAccess(s.repo, d.token, { pin: "2468" }, ctx(T0 + 30 * MIN));
	assert.ok(verifyGrownupToken(after.grownupToken));
});

// ------------------------------------------------------------------ pairing

test("pairing: needs a family PIN; the code is stored hashed; a new code replaces the old one", async () => {
	const s = await setup();
	await assert.rejects(fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx()), { status: 409, code: "pin_required" });
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	const a = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx());
	assert.match(a.code, /^[A-HJ-NP-Z2-9]{6}$/);
	assert.equal(a.display, `${a.code.slice(0, 3)}-${a.code.slice(3)}`);
	assert.equal(a.ttlSeconds, 600);
	assert.ok(!JSON.stringify(s.repo._fam.codes).includes(a.code), "plain code is never stored");
	const b = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id, s.leo.id] }, ctx(T0 + 1000));
	assert.equal((await fam.getPairing(s.repo, s.P1, a.id, ctx(T0 + 2000))).status, "cancelled");
	assert.equal((await fam.getPairing(s.repo, s.P1, b.id, ctx(T0 + 2000))).status, "open");
	await assert.rejects(fam.redeemPairing(s.repo, { code: a.code }, ctx(T0 + 3000)), { status: 410 }, "the replaced code is dead");

	for (const ids of [[], "x", [1], ["nope"], new Array(40).fill("a")]) await assert.rejects(fam.createPairing(s.repo, s.P1, { learnerIds: ids }, ctx()), (e) => [404, 422].includes(e.status), JSON.stringify(ids));
	await assert.rejects(fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id, s.other.id] }, ctx()), { status: 404 }, "cannot mix in another family's child");
});

test("two code requests racing never cancel each other (double tap / re-render)", async () => {
	const s = await setup();
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	for (let i = 0; i < 20; i++) {
		const t = T0 + i * 30 * MIN;
		const [a, b] = await Promise.all([fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx(t)), fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx(t))]);
		const live = [a, b].filter((p) => s.repo._fam.codes.find((c) => c.id === p.id).status === "open");
		assert.ok(live.length >= 1, "at least the code the page keeps is still valid");
		const r = await fam.redeemPairing(s.repo, { code: b.code }, ctx(t + 1000));
		assert.equal(r.status, "pending");
	}
});

test("pairing status is visible only to the parent who made it", async () => {
	const s = await setup();
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	const p = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx());
	await assert.rejects(fam.getPairing(s.repo, s.P2, p.id, ctx()), { status: 404 });
	await assert.rejects(fam.getPairing(s.repo, null, p.id, ctx()), { status: 401 });
	await assert.rejects(fam.cancelPairing(s.repo, s.P2, p.id, ctx()), { status: 404 });
	const st = await fam.getPairing(s.repo, s.P1, p.id, ctx(T0 + 60000));
	assert.deepEqual([st.status, st.secondsLeft], ["open", 540]);
	assert.ok(!("code" in st) && !JSON.stringify(st).includes(p.code));
});

test("expired codes are rejected", async () => {
	const s = await setup();
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	const p = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx());
	await assert.rejects(fam.redeemPairing(s.repo, { code: p.code }, ctx(T0 + 10 * MIN)), { status: 410, code: "invalid_code" });
	assert.equal((await fam.getPairing(s.repo, s.P1, p.id, ctx(T0 + 10 * MIN))).status, "expired");
	assert.equal(s.repo._fam.devices.length, 0);
	// just inside the window still works
	const p2 = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx(T0));
	assert.equal((await fam.redeemPairing(s.repo, { code: p2.code }, ctx(T0 + 10 * MIN - 1))).status, "pending");
});

test("codes are single use, also under simultaneous redemption", async () => {
	const s = await setup();
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	const p = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx());
	const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => fam.redeemPairing(s.repo, { code: p.code }, ctx(T0 + 1000))));
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(s.repo._fam.devices.length, 1);
	for (const r of results.filter((x) => x.status === "rejected")) assert.equal(r.reason.status, 410);
	await assert.rejects(fam.redeemPairing(s.repo, { code: p.code }, ctx(T0 + 2000)), { status: 410 }, "replay");
});

test("every bad code gets the same answer", async () => {
	const s = await setup();
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	const p = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx());
	await fam.cancelPairing(s.repo, s.P1, p.id, ctx());
	const msgs = new Set();
	for (const code of ["ZZZZZZ", p.code, "short", "", null, undefined, "K7Q4M0"]) {
		const e = await fam.redeemPairing(s.repo, { code }, ctx()).catch((x) => x);
		assert.ok([410, 422].includes(e.status));
		msgs.add(e.message);
	}
	assert.equal(msgs.size, 1, "cancelled, unknown and malformed codes are indistinguishable");
});

// ------------------------------------------------------------------ approval

test("a redeemed device has no access until a parent approves it", async () => {
	const s = await setup();
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	const p = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx());
	const r = await fam.redeemPairing(s.repo, { code: p.code }, ctx(T0 + 1000));
	assert.deepEqual(r.learners, [{ nickname: "Maya", avatar: "🚀" }]);
	assert.ok(!JSON.stringify(s.repo._fam.devices).includes(r.deviceToken.split(".")[1]), "device secret is stored hashed");

	assert.deepEqual((await fam.deviceStatus(s.repo, r.deviceToken, ctx(T0 + 2000))).status, "pending");
	await assert.rejects(fam.startChildSession(s.repo, r.deviceToken, { learnerId: s.maya.id, picture: ["sun", "star", "moon"] }, ctx(T0 + 2000)), { status: 403, code: "device_pending" });
	await assert.rejects(fam.grownupAccess(s.repo, r.deviceToken, { pin: "2468" }, ctx(T0 + 2000)), { status: 403 });

	const fam1 = await fam.getFamily(s.repo, s.P1, ctx(T0 + 2000));
	assert.equal(fam1.requests.length, 1);
	assert.equal(fam1.requests[0].label, "iPad · Safari");
	assert.deepEqual(fam1.requests[0].learners.map((l) => l.nickname), ["Maya"]);

	const id = r.deviceToken.split(".")[0];
	await assert.rejects(fam.decideDevice(s.repo, s.P2, id, { action: "approve" }, ctx(T0 + 3000)), { status: 404 }, "another family cannot approve");
	await assert.rejects(fam.decideDevice(s.repo, null, id, { action: "approve" }, ctx(T0 + 3000)), { status: 401 });
	await assert.rejects(fam.decideDevice(s.repo, s.P1, id, { action: "approve", name: "<script>" }, ctx(T0 + 3000)), { status: 422 });
	await assert.rejects(fam.decideDevice(s.repo, s.P1, id, { action: "maybe" }, ctx(T0 + 3000)), { status: 422 });

	const ok = await fam.decideDevice(s.repo, s.P1, id, { action: "approve", name: "Maya's iPad" }, ctx(T0 + 3000));
	assert.equal(ok.status, "approved");
	const st = await fam.deviceStatus(s.repo, r.deviceToken, ctx(T0 + 4000));
	assert.equal(st.status, "approved");
	assert.deepEqual(st.learners.map((l) => [l.nickname, l.pictureRequired]), [["Maya", true]]);
	await assert.rejects(fam.decideDevice(s.repo, s.P1, id, { action: "deny" }, ctx(T0 + 5000)), { status: 409 }, "cannot answer twice");
});

test("approval after the pending window, and denial", async () => {
	const s = await setup();
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	const p = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx());
	const r = await fam.redeemPairing(s.repo, { code: p.code }, ctx(T0 + 1000));
	const id = r.deviceToken.split(".")[0];
	await assert.rejects(fam.decideDevice(s.repo, s.P1, id, { action: "approve" }, ctx(T0 + 12 * MIN)), { status: 409, code: "expired" });
	await assert.rejects(fam.deviceStatus(s.repo, r.deviceToken, ctx(T0 + 12 * MIN)), { status: 401, code: "device_expired" });

	const p2 = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx(T0 + 13 * MIN));
	const r2 = await fam.redeemPairing(s.repo, { code: p2.code }, ctx(T0 + 13 * MIN + 1000));
	await fam.decideDevice(s.repo, s.P1, r2.deviceToken.split(".")[0], { action: "deny" }, ctx(T0 + 13 * MIN + 2000));
	await assert.rejects(fam.deviceStatus(s.repo, r2.deviceToken, ctx(T0 + 13 * MIN + 3000)), { status: 401, code: "device_denied" });
	await assert.rejects(fam.decideDevice(s.repo, s.P1, r2.deviceToken.split(".")[0], { action: "approve" }, ctx(T0 + 13 * MIN + 4000)), { status: 409 }, "a denied device cannot be revived");
});

test("concurrent approve and deny: exactly one wins", async () => {
	const s = await setup();
	await fam.setFamilyPin(s.repo, s.P1, { pin: "2468" }, ctx());
	const p = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.maya.id] }, ctx());
	const r = await fam.redeemPairing(s.repo, { code: p.code }, ctx(T0 + 1000));
	const id = r.deviceToken.split(".")[0];
	const out = await Promise.allSettled([fam.decideDevice(s.repo, s.P1, id, { action: "approve" }, ctx(T0 + 2000)), fam.decideDevice(s.repo, s.P1, id, { action: "deny" }, ctx(T0 + 2000))]);
	assert.equal(out.filter((o) => o.status === "fulfilled").length, 1);
});

test("a forged or foreign device token is rejected", async () => {
	const s = await setup();
	const d = await pairedDevice(s);
	const [id, secret] = d.token.split(".");
	for (const t of [`${id}.${secret}x`, `${id}.`, `${id}.AAAA`, "garbage", "", null, undefined, `${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}.${secret}`]) {
		await assert.rejects(fam.deviceStatus(s.repo, t, ctx(T0 + 5000)), { status: 401, code: "device_invalid" }, String(t));
	}
	assert.equal((await fam.deviceStatus(s.repo, d.token, ctx(T0 + 5000))).status, "approved");
});

// ------------------------------------------------------------------ child sign-in

test("picture sign-in: right pictures give a device-bound learner session", async () => {
	const s = await setup();
	const d = await pairedDevice(s);
	const r = await fam.startChildSession(s.repo, d.token, { learnerId: s.maya.id, picture: ["sun", "star", "moon"] }, ctx(T0 + 5000));
	const claims = verifyLearnerToken(r.learnerToken);
	assert.deepEqual([claims.learnerId, claims.accountUserId, claims.deviceId], [s.maya.id, "p1", d.deviceId]);
	assert.equal(r.learner.displayName, "Maya");
	const actor = await svc.resolveLearnerSession(s.repo, claims, null);
	assert.deepEqual([actor.kind, actor.learnerId], ["learner", s.maya.id], "works with the existing Mastery learner session");
	assert.ok(await fam.deviceAllowsLearner(s.repo, claims));
});

test("picture sign-in: wrong order, wrong child, other family's child, lockout", async () => {
	const s = await setup();
	const d = await pairedDevice(s);
	for (const pic of [["star", "sun", "moon"], ["sun", "star", "sun"], ["sun", "star"], null, "sun-star-moon"]) {
		await assert.rejects(fam.startChildSession(s.repo, d.token, { learnerId: s.maya.id, picture: pic }, ctx(T0 + 5000)), { status: 401, code: "wrong_picture" }, JSON.stringify(pic));
	}
	// the 5th wrong try locked it
	const e = await fam.startChildSession(s.repo, d.token, { learnerId: s.maya.id, picture: ["sun", "star", "moon"] }, ctx(T0 + 6000)).catch((x) => x);
	assert.equal(e.status, 423);
	await assert.rejects(fam.startChildSession(s.repo, d.token, { learnerId: s.leo.id }, ctx(T0 + 6000)), { status: 404 }, "Leo is not on this device");
	await assert.rejects(fam.startChildSession(s.repo, d.token, { learnerId: s.other.id, picture: ["heart", "heart", "heart"] }, ctx(T0 + 6000)), { status: 404 }, "another family's child");
	const ok = await fam.startChildSession(s.repo, d.token, { learnerId: s.maya.id, picture: ["sun", "star", "moon"] }, ctx(T0 + 20 * MIN));
	assert.ok(ok.learnerToken, "lock expires");
});

test("a child with no picture code signs in by tapping their profile; a shared device lists every child", async () => {
	const s = await setup();
	const d = await pairedDevice(s, [s.maya.id, s.leo.id]);
	const st = await fam.deviceStatus(s.repo, d.token, ctx(T0 + 5000));
	assert.deepEqual(st.learners.map((l) => [l.nickname, l.pictureRequired]), [["Maya", true], ["Leo", false]]);
	assert.ok((await fam.startChildSession(s.repo, d.token, { learnerId: s.leo.id }, ctx(T0 + 5000))).learnerToken);
	await assert.rejects(fam.startChildSession(s.repo, d.token, { learnerId: s.maya.id }, ctx(T0 + 5000)), { status: 401 }, "pictures still required for Maya");
});

// ------------------------------------------------------------------ revocation

test("revoking a device ends its sessions at once", async () => {
	const s = await setup();
	const d = await pairedDevice(s);
	const child = await fam.startChildSession(s.repo, d.token, { learnerId: s.maya.id, picture: ["sun", "star", "moon"] }, ctx(T0 + 5000));
	const claims = verifyLearnerToken(child.learnerToken);
	const grown = await fam.grownupAccess(s.repo, d.token, { pin: "2468" }, ctx(T0 + 5000));

	await assert.rejects(fam.revokeDevice(s.repo, s.P1, d.deviceId, {}, ctx(T0 + 6000)), { status: 422, code: "confirm_required" });
	await assert.rejects(fam.revokeDevice(s.repo, s.P1, d.deviceId, { confirm: "yes" }, ctx(T0 + 6000)), { status: 422 });
	await assert.rejects(fam.revokeDevice(s.repo, s.P2, d.deviceId, { confirm: true }, ctx(T0 + 6000)), { status: 404 }, "another family cannot revoke");
	await assert.rejects(fam.revokeDevice(s.repo, null, d.deviceId, { confirm: true }, ctx(T0 + 6000)), { status: 401 });
	assert.ok(await fam.deviceAllowsLearner(s.repo, claims), "still fine before revocation");

	assert.equal((await fam.revokeDevice(s.repo, s.P1, d.deviceId, { confirm: true }, ctx(T0 + 7000))).status, "revoked");
	assert.equal(await fam.deviceAllowsLearner(s.repo, claims), false, "the issued learner token no longer works");
	await assert.rejects(fam.deviceStatus(s.repo, d.token, ctx(T0 + 8000)), { status: 401, code: "device_revoked" });
	await assert.rejects(fam.startChildSession(s.repo, d.token, { learnerId: s.maya.id, picture: ["sun", "star", "moon"] }, ctx(T0 + 8000)), { status: 401 });
	await assert.rejects(fam.grownupAccess(s.repo, d.token, { pin: "2468" }, ctx(T0 + 8000)), { status: 401 });
	await assert.rejects(fam.unpairThisDevice(s.repo, d.token, grown.grownupToken, ctx(T0 + 8000)), { status: 401 });
	assert.equal((await fam.revokeDevice(s.repo, s.P1, d.deviceId, { confirm: true }, ctx(T0 + 9000))).status, "revoked", "idempotent");
	assert.deepEqual((await fam.getFamily(s.repo, s.P1, ctx(T0 + 9000))).children[0].devices, []);
});

test("revocation of one device leaves the family's other devices working", async () => {
	const s = await setup();
	const a = await pairedDevice(s, [s.maya.id], T0);
	const p = await fam.createPairing(s.repo, s.P1, { learnerIds: [s.leo.id] }, ctx(T0 + 20 * MIN));
	const r = await fam.redeemPairing(s.repo, { code: p.code }, ctx(T0 + 20 * MIN + 1000));
	await fam.decideDevice(s.repo, s.P1, r.deviceToken.split(".")[0], { action: "approve" }, ctx(T0 + 20 * MIN + 2000));
	await fam.revokeDevice(s.repo, s.P1, a.deviceId, { confirm: true }, ctx(T0 + 21 * MIN));
	assert.equal((await fam.deviceStatus(s.repo, r.deviceToken, ctx(T0 + 22 * MIN))).status, "approved");
});

test("a device-bound learner token dies when the parent link is removed or the device owner changes", async () => {
	const s = await setup();
	const d = await pairedDevice(s);
	const child = await fam.startChildSession(s.repo, d.token, { learnerId: s.maya.id, picture: ["sun", "star", "moon"] }, ctx(T0 + 5000));
	const claims = verifyLearnerToken(child.learnerToken);
	assert.equal(await fam.deviceAllowsLearner(s.repo, { ...claims, learnerId: s.leo.id }), false, "token for a child that is not on the device");
	assert.equal(await fam.deviceAllowsLearner(s.repo, { ...claims, accountUserId: "p2" }), false, "token claiming another owner");
	assert.equal(await fam.deviceAllowsLearner(s.repo, { ...claims, deviceId: "nope" }), false);
	s.repo._db.guardians = s.repo._db.guardians.filter((g) => !(g.learner_id === s.maya.id && g.user_id === "p1"));
	assert.equal(await fam.deviceAllowsLearner(s.repo, claims), false);
	assert.equal((await fam.deviceStatus(s.repo, d.token, ctx(T0 + 6000))).learners.length, 0, "a child whose parent link was removed drops off the device");
	// non-device sessions are unaffected by this check
	assert.equal(await fam.deviceAllowsLearner(s.repo, { learnerId: s.maya.id, accountUserId: "p1", deviceId: null }), true);
});

// ------------------------------------------------------------------ grown-ups only

test("unpairing needs the family PIN entered on that device", async () => {
	const s = await setup();
	const d = await pairedDevice(s);
	await assert.rejects(fam.unpairThisDevice(s.repo, d.token, "", ctx(T0 + 5000)), { status: 403 });
	await assert.rejects(fam.unpairThisDevice(s.repo, d.token, "not-a-jwt", ctx(T0 + 5000)), { status: 403 });
	const other = await pairedDevice(s, [s.leo.id], T0 + 20 * MIN);
	const otherGrown = await fam.grownupAccess(s.repo, other.token, { pin: "2468" }, ctx(T0 + 21 * MIN));
	await assert.rejects(fam.unpairThisDevice(s.repo, d.token, otherGrown.grownupToken, ctx(T0 + 21 * MIN)), { status: 403 }, "a PIN entered on another device does not unpair this one");
	const grown = await fam.grownupAccess(s.repo, d.token, { pin: "2468" }, ctx(T0 + 5000));
	assert.equal((await fam.unpairThisDevice(s.repo, d.token, grown.grownupToken, ctx(T0 + 5000))).ok, true);
	await assert.rejects(fam.deviceStatus(s.repo, d.token, ctx(T0 + 6000)), { code: "device_revoked" });
	assert.equal((await fam.deviceStatus(s.repo, other.token, ctx(T0 + 6000))).status, "approved");
});

test("tokens: a grown-up or learner token is never an account token", async () => {
	const { verifyAccountToken } = await import("../../lib/mastery/tokens.js");
	const s = await setup();
	const d = await pairedDevice(s);
	const g = await fam.grownupAccess(s.repo, d.token, { pin: "2468" }, ctx(T0 + 5000));
	const c = await fam.startChildSession(s.repo, d.token, { learnerId: s.maya.id, picture: ["sun", "star", "moon"] }, ctx(T0 + 5000));
	assert.equal(verifyAccountToken(g.grownupToken), null);
	assert.equal(verifyAccountToken(c.learnerToken), null);
	assert.equal(verifyLearnerToken(g.grownupToken), null);
	assert.equal(verifyGrownupToken(c.learnerToken), null);
});

// ------------------------------------------------------------------ caregivers & privacy

test("a second parent is linked with a code their child shows, never by a parent's invite", async () => {
	const s = await setup();
	assert.equal(typeof fam.inviteCaregiver, "undefined", "the e-mail caregiver invite is gone");
	const issued = await parentCode(s.repo, s.maya.id, ctx());
	await redeemParentLink(s.repo, s.P2, { code: issued.code }, ctx());
	const f2 = await fam.getFamily(s.repo, s.P2, ctx());
	assert.deepEqual(f2.children.map((c) => c.nickname).sort(), ["Maya", "Zed"]);
});

test("family overview never leaks secrets or other families", async () => {
	const s = await setup();
	const d = await pairedDevice(s);
	const text = JSON.stringify(await fam.getFamily(s.repo, s.P1, ctx(T0 + 5000)));
	for (const needle of ["secret", "hash", "pin_hash", "picture_hash", d.token.split(".")[1], d.p.code, "Zed", "p2@"]) assert.ok(!text.includes(needle), needle);
	const status = JSON.stringify(await fam.deviceStatus(s.repo, d.token, ctx(T0 + 5000)));
	for (const needle of ["hash", "owner", "p1", "Zed"]) assert.ok(!status.includes(needle), needle);
});
