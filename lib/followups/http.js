import { FollowupError } from "./service";
import { requireRole } from "@/lib/auth/requireRole";

// Maps FollowupError to a JSON response; anything else is a generic 500 (message logged, never the request body).
export const handle = (fn) => async (req, res) => {
	res.setHeader("Cache-Control", "no-store");
	try {
		await fn(req, res);
	} catch (e) {
		if (e instanceof FollowupError) {
			return res.status(e.status).json({ code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) });
		}
		console.error(`[followups] ${req.method} ${String(req.url).split("?")[0]}: ${e && e.message}`);
		res.status(500).json({ code: "server_error", message: "Something went wrong. Please try again." });
	}
};

export const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

export const methodNotAllowed = (req, res, allowed) => {
	if (allowed.includes(req.method)) return false;
	res.setHeader("Allow", allowed.join(", "));
	res.status(405).json({ message: `Method ${req.method} not allowed` });
	return true;
};

// Any signed-in account (verified token, role re-read from the database). This only identifies the caller: the service then decides,
// from the database, whether they are an admin or an ACTIVE approved telecaller, and refuses everyone else with 403.
export const requireAccount = (req, res) => requireRole(req, res, ["student", "instructor", "admin"]);
// Administrators only.
export const requireAdminActor = (req, res) => requireRole(req, res, ["admin"]);
