import { handle, methodNotAllowed, requireAdminActor } from "@/lib/telecallers/http";
import { telecallerDeps } from "@/lib/telecallers/deps";
import { getResumeForAdmin } from "@/lib/telecallers/service";

// Admin-only download of ONE resume version. There is no public URL: the file is stored privately and this is the only
// place its bytes are read. Every download is recorded in the audit log. The file is always sent as an attachment of one
// of the three allowed types, never cached, and never sniffed or rendered by the browser as a page.
export default handle(async (req, res) => {
	if (methodNotAllowed(req, res, ["GET"])) return;
	const actor = await requireAdminActor(req, res);
	if (!actor) return;
	const f = await getResumeForAdmin(telecallerDeps(), actor, String(req.query.id || ""));
	const ascii = f.filename.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_");
	res.setHeader("Content-Type", f.mime);
	res.setHeader("Content-Length", String(f.buffer.length));
	res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
	res.status(200).send(f.buffer);
});
