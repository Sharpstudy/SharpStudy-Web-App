// Admin-only: one instructor's profile, teaching statistics, sessions, courses and students (read-only).
import { requireRole } from "@/lib/auth/requireRole";
import repo from "@/lib/admin/instructorDetailsRepo";
import { DetailsError, loadInstructorDetails } from "@/lib/admin/instructorDetails";

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store");
	// Verified token + role re-read from the database; inactive or non-admin callers never reach the queries.
	const actor = await requireRole(req, res, ["admin"]);
	if (!actor) return;
	if (req.method !== "GET") {
		res.setHeader("Allow", "GET");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	try {
		res.status(200).json(await loadInstructorDetails(repo, req.query.id));
	} catch (e) {
		if (e instanceof DetailsError) return res.status(e.status).json({ message: e.message });
		console.error("admin/instructors:", e.name, e.message);
		res.status(500).json({ message: "Something went wrong. Please try again." });
	}
}
