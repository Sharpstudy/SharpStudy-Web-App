// Parent <-> learner linking.
//
// Learner profiles are created by instructors and administrators (lib/mastery createLearner, studentLinks.js)
// and are tied to purchases only through those workflows. A parent cannot create, search for or claim a
// profile by name or e-mail. The ONLY way to become a parent of an existing learner is a single-use link code:
//
//   1. the child, signed in to their own account, asks for a code on their Study page (issueLinkCodeForChild).
//      Nobody else can create a code: there is no instructor, administrator or parent route for it;
//   2. the child reads the code to the parent;
//   3. the signed-in parent redeems it (redeemParentLink). The code is consumed atomically and an
//      ml_learner_guardians row with relation "parent" is added for that learner and nobody else.
//
// Nothing is copied or moved: the learner keeps its id, owner, courses, enrolments, worksheets and progress.
// Only the HMAC of a code is stored. Unknown, expired, used and cancelled codes all give the same answer.

import { v4 as uuidv4 } from "uuid";
import { ServiceError, writeAudit } from "../mastery/service.js";
import { accountIsActive } from "../auth/accountState.js";

import { generateLinkCode, normalizeLinkCode, hashLinkCode, formatLinkCode } from "./codes.js";

const fail = (status, code, message, extra) => {
	throw new ServiceError(status, code, message, extra);
};

export const LINK_LIMITS = {
	ttlMs: Math.max(1, Number(process.env.FAMILY_LINK_TTL_HOURS) || 72) * 60 * 60 * 1000,
};

const nowOf = (ctx) => (ctx && ctx.now) || Date.now();
const iso = (d) => (d ? new Date(d).toISOString() : null);
const requireAccount = (actor) => {
	if (!actor || actor.kind !== "account") fail(401, "unauthorized", "Sign in first");
};
const invalidCode = () => fail(404, "invalid_code", "That code is not valid or has expired. Ask your child to show a new code on their Study page.");

// ---- child-initiated codes ----------------------------------------------------------------------------------
//
// What identifies the child is the child's OWN signed-in SharpStudy account (ml_learners.student_user_id, set only
// by an instructor). The code is generated only for that account's learner, on request, and shown to that signed-in
// child once. The parent never names a child: they type the code the child reads out, and the learner comes from
// the stored code. Knowing an e-mail address, name or learner id is not enough to link anything.

export const CODE_LIMITS = {
	perLearnerPerDay: 10,
};

// The learner behind the signed-in child account, or null.
async function childLearner(repo, actor) {
	const [learner] = await repo.listLearnersByStudent(actor.userId);
	return learner || null;
}

// The signed-in child's view: whether the account has a learner profile, whether a code is currently open (never the
// code itself), and which parents are linked, so a child can notice a link they did not intend.
export async function getChildLinkStatus(repo, actor, ctx = {}) {
	requireAccount(actor);
	const learner = await childLearner(repo, actor);
	if (!learner) return { eligible: false, learner: null, openCode: null, parents: [] };
	const open = await repo.findOpenLinkCode(learner.id, new Date(nowOf(ctx)));
	const parents = (await repo.listGuardians(learner.id))
		.filter((g) => g.relation === "parent")
		.map((g) => ({ name: String(g.name || "").trim().split(/\s+/)[0] || "A parent" }));
	return { eligible: true, learner: { id: learner.id, name: learner.display_name }, openCode: open ? { expiresAt: iso(open.expires_at) } : null, parents };
}

// The child withdraws their open code (for instance, it was read to the wrong person). It stops working at once.
export async function cancelLinkCodeForChild(repo, actor, ctx = {}) {
	requireAccount(actor);
	const learner = await childLearner(repo, actor);
	if (!learner) fail(404, "no_profile", "There is no learner profile on this account.");
	const n = await repo.cancelOpenLinkCodes(learner.id);
	if (n) await writeAudit(repo, actor, "family.link_code_cancel", learner.id, {}, ctx.ip);
	return { cancelled: n > 0 };
}

// The child asks for a parent link code. A fresh random code is generated now, only its hash is kept, and the plain
// code is returned exactly once. It is bound to this child's learner, valid for 72 hours and redeemable once. A new
// code replaces any older open one for the learner (which stops working).
export async function issueLinkCodeForChild(repo, actor, ctx = {}) {
	requireAccount(actor);
	const now = nowOf(ctx);
	const learner = await childLearner(repo, actor);
	if (!learner) fail(404, "no_profile", "There is no learner profile on this account. Ask your instructor to connect your profile.");
	if ((await repo.countChildLinkCodesSince(learner.id, actor.userId, new Date(now - 24 * 60 * 60 * 1000))) >= CODE_LIMITS.perLearnerPerDay) {
		fail(429, "rate_limited", "Too many codes today. Please try again tomorrow.");
	}
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = generateLinkCode();
		try {
			const row = await repo.createLinkCode({
				id: uuidv4(),
				learner_id: learner.id,
				issued_by: actor.userId,
				code_hash: hashLinkCode(code),
				status: "open",
				expires_at: new Date(now + LINK_LIMITS.ttlMs),
				created_at: new Date(now),
			});
			await repo.cancelOlderLinkCodes(learner.id, row.created_at, row.id);
			await writeAudit(repo, actor, "family.link_code_show", learner.id, {}, ctx.ip);
			return { code, display: formatLinkCode(code), expiresAt: iso(row.expires_at) };
		} catch (e) {
			if (!(e && e.code === "duplicate_code")) throw e;
		}
	}
	fail(500, "server_error", "Could not create a code. Please try again.");
}

// Parent side. `input.code` is the only thing the client controls: the learner comes from the stored code.
export async function redeemParentLink(repo, actor, input, ctx = {}) {
	requireAccount(actor);
	const now = nowOf(ctx);
	const code = normalizeLinkCode(input && input.code);
	if (!code) invalidCode();
	const user = await repo.getUser(actor.userId);
	if (!accountIsActive(user)) fail(401, "unauthorized", "Sign in first");
	const codeHash = hashLinkCode(code);
	// One repository call decides every rejection first and then consumes the code and adds the guardian together:
	// a rejected or failed redemption leaves the code usable, and concurrent submissions cannot both succeed.
	const r = await repo.redeemLinkCode({ codeHash, now: new Date(now), userId: actor.userId });
	if (r.outcome === "own") fail(422, "invalid", "This code is for a parent or guardian, not the learner's own account");
	if (r.outcome === "owner") fail(409, "conflict", "This account already manages this learner");
	if (r.outcome === "conflict") fail(409, "conflict", "This account already has a different kind of access to this learner");
	if (r.outcome !== "ok") {
		// A repeated submission of a code this same account already redeemed is a success, not an error.
		const prior = await repo.getLinkCodeByHash(codeHash);
		if (prior && prior.status === "used" && prior.used_by === actor.userId) {
			const done = await repo.getLearner(prior.learner_id);
			if (done && (await repo.getGuardian(done.id, actor.userId))) return { linked: true, child: { id: done.id, nickname: done.display_name, avatar: done.avatar } };
		}
		invalidCode();
	}
	const { learner, code: claimed } = r;
	await writeAudit(repo, actor, "family.link_redeem", learner.id, { issuedBy: claimed.issued_by }, ctx.ip);
	return { linked: true, child: { id: learner.id, nickname: learner.display_name, avatar: learner.avatar } };
}
