import { apiHandler, getAccountActor, repo, body, clientIp, rateLimit } from "@/lib/mastery-server/http";
import { ServiceError } from "@/lib/mastery/service";
import { requireRole } from "@/lib/auth/requireRole";
import { createStudentProfile, linkStudentProfile, unlinkStudentProfile } from "@/lib/mastery/studentLinks";

// { action: "create", studentUserId, displayName?, pin, subjects, grade?, age?/birthDate?, ... }
// { action: "link", studentUserId, learnerId, confirm: true }
// { action: "unlink", learnerId }
// Always an explicit, authorised instructor action: the student must be a paid student of the caller's
// own course and the learner must be one the caller manages. Nothing here links by name or e-mail.
export default apiHandler({
	POST: async (req, res) => {
		if (!(await requireRole(req, res, ["instructor", "admin"]))) return;
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "inst-link", { windowMs: 60000, max: 30 }, actor.userId)) return;
		const b = body(req);
		const ctx = { ip: clientIp(req) };
		if (b.action === "create") return res.status(201).json(await createStudentProfile(repo, actor, b, ctx));
		if (b.action === "link") return res.status(200).json(await linkStudentProfile(repo, actor, b, ctx));
		if (b.action === "unlink") return res.status(200).json(await unlinkStudentProfile(repo, actor, b));
		throw new ServiceError(422, "invalid", "Unknown action");
	},
});
