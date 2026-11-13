// Small in-memory sliding-window rate limiter. Per server instance only —
// on serverless hosts each instance keeps its own window, so treat this as
// abuse damping rather than a hard global quota.

export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
	const hits = new Map();
	return function check(key) {
		const t = now();
		const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
		if (list.length >= max) {
			hits.set(key, list);
			return { ok: false, retryAfterMs: windowMs - (t - list[0]) };
		}
		list.push(t);
		hits.set(key, list);
		if (hits.size > 10000) {
			// keep memory bounded
			for (const k of hits.keys()) {
				hits.delete(k);
				if (hits.size < 5000) break;
			}
		}
		return { ok: true };
	};
}
