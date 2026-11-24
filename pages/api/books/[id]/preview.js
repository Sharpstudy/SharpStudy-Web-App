import { bookHandler, repo, getStorage, sendFile } from "@/lib/books/http";
import { publicAsset } from "@/lib/books/service";

// The limited preview (a separate sample PDF chosen by the administrator) of a PUBLISHED book.
// The full book file is never served from this route.
export default bookHandler({
	GET: async (req, res) => {
		const { path, mime } = await publicAsset(repo, req.query.id, "preview");
		const storage = getStorage();
		// Object storage: hand out a short-lived link (previews can exceed a serverless response cap).
		if (storage.presignGet) return res.redirect(302, await storage.presignGet(path, { ttl: 300, contentType: mime }));
		sendFile(res, await storage.get(path), mime, "preview.pdf", { cache: "public, max-age=600" });
	},
});
