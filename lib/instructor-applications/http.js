import { ApplicationError } from "./service";
import { requireRole } from "@/lib/auth/requireRole";

// Maps ApplicationError to a JSON response; anything else is a generic 500 (message logged, never the request body).
export const handle = (fn) => async (req, res) => {
	res.setHeader("Cache-Control", "no-store");
	try {
		await fn(req, res);
	} catch (e) {
		if (e instanceof ApplicationError) {
			return res.status(e.status).json({ code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) });
		}
		console.error(`[instructor-applications] ${req.method} ${String(req.url).split("?")[0]}: ${e && e.message}`);
		res.status(500).json({ code: "server_error", message: "Something went wrong. Please try again." });
	}
};

export const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

// 405 helper: returns true when the method is not allowed (and has answered).
export const methodNotAllowed = (req, res, allowed) => {
	if (allowed.includes(req.method)) return false;
	res.setHeader("Allow", allowed.join(", "));
	res.status(405).json({ message: `Method ${req.method} not allowed` });
	return true;
};

// Any signed-in, enabled account (token verified, role re-read from the database).
export const requireAccount = (req, res) => requireRole(req, res, ["student", "instructor", "admin"]);
