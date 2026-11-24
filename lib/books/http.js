// Plumbing shared by the /api/books/* and /api/admin/books/* handlers: method dispatch, the verified
// actor (token -> database, role re-read every time), BookError mapping and rate limits.
import repo from "./repo";
import { getAccountActor, rateLimit } from "@/lib/mastery-server/http";
import { BookError } from "./errors";
import { getStorage } from "./storage";

export { repo, rateLimit, getStorage };

// optional=false -> 401 without a valid login. Role is never taken from the request.
export async function actorFor(req, { optional = false } = {}) {
	const actor = await getAccountActor(req);
	if (!actor && !optional) throw new BookError(401, "unauthorized", "Sign in first");
	return actor;
}

// handler({ GET: async (req, res) => {...}, POST: ... }, { noStore })
export function bookHandler(methods, { cache = "no-store" } = {}) {
	return async function handler(req, res) {
		const fn = methods[req.method];
		if (!fn) {
			res.setHeader("Allow", Object.keys(methods).join(", "));
			return res.status(405).json({ message: `Method ${req.method} not allowed` });
		}
		res.setHeader("Cache-Control", cache);
		try {
			await fn(req, res);
		} catch (e) {
			if (e instanceof BookError) return res.status(e.status).json({ error_code: e.code, message: e.message, ...(e.extra || {}) });
			// Message only: never request bodies, tokens or storage keys.
			console.error(`[books] ${req.method} ${String(req.url || "").split("?")[0]}: ${e && e.message}`);
			res.status(500).json({ error_code: "server_error", message: "Something went wrong. Please try again." });
		}
	};
}

// Sends protected bytes: never cached, never sniffed, shown inline (not offered as a download link).
export function sendFile(res, buf, mime, name = "book", { cache = "private, no-store" } = {}) {
	res.setHeader("Content-Type", mime);
	res.setHeader("Content-Length", buf.length);
	res.setHeader("Cache-Control", cache);
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Content-Disposition", `inline; filename="${String(name).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80)}"`);
	res.status(200).end(buf);
}
