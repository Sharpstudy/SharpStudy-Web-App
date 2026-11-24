import { requireRole } from "@/lib/auth/requireRole";
import User from "database/models/user";
import { InstructorApplication, InstructorProfile } from "@/database/models/instructor_application";
import { INSTRUCTOR_LIST_ATTRS, toInstructorRow } from "@/lib/admin/instructorList";

export default async function handler(req, res) {
	if (!(await requireRole(req, res, ["admin"]))) return;
	// Always fresh: a phone number an instructor just saved must show up on the next load.
	res.setHeader("Cache-Control", "no-store");
	switch (req.method) {
		case "GET":
			await handleGet(req, res);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
}

// Extra sources are optional: a table that is not migrated yet must not break the list.
const safely = async (p) => {
	try {
		return await p;
	} catch (e) {
		return [];
	}
};

const handleGet = async (req, res) => {
	try {
		// Everyone who currently HAS instructor access (the role is the source of truth,
		// not the legacy request flags). Explicit columns only: nothing else about the user is sent.
		const users = await User.findAll({
			attributes: INSTRUCTOR_LIST_ATTRS,
			where: { role: "instructor" },
			order: [["created_at", "DESC"]],
		});
		const ids = users.map((u) => u.id);

		const [profiles, applications] = ids.length
			? await Promise.all([
					safely(InstructorProfile.findAll({ where: { user_id: ids }, attributes: ["user_id", "subjects"], raw: true })),
					safely(InstructorApplication.findAll({ where: { user_id: ids }, attributes: ["user_id", "phone", "created_at"], order: [["created_at", "DESC"]], raw: true })),
			  ])
			: [[], []];
		const profileBy = new Map(profiles.map((p) => [p.user_id, p]));
		// newest application that actually has a phone number
		const appBy = new Map();
		for (const a of applications) if (a.phone && !appBy.has(a.user_id)) appBy.set(a.user_id, a);

		const instructors = users.map((u) => toInstructorRow(u.get({ plain: true }), profileBy.get(u.id), appBy.get(u.id)));
		res.status(200).json({ instructors });
	} catch (e) {
		res.status(400).json({
			error_code: "get_instructors",
			message: e.message,
		});
	}
};
