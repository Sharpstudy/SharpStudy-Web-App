import { handle, body, methodNotAllowed, requireAccount } from "@/lib/telecallers/http";
import { telecallerDeps } from "@/lib/telecallers/deps";
import { getMine, saveDraft, submitApplication, reapply } from "@/lib/telecallers/service";
import { rateLimit } from "@/lib/mastery-server/http";

// The applicant side of "Become a Telecaller". It only ever touches the signed-in user's OWN application: the user id
// comes from the verified token and the role from the database, never from the request.
//   GET  -> my application, my resume list (no file bytes) and what the form needs
//   PUT  -> save draft
//   POST -> submit (pending), also the resubmission after "more information requested"
//   POST { action: "reapply" } -> a new attempt after a rejection and the waiting period
// Submitting never grants access: approval is an admin-only action in /api/admin/telecallers/applications.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET", "PUT", "POST"])) return;
	const actor = await requireAccount(req, res);
	if (!actor) return;
	const deps = telecallerDeps();
	if (req.method === "GET") return res.status(200).json(await getMine(deps, actor));
	if (req.method === "PUT") return res.status(200).json(await saveDraft(deps, actor, body(req)));
	if (!rateLimit(req, res, "telecaller-app-submit", { windowMs: 60 * 60 * 1000, max: 20 }, actor.userId)) return;
	if (body(req).action === "reapply") return res.status(200).json(await reapply(deps, actor));
	res.status(200).json(await submitApplication(deps, actor, body(req)));
});
