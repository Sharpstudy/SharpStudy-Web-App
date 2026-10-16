import { apiHandler, getAccountActor, rateLimit } from "@/lib/mastery-server/http";
import sessionRepo from "@/lib/live-sessions/repo";
import { joinSession } from "@/lib/live-sessions/service";

// The only place a room name is ever returned. Ownership / seat / paid enrolment /
// join window are re-validated on every call, so a stale page cannot keep a room.
export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "ls-join", { windowMs: 60000, max: 30 }, actor.userId)) return;
		const domain = process.env.JITSI_DOMAIN || "meet.jit.si";
		res.status(200).json(await joinSession(sessionRepo, actor, req.query.id, { domain }));
	},
});
