import { handle, body, methodNotAllowed, requireAccount } from "@/lib/instructor-applications/http";
import { applicationDeps } from "@/lib/instructor-applications/deps";
import { getMine, saveDraft, submitApplication, reapply } from "@/lib/instructor-applications/service";
import { rateLimit } from "@/lib/mastery-server/http";

// The applicant side of "Become an Instructor" (the existing endpoint, now backed by a real
// application record). It only ever touches the signed-in user's OWN application: the user id
// comes from the verified token and the role from the database, never from the request.
//   GET  -> my application + form data      PUT  -> save draft
//   POST -> submit (pending)                POST { action: "reapply" } -> new draft after a rejection
// Submitting never grants a role; approval is an admin-only action in /api/instructor/requests.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET", "PUT", "POST"])) return;
	const actor = await requireAccount(req, res);
	if (!actor) return;
	const deps = applicationDeps();
	if (req.method === "GET") return res.status(200).json(await getMine(deps, actor));
	if (req.method === "PUT") return res.status(200).json(await saveDraft(deps, actor, body(req)));
	if (!rateLimit(req, res, "instructor-app-submit", { windowMs: 60 * 60 * 1000, max: 20 }, actor.userId)) return;
	if (body(req).action === "reapply") return res.status(200).json(await reapply(deps, actor));
	res.status(200).json(await submitApplication(deps, actor, body(req)));
});
