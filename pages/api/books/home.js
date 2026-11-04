import { bookHandler, repo, rateLimit } from "@/lib/books/http";
import { homeSections } from "@/lib/books/service";

// Featured / popular / new / recommended rows. `ageGroup` (or `age`, `grade`) only steers the
// recommended row; it is a query value, not account data.
export default bookHandler(
	{
		GET: async (req, res) => {
			if (!rateLimit(req, res, "books-home", { windowMs: 60000, max: 240 })) return;
			res.status(200).json(await homeSections(repo, req.query));
		},
	},
	{ cache: "public, max-age=0, s-maxage=30, stale-while-revalidate=60" }
);
