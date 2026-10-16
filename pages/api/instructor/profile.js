import User from "database/models/user";
import { InstructorProfile } from "@/database/models/instructor_application";
import { requireRole } from "@/lib/auth/requireRole";

const line = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const block = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, n);
const url = (s) => {
	const v = String(s == null ? "" : s).trim();
	if (!v) return "";
	try {
		const u = new URL(v);
		return u.protocol === "https:" && v.length <= 255 ? u.toString() : null;
	} catch (e) {
		return null;
	}
};

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
		if (req.method === "PUT") {
			const b = req.body && typeof req.body === "object" ? req.body : {};
			const links = { website: url(b.website), linkedin: url(b.linkedin) };
			if (links.website === null || links.linkedin === null) return res.status(422).json({ code: "invalid", message: "Links must be public https:// addresses." });
			await User.update({ designation: line(b.designation, 120), bio: block(b.bio, 3000), location: line(b.location, 120), website: links.website, linkedin: links.linkedin }, { where: { id: actor.userId } });
			const profile = { qualifications: block(b.qualifications, 2000), languages: line(b.languages, 200), subjects: line(b.subjects, 300), experience: block(b.experience, 3000) };
			const [row, created] = await InstructorProfile.findOrCreate({ where: { user_id: actor.userId }, defaults: profile });
			if (!created) await row.update(profile);
		}
		const user = await User.findByPk(actor.userId, { attributes: ["first_name", "last_name", "email", "designation", "bio", "profile_photo", "location", "website", "linkedin"] });
		const p = await InstructorProfile.findByPk(actor.userId);
		res.status(200).json({
			profile: { ...(user ? user.get({ plain: true }) : {}), qualifications: (p && p.qualifications) || "", languages: (p && p.languages) || "", subjects: (p && p.subjects) || "", experience: (p && p.experience) || "" },
		});
	} catch (e) {
		console.error(`[instructor-profile] ${e && e.message}`);
		res.status(500).json({ code: "server_error", message: "Could not save your profile." });
	}
}
