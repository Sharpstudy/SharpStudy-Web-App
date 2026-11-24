import { handle, body, methodNotAllowed, requireAccount } from "@/lib/telecallers/http";
import { telecallerDeps } from "@/lib/telecallers/deps";
import { uploadResume } from "@/lib/telecallers/service";
import { rateLimit } from "@/lib/mastery-server/http";

// Add a resume VERSION to the signed-in applicant's own application: { filename, data } with data = base64.
// 2 MB maximum (base64 inflates by a third, hence the larger body limit); PDF / DOC / DOCX only, checked by file signature.
// Earlier versions are never replaced. Applicants cannot download or list file bytes: only an admin can (a separate route).
export const config = { api: { bodyParser: { sizeLimit: "3.5mb" } } };

export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["POST"])) return;
	const actor = await requireAccount(req, res);
	if (!actor) return;
	if (!rateLimit(req, res, "telecaller-resume", { windowMs: 60 * 60 * 1000, max: 20 }, actor.userId)) return;
	const b = body(req);
	res.status(200).json(await uploadResume(telecallerDeps(), actor, { filename: b.filename, data: b.data }));
});
