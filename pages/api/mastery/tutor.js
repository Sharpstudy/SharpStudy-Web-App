import { apiHandler, getLearnerActor, repo, body, rateLimit } from "@/lib/mastery-server/http";
import { tutorRequest, getTutorSettings } from "@/lib/mastery/service";
import { getTutorAi, tutorAiConfigured } from "@/lib/mastery-server/ai";

// Sage tutor. Body: { startToken, questionIndex, mode, message?, attempted? }
export default apiHandler({
	// What the help panel can offer (no secrets).
	GET: async (req, res) => {
		const s = await getTutorSettings(repo);
		res.status(200).json({ enabled: s.enabled, chatEnabled: s.enabled && s.chatEnabled, aiAvailable: s.enabled && tutorAiConfigured() });
	},
	POST: async (req, res) => {
		const actor = await getLearnerActor(req);
		if (!rateLimit(req, res, "tutor-ip", { windowMs: 60 * 1000, max: 20 })) return;
		const settings = await getTutorSettings(repo);
		if (actor && !rateLimit(req, res, "tutor-learner", { windowMs: 60 * 60 * 1000, max: settings.maxRequestsPerHour }, actor.learnerId)) return;
		res.status(200).json(await tutorRequest(repo, actor, body(req), { ai: getTutorAi(), settings }));
	},
});
