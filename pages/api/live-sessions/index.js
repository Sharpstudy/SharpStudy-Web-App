import { apiHandler, getAccountActor, body, rateLimit } from "@/lib/mastery-server/http";
import sessionRepo from "@/lib/live-sessions/repo";
import { createSession, listSessions } from "@/lib/live-sessions/service";
import { notifyAfter } from "@/lib/live-sessions/notifyHttp";

export default apiHandler({
	// ?scope=teaching -> the instructor's own sessions; otherwise the caller's seats + bookable sessions.
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		const scope = req.query.scope === "teaching" ? "teaching" : "mine";
		res.status(200).json(await listSessions(sessionRepo, actor, { scope }));
	},
	// The instructor is always the signed-in user (or the course owner for an admin);
	// any instructor id in the body is ignored. Assigned students are re-validated server-side.
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "ls-create", { windowMs: 60000, max: 20 }, actor.userId)) return;
		const session = await createSession(sessionRepo, actor, body(req));
		// The session is saved. Telling the students can fail without affecting it.
		const notified = await notifyAfter("assigned", session, actor);
		res.status(201).json({ session, notified });
	},
});
