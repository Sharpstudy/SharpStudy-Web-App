import { bookHandler, repo, actorFor, getStorage, sendFile } from "@/lib/books/http";
import { publicAsset } from "@/lib/books/service";

// The cover of a PUBLISHED book. Covers are public by design; the file itself is not in /public.
export default bookHandler({
	GET: async (req, res) => {
		const actor = req.headers.authorization ? await actorFor(req, { optional: true }) : null;
		const { path, mime } = await publicAsset(repo, req.query.id, "cover", actor);
		// An unpublished cover (admin preview) must not be cached by shared caches.
		sendFile(res, await getStorage().get(path), mime, "cover", { cache: actor && actor.role === "admin" ? "private, no-store" : "public, max-age=3600" });
	},
});
