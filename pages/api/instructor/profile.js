import { requireRole } from "@/lib/auth/requireRole";
import profileRepo from "@/lib/instructor/profileRepo";
import { ProfileError, getOwnProfile, saveOwnProfile } from "@/lib/instructor/profileService";

// An instructor's OWN teaching profile. The user id comes from the verified token; there is
// no way to name another user. Admins may use it for their own account only.
export default async function handler(req, res) {
	if (!["GET", "PUT"].includes(req.method)) {
		res.setHeader("Allow", "GET, PUT");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	const actor = await requireRole(req, res, ["instructor", "admin"]);
	if (!actor) return;
	res.setHeader("Cache-Control", "no-store");
	try {
		res.status(200).json(req.method === "PUT" ? await saveOwnProfile(profileRepo, actor, req.body) : await getOwnProfile(profileRepo, actor.userId));
	} catch (e) {
		if (e instanceof ProfileError) return res.status(e.status).json({ code: e.code, message: e.message });
		console.error(`[instructor-profile] ${e && e.message}`);
		res.status(500).json({ code: "server_error", message: "Could not save your profile." });
	}
}
