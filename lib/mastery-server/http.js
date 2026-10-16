// Shared plumbing for /api/mastery/* handlers: method dispatch, actor
// resolution (account JWT and/or learner token), error mapping, rate limits.
import repo from "./repo";
import { ServiceError, resolveLearnerSession } from "@/lib/mastery/service";
import { resolvePermissions } from "@/lib/mastery/policy";
import { verifyAccountToken, verifyLearnerToken } from "@/lib/mastery/tokens";
import { createRateLimiter } from "@/lib/mastery/ratelimit";

export { repo };

export const clientIp = (req) =>
	String((req.headers["x-forwarded-for"] || "").split(",")[0] || (req.socket && req.socket.remoteAddress) || "")
		.trim()
		.slice(0, 64) || null;

// Existing login tokens are sent as `Authorization: <token>` (or Bearer).
export async function getAccountActor(req) {
	const claims = verifyAccountToken(req.headers.authorization);
	if (!claims) return null;
	const user = await repo.getUser(claims.userId);
	if (!user || user.status === false) return null;
	// Role is re-read from the database so role changes apply immediately.
	const custom = await repo.permissionsForUser(user.id);
	return {
		kind: "account",
		userId: user.id,
		role: user.role,
		email: user.email,
		name: `${user.first_name || ""} ${user.last_name || ""}`.trim(),
		permissions: resolvePermissions(user.role, custom),
	};
}

export async function getLearnerActor(req) {
	const claims = verifyLearnerToken(req.headers["x-learner-token"]);
	if (!claims) return null;
	// Bound to the signed-in account when there is one (see resolveLearnerSession).
	const account = req.headers.authorization ? await getAccountActor(req) : null;
	return resolveLearnerSession(repo, claims, account);
}

// Prefer the learner when a learner token is present (study screens),
// otherwise the signed-in adult account.
export async function getActor(req, { prefer = "learner" } = {}) {
	const [learner, account] = await Promise.all([getLearnerActor(req), getAccountActor(req)]);
	return prefer === "learner" ? learner || account : account || learner;
}

const limiters = new Map();
export function rateLimit(req, res, name, { windowMs, max }, key) {
	if (!limiters.has(name)) limiters.set(name, createRateLimiter({ windowMs, max }));
	const r = limiters.get(name)(key || clientIp(req) || "anon");
	if (!r.ok) {
		res.setHeader("Retry-After", Math.ceil(r.retryAfterMs / 1000));
		res.status(429).json({ code: "rate_limited", message: "Too many requests. Please slow down and try again shortly." });
		return false;
	}
	return true;
}

// handler({ GET: async (req, res) => {...}, POST: ... })
export function apiHandler(methods) {
	return async function handler(req, res) {
		const fn = methods[req.method];
		if (!fn) {
			res.setHeader("Allow", Object.keys(methods).join(", "));
			return res.status(405).json({ message: `Method ${req.method} not allowed` });
		}
		res.setHeader("Cache-Control", "no-store");
		try {
			await fn(req, res);
		} catch (e) {
			if (e instanceof ServiceError) {
				return res.status(e.status).json({ code: e.code, message: e.message, ...(e.extra || {}) });
			}
			// Log the message only — never request bodies, tokens or PINs.
			console.error(`[mastery] ${req.method} ${req.url?.split("?")[0]}: ${e && e.message}`);
			return res.status(500).json({ code: "server_error", message: "Something went wrong. Please try again." });
		}
	};
}

export const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});
