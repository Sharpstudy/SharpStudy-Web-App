// Server-side role gate for legacy admin API routes. Those routes used to
// check only that an Authorization header *existed*, so any string passed.
// This verifies the signed token and re-reads the role from the database.
import { getAccountActor } from "@/lib/mastery-server/http";

// Returns the actor, or writes a 401/403 response and returns null.
export async function requireRole(req, res, roles = ["admin"]) {
	const actor = await getAccountActor(req);
	if (!actor) {
		res.status(401).json({ message: "Sign in required" });
		return null;
	}
	if (!roles.includes(actor.role)) {
		res.status(403).json({ message: "You do not have permission to do this" });
		return null;
	}
	return actor;
}
