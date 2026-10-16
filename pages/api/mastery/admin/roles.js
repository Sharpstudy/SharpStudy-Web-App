import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { listRoles, createRole, updateRole, deleteRole } from "@/lib/mastery/admin";

export default apiHandler({
	GET: async (req, res) => {
		res.status(200).json(await listRoles(repo, await getAccountActor(req)));
	},
	POST: async (req, res) => {
		res.status(201).json({ role: await createRole(repo, await getAccountActor(req), body(req), { ip: clientIp(req) }) });
	},
	// Body: { id, name?, description?, permissions? }
	PATCH: async (req, res) => {
		const b = body(req);
		res.status(200).json({ role: await updateRole(repo, await getAccountActor(req), String(b.id || ""), b, { ip: clientIp(req) }) });
	},
	DELETE: async (req, res) => {
		res.status(200).json(await deleteRole(repo, await getAccountActor(req), String(body(req).id || ""), { ip: clientIp(req) }));
	},
});
