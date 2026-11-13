import { bookHandler, repo, actorFor, getStorage, sendFile, rateLimit } from "@/lib/books/http";
import { authorizeContent } from "@/lib/books/service";

// The protected book file. The caller is the verified account; a PAID order for THIS book (or an
// administrator) is re-checked on every request. The bytes are never cached and the storage key is
// never sent to the browser. Access controls limit casual sharing; they cannot stop a determined
// reader from saving what their browser displays.
export default bookHandler({
	GET: async (req, res) => {
		const actor = await actorFor(req);
		if (!rateLimit(req, res, "books-content", { windowMs: 60000, max: 60 }, actor.userId)) return;
		const book = await authorizeContent(repo, actor, req.query.id);
		sendFile(res, await getStorage().get(book.file_path), book.file_mime || "application/pdf", `${book.slug}.pdf`);
	},
});
