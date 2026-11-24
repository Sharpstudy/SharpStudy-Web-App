// Shared plumbing for the credential endpoints: method check, no-store, error mapping, and rate limits that can be silent.
import { AuthError } from "./passwordReset.js";
import { isMissingSchema } from "./credentialsRepo";
import { createRateLimiter } from "@/lib/mastery/ratelimit";

export const handleAuth = (methods) => async (req, res) => {
	res.setHeader("Cache-Control", "no-store");
	const fn = methods[req.method];
	if (!fn) {
		res.setHeader("Allow", Object.keys(methods).join(", "));
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	try {
		await fn(req, res);
	} catch (e) {
		if (e instanceof AuthError) return res.status(e.status).json({ code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) });
		if (isMissingSchema(e)) {
			console.error("[auth] database is missing the auth security columns: run migration 20261110000000-add-auth-security-columns");
			return res.status(503).json({ code: "unavailable", message: "This feature is temporarily unavailable. Please try again later." });
		}
		// message only: never the request body (it holds passwords / tokens)
		console.error(`[auth] ${req.method} ${String(req.url).split("?")[0]}: ${e && e.name}`);
		res.status(500).json({ code: "server_error", message: "Something went wrong. Please try again." });
	}
};

export const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

// A limiter that answers true / false instead of writing a response (used for per-e-mail limits, whose refusal must look like success).
const quiet = new Map();
export function allow(name, { windowMs, max }, key) {
	if (!quiet.has(name)) quiet.set(name, createRateLimiter({ windowMs, max }));
	return quiet.get(name)(String(key)).ok;
}
