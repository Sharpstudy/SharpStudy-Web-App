import { apiHandler, getAccountActor, body } from "@/lib/mastery-server/http";
import liveRepo from "@/lib/live-questions/repo";
import { ServiceError } from "@/lib/mastery/service";
import { publishQuestion, closeQuestion, revealQuestion, publishResults, deleteDraft, updateDraft, setCorrectOption } from "@/lib/live-questions/service";

const ACTIONS = {
	publish: publishQuestion,
	close: closeQuestion,
	reveal: revealQuestion,
	publish_results: publishResults,
};

export default apiHandler({
	// Instructor controls: { action: "publish" | "close" | "reveal" | "publish_results" | "set_correct" (+ optionId) }
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		const b = body(req);
		if (b.action === "set_correct") {
			return res.status(200).json({ question: await setCorrectOption(liveRepo, actor, req.query.slug, req.query.qid, b.optionId) });
		}
		const fn = ACTIONS[String(b.action)];
		if (!fn) throw new ServiceError(422, "invalid", "Unknown action");
		res.status(200).json({ question: await fn(liveRepo, actor, req.query.slug, req.query.qid) });
	},
	// Edit an unpublished question (the answer key must be chosen explicitly again).
	PUT: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json({ question: await updateDraft(liveRepo, actor, req.query.slug, req.query.qid, body(req)) });
	},
	DELETE: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await deleteDraft(liveRepo, actor, req.query.slug, req.query.qid));
	},
});
