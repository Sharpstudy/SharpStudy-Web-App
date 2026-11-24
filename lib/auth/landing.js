// Where a signed-in user should land when they open the public homepage.
// Students and instructors go to their dashboard; admins and visitors stay.
// Identity comes from the signed token and the role is re-read from the
// database (never from the browser).
import { verifyAccountToken } from "@/lib/mastery/tokens";
import repo from "@/lib/mastery-server/repo";
import { InstructorApplication } from "@/database/models/instructor_application";
import { accountIsActive } from "./accountState.js";
import { telecallerStateFor } from "./telecallerAccess.js";
import { destinationFor } from "./telecallerState.js";
import { isTokenRevoked } from "./tokenRevocation.js";
import credentialsRepo from "./credentialsRepo.js";
import { TELECALLER_HOME } from "./telecallerNav.js";

import { dashboardHome, DASHBOARD_ROLES } from "@/components/_App/accountLinks";

export async function landingRedirect(req) {
	const token = req.cookies && req.cookies.edmy_users_token;
	const claims = token && verifyAccountToken(token);
	if (!claims) return null;
	const [user, passwordChangedAt] = await Promise.all([repo.getUser(claims.userId), credentialsRepo.passwordChangedAt(claims.userId)]);
	if (!accountIsActive(user) || !user.email_confirmed || isTokenRevoked(claims.iat, passwordChangedAt) || !DASHBOARD_ROLES.includes(user.role)) return null;
	// Telecaller accounts are ordinary role=student rows, so the role alone says nothing: the state is read from telecaller_applications /
	// telecaller_profiles now. An ACTIVE telecaller lands on the telecaller dashboard; an applicant (draft, pending, more information,
	// rejected) or a deactivated telecaller lands on the application / access status page. NEVER on My Learning.
	if (user.role === "student") {
		const to = destinationFor(await telecallerStateFor(user), TELECALLER_HOME);
		if (to) return { destination: to, permanent: false };
	}
	// A student whose instructor application is still open lands on its status page. Approval is what changes the
	// role (and so the landing page); this only decides where the student account goes first.
	if (user.role === "student" && (await hasOpenApplication(user.id))) {
		return { destination: APPLICATION_STATUS_PAGE, permanent: false };
	}
	return { destination: dashboardHome(user.role), permanent: false };
}

export const APPLICATION_STATUS_PAGE = "/become-an-instructor/";
const OPEN_APPLICATION = ["pending", "under_review", "more_info_requested"];

// Never blocks the landing: a failure (for example the applications table not migrated yet) means "no open application".
async function hasOpenApplication(userId) {
	try {
		const app = await InstructorApplication.findOne({ where: { user_id: userId }, attributes: ["status"] });
		return !!app && OPEN_APPLICATION.includes(app.status);
	} catch (e) {
		return false;
	}
}
