import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { listUsers, setUserRole, setUserCustomRoles } from "@/lib/mastery/admin";

export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await listUsers(repo, actor, { q: req.query.q, page: req.query.page }));
	},
	// Body: { userId, role?, roleIds? }
	PATCH: async (req, res) => {
		const actor = await getAccountActor(req);
		const { userId, role, roleIds } = body(req);
		if (role !== undefined) await setUserRole(repo, actor, userId, role, { ip: clientIp(req) });
		if (roleIds !== undefined) await setUserCustomRoles(repo, actor, userId, roleIds, { ip: clientIp(req) });
		res.status(200).json({ ok: true });
	},
});
