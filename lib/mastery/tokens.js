// Signed tokens for learner sessions and worksheet starts. Both use the
// existing JWT_SECRET with a distinct `typ` so they can never be confused
// with each other or with account login tokens (which carry `userId`).

import jwt from "jsonwebtoken";

const secret = () => {
	const s = process.env.JWT_SECRET;
	if (!s) throw new Error("JWT_SECRET is not configured");
	return s;
};

export const LEARNER_TOKEN_TTL = "7d";
export const START_TOKEN_TTL = "14d"; // long enough for offline completion + later sync

// `deviceId` is set only for sessions issued on a paired child device (lib/family). Such a session is
// re-checked against the device on every request, so revoking the device ends it at once.
export function signLearnerToken({ learnerId, accountUserId, deviceId }) {
	return jwt.sign({ typ: "ml_learner", lid: learnerId, acct: accountUserId, ...(deviceId ? { did: deviceId } : {}) }, secret(), { expiresIn: LEARNER_TOKEN_TTL });
}

export function verifyLearnerToken(token) {
	try {
		const p = jwt.verify(String(token || ""), secret());
		if (p.typ !== "ml_learner" || !p.lid) return null;
		return { learnerId: p.lid, accountUserId: p.acct, deviceId: p.did || null };
	} catch (e) {
		return null;
	}
}

// Proof that the family PIN was just entered on a child device (leave child mode / unpair).
// Bound to the device and short-lived; never accepted as an account or learner token (distinct typ).
export const GROWNUP_TOKEN_TTL = "5m";
export function signGrownupToken({ deviceId, ownerUserId }) {
	return jwt.sign({ typ: "fam_grownup", did: deviceId, own: ownerUserId }, secret(), { expiresIn: GROWNUP_TOKEN_TTL });
}
export function verifyGrownupToken(token) {
	try {
		const p = jwt.verify(String(token || ""), secret());
		if (p.typ !== "fam_grownup" || !p.did) return null;
		return { deviceId: p.did, ownerUserId: p.own };
	} catch (e) {
		return null;
	}
}

// Issued when the server hands out a worksheet; the server later regenerates
// and grades exactly this sheet, so the client cannot swap in another one.
export function signStartToken({ sessionId, learnerId, subject, levelId, setId, worksheetNo, variant, startedAt, assignmentId }) {
	return jwt.sign(
		{ typ: "ml_start", sid: sessionId, lid: learnerId, sub: subject, lv: levelId, set: setId, ws: worksheetNo, v: variant, st: startedAt, ...(assignmentId ? { aid: assignmentId } : {}) },
		secret(),
		{ expiresIn: START_TOKEN_TTL }
	);
}

export function verifyStartToken(token) {
	try {
		const p = jwt.verify(String(token || ""), secret());
		if (p.typ !== "ml_start") return null;
		return {
			sessionId: p.sid,
			learnerId: p.lid,
			subject: p.sub,
			levelId: p.lv,
			setId: p.set,
			worksheetNo: p.ws,
			variant: p.v,
			startedAt: p.st,
			assignmentId: p.aid || null, // set only when the worksheet was started from an assignment
		};
	} catch (e) {
		return null;
	}
}

// Account login tokens from /api/users/signin. Rejects learner/start tokens.
export function verifyAccountToken(token) {
	try {
		let t = String(token || "");
		if (t.startsWith("Bearer ")) t = t.slice(7);
		const p = jwt.verify(t, secret());
		if (p.typ || !p.userId) return null;
		return { userId: p.userId, role: p.role };
	} catch (e) {
		return null;
	}
}
