import { bookHandler, repo, rateLimit } from "@/lib/books/http";
import { listCatalog } from "@/lib/books/service";

// Public catalogue. Every filter is validated on the server (unknown values are a 400, never ignored)
// and results are paginated. Only published books are ever returned.
export default bookHandler(
	{
		GET: async (req, res) => {
			if (!rateLimit(req, res, "books-list", { windowMs: 60000, max: 240 })) return;
			res.status(200).json(await listCatalog(repo, req.query));
		},
	},
	{ cache: "public, max-age=0, s-maxage=30, stale-while-revalidate=60" }
);
