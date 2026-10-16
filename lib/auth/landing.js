// Where a signed-in user should land when they open the public homepage.
// Students and instructors go to their dashboard; admins and visitors stay.
// Identity comes from the signed token and the role is re-read from the
// database (never from the browser).
import { verifyAccountToken } from "@/lib/mastery/tokens";
import repo from "@/lib/mastery-server/repo";
import { dashboardHome, DASHBOARD_ROLES } from "@/components/_App/accountLinks";

export async function landingRedirect(req) {
	const token = req.cookies && req.cookies.edmy_users_token;
	const claims = token && verifyAccountToken(token);
	if (!claims) return null;
	const user = await repo.getUser(claims.userId);
	if (!user || user.status === false || !DASHBOARD_ROLES.includes(user.role)) return null;
	return { destination: dashboardHome(user.role), permanent: false };
}
