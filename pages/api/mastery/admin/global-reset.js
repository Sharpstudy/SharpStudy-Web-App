import bcrypt from "bcrypt";
import { apiHandler, getAccountActor, repo, body, clientIp, rateLimit } from "@/lib/mastery-server/http";
import { globalReset, requirePermission } from "@/lib/mastery/service";
import { PERMISSIONS } from "@/lib/mastery/policy";

// Deletes ALL learner attempts/activity and resets placements.
// Needs system.global_reset + the typed phrase + the admin's own password.
export default apiHandler({
	POST: async (req, res) => {
		if (!rateLimit(req, res, "global-reset", { windowMs: 15 * 60 * 1000, max: 5 })) return;
		const actor = await getAccountActor(req);
		requirePermission(actor, PERMISSIONS.GLOBAL_RESET);
		const { phrase, password } = body(req);
		const me = await repo.getUserWithPassword(actor.userId);
		const passwordOk = !!(me && me.password && password && (await bcrypt.compare(String(password), me.password)));
		res.status(200).json(await globalReset(repo, actor, { phrase, passwordOk }, { ip: clientIp(req) }));
	},
});
