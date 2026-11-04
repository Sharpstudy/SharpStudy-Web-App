// Server-side: does this account hold an ACTIVE, approved telecaller_profiles row right now? Read from the database on every call
// (used by the login landing redirect). Same rule as `telecaller_access` in /api/users/update: status "active" AND approved_at set,
// never an admin, never a child's learner login. Any failure (for example the table is not migrated yet) means "no".
import { TelecallerProfile } from "@/database/models/telecaller";
import { ML_Learner } from "@/database/models/mastery";

export async function isActiveTelecaller(user) {
	try {
		if (!user || user.role === "admin") return false;
		const p = await TelecallerProfile.findByPk(user.id, { attributes: ["status", "approved_at"] });
		if (!p || p.status !== "active" || !p.approved_at) return false;
		return (await ML_Learner.count({ where: { student_user_id: user.id } })) === 0;
	} catch (e) {
		return false;
	}
}
