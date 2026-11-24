// Server-side: does this account hold an ACTIVE, approved telecaller_profiles row right now? Read from the database on every call
// (used by the login landing redirect). Same rule as `telecaller_access` in /api/users/update: status "active" AND approved_at set,
// never an admin, never a child's learner login. Any failure (for example the table is not migrated yet) means "no".
import { TelecallerProfile, TelecallerApplication } from "@/database/models/telecaller";
import { telecallerState } from "./telecallerState.js";
import { ML_Learner } from "@/database/models/mastery";

// The full account state from the database (see lib/auth/telecallerState.js). Any failure (for example a table that is not migrated
// yet) means "none", exactly like isActiveTelecaller below: nothing here can grant access, it only decides where a person is sent.
export async function telecallerStateFor(user) {
	try {
		if (!user || user.role === "admin") return "none";
		const [p, learners] = await Promise.all([
			TelecallerProfile.findByPk(user.id, { attributes: ["status", "approved_at"] }),
			ML_Learner.count({ where: { student_user_id: user.id } }),
		]);
		let applicationStatus = null;
		if (!p) {
			const app = await TelecallerApplication.findOne({ where: { user_id: user.id }, attributes: ["status"] });
			applicationStatus = app ? app.status : null;
		}
		return telecallerState({ role: user.role, isLearner: learners > 0, applicationStatus, profileStatus: p ? p.status : null, approvedAt: p ? p.approved_at : null });
	} catch (e) {
		return "none";
	}
}

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
