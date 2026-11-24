// Admin-only account management for one student or instructor.
//   GET    -> details + counts of records that stay attached to the account
//   PATCH  -> { active: boolean }       deactivate / reactivate (status flag only)
//   DELETE -> { confirmEmail }          "delete" = irreversible anonymization; no row or record is removed
import { requireRole } from "@/lib/auth/requireRole";
import accountsRepo from "@/lib/admin/accountsRepo";
import { AccountError, getDetails, setActive, anonymizeAccount } from "@/lib/admin/accounts";

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store");
	// Verified token + role re-read from the database (and inactive actors are rejected).
	const actor = await requireRole(req, res, ["admin"]);
	if (!actor) return;
	const id = req.query.id;
	try {
		switch (req.method) {
			case "GET":
				return res.status(200).json(await getDetails(accountsRepo, actor, id));
			case "PATCH":
				return res.status(200).json(await setActive(accountsRepo, actor, id, (req.body || {}).active));
			case "DELETE":
				return res.status(200).json(await anonymizeAccount(accountsRepo, actor, id, req.body || {}));
			default:
				res.setHeader("Allow", "GET, PATCH, DELETE");
				return res.status(405).json({ message: `Method ${req.method} not allowed` });
		}
	} catch (e) {
		if (e instanceof AccountError) return res.status(e.status).json({ message: e.message });
		console.error("admin/users:", e.name, e.message);
		return res.status(500).json({ message: "Something went wrong. Please try again." });
	}
}
