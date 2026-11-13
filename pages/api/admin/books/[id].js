import { bookHandler, repo, actorFor } from "@/lib/books/http";
import { adminGetBook, adminUpdateBook } from "@/lib/books/service";

export default bookHandler({
	GET: async (req, res) => {
		res.status(200).json(await adminGetBook(repo, await actorFor(req), req.query.id));
	},
	PATCH: async (req, res) => {
		res.status(200).json(await adminUpdateBook(repo, await actorFor(req), req.query.id, req.body));
	},
});
