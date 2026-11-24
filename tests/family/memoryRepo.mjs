// In-memory repository for lib/family/service.js: the Mastery Ladder memory repo plus the family
// tables. Mirrors lib/family/repo.js semantics, including the single-use code claim and the
// compare-and-set status updates.
import { createMemoryRepo } from "../mastery/memoryRepo.mjs";

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export function createFamilyRepo() {
	const base = createMemoryRepo();
	const fam = { pins: [], codes: [], devices: [], deviceLearners: [], links: [] };
	const dev = (d) => d && { ...clone(d), learner_ids: fam.deviceLearners.filter((l) => l.device_id === d.id).map((l) => l.learner_id) };
	const dateOf = (v) => (v ? new Date(v) : v);

	return Object.assign(base, {
		_fam: fam,

		async createLinkCode(row) {
			if (row.code_hash && fam.links.some((c) => c.code_hash === row.code_hash)) {
				const e = new Error("duplicate_code");
				e.code = "duplicate_code";
				throw e;
			}
			fam.links.push({ used_by: null, used_at: null, ...clone(row), expires_at: dateOf(row.expires_at), created_at: dateOf(row.created_at) });
			return clone(fam.links.at(-1));
		},
		async cancelOlderLinkCodes(learnerId, createdAt, exceptId) {
			for (const c of fam.links) if (c.learner_id === learnerId && c.status === "open" && c.id !== exceptId && new Date(c.created_at) < new Date(createdAt)) c.status = "cancelled";
		},
		async cancelOpenLinkCodes(learnerId) {
			let n = 0;
			for (const c of fam.links) if (c.learner_id === learnerId && c.status === "open") (c.status = "cancelled"), n++;
			return n;
		},
		async findOpenLinkCode(learnerId, now) {
			const rows = fam.links.filter((c) => c.learner_id === learnerId && c.status === "open" && new Date(c.expires_at) > new Date(now));
			return clone(rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]) || null;
		},
		async getLinkCode(id) {
			return clone(fam.links.find((c) => c.id === id)) || null;
		},
		async getLinkCodeByHash(codeHash) {
			return clone(fam.links.find((c) => c.code_hash === codeHash)) || null;
		},
		async countChildLinkCodesSince(learnerId, childUserId, since) {
			return fam.links.filter((c) => c.learner_id === learnerId && c.issued_by === childUserId && new Date(c.created_at) >= new Date(since)).length;
		},
		async updateLinkCode(id, patch, { whereStatus } = {}) {
			const c = fam.links.find((x) => x.id === id);
			if (!c || (whereStatus && !whereStatus.includes(c.status))) return null;
			Object.assign(c, patch);
			return clone(c);
		},
		// Mirrors repo.redeemLinkCode: every rejection is decided before anything is written; the code is marked used
		// and the guardian is added together, and if the guardian insert throws the code is put back (rollback).
		async redeemLinkCode({ codeHash, now, userId }) {
			const c = fam.links.find((x) => x.code_hash === codeHash);
			if (!c || c.status !== "open" || new Date(c.expires_at).getTime() <= now.getTime()) return { outcome: "invalid" };
			const learner = base._db.learners.find((l) => l.id === c.learner_id);
			if (!learner || !learner.student_user_id || learner.student_user_id !== c.issued_by) return { outcome: "invalid" };
			if (learner.student_user_id === userId) return { outcome: "own" };
			if (learner.owner_user_id === userId) return { outcome: "owner" };
			const existing = base._db.guardians.find((g) => g.learner_id === learner.id && g.user_id === userId);
			if (existing && existing.relation !== "parent") return { outcome: "conflict" };
			const before = { status: c.status, used_by: c.used_by, used_at: c.used_at };
			// No await between the checks above and this write, so two concurrent redemptions cannot both pass.
			c.status = "used";
			c.used_by = userId;
			c.used_at = now;
			try {
				if (!existing) await this.addGuardian({ learner_id: learner.id, user_id: userId, relation: "parent", created_by: c.issued_by });
			} catch (e) {
				Object.assign(c, before);
				throw e;
			}
			return { outcome: "ok", code: clone(c), learner: clone(learner) };
		},

		async getFamPin(userId) {
			return clone(fam.pins.find((p) => p.user_id === userId)) || null;
		},
		async upsertFamPin(userId, patch) {
			let row = fam.pins.find((p) => p.user_id === userId);
			if (!row) {
				if (!patch.pin_hash) return null;
				row = { id: uid(), user_id: userId, failed_attempts: 0, locked_until: null };
				fam.pins.push(row);
			}
			Object.assign(row, patch);
			return clone(row);
		},

		async createPairingCode(row) {
			if (fam.codes.some((c) => c.code_hash === row.code_hash)) {
				const e = new Error("duplicate_code");
				e.code = "duplicate_code";
				throw e;
			}
			fam.codes.push({ claimed_at: null, ...clone(row), expires_at: dateOf(row.expires_at), created_at: dateOf(row.created_at) });
			return clone(fam.codes.at(-1));
		},
		async getPairingCode(id) {
			return clone(fam.codes.find((c) => c.id === id)) || null;
		},
		async cancelOlderOpenCodes(createdBy, createdAt, exceptId) {
			for (const c of fam.codes) {
				if (c.created_by === createdBy && c.status === "open" && c.id !== exceptId && new Date(c.created_at).getTime() < new Date(createdAt).getTime()) c.status = "cancelled";
			}
		},
		async updatePairingCode(id, patch, { whereStatus } = {}) {
			const c = fam.codes.find((x) => x.id === id);
			if (!c || (whereStatus && !whereStatus.includes(c.status))) return null;
			Object.assign(c, patch);
			return clone(c);
		},
		// Synchronous body: like the real transaction, two concurrent redemptions cannot both succeed.
		async claimPairingCode({ codeHash, now, device }) {
			const c = fam.codes.find((x) => x.code_hash === codeHash);
			if (!c || c.status !== "open" || new Date(c.expires_at).getTime() <= now.getTime()) return null;
			c.status = "claimed";
			c.claimed_at = now;
			if (fam.devices.some((d) => d.pairing_code_id === c.id)) return null;
			fam.devices.push({ name: null, approved_at: null, approved_by: null, revoked_at: null, revoked_by: null, last_seen_at: null, created_at: now, ...clone(device), owner_user_id: c.owner_user_id, pairing_code_id: c.id });
			for (const lid of c.learner_ids) fam.deviceLearners.push({ id: uid(), device_id: device.id, learner_id: lid });
			return { device: dev(fam.devices.at(-1)) };
		},

		async getDevice(id) {
			return dev(fam.devices.find((d) => d.id === id)) || null;
		},
		async getDeviceByCode(codeId) {
			return dev(fam.devices.find((d) => d.pairing_code_id === codeId)) || null;
		},
		async listDevicesForLearners(learnerIds) {
			const ids = new Set(fam.deviceLearners.filter((l) => learnerIds.includes(l.learner_id)).map((l) => l.device_id));
			return fam.devices.filter((d) => ids.has(d.id)).map(dev);
		},
		async updateDevice(id, patch, { whereStatus } = {}) {
			const d = fam.devices.find((x) => x.id === id);
			if (!d || (whereStatus && !whereStatus.includes(d.status))) return null;
			Object.assign(d, patch);
			return dev(d);
		},
	});
}
