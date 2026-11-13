import { bookHandler, repo, actorFor, rateLimit } from "@/lib/books/http";
import { getProgress, saveProgress } from "@/lib/books/service";

// Reading position for the signed-in account only; the account id comes from the verified token.
export default bookHandler({
	GET: async (req, res) => {
		const actor = await actorFor(req);
		res.status(200).json(await getProgress(repo, actor, req.query.id));
	},
	PUT: async (req, res) => {
		const actor = await actorFor(req);
		if (!rateLimit(req, res, "books-progress", { windowMs: 60000, max: 120 }, actor.userId)) return;
		res.status(200).json({ progress: await saveProgress(repo, actor, req.query.id, req.body) });
	},
});
