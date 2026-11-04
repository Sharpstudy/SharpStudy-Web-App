import { apiHandler, getAccountActor, rateLimit } from "@/lib/mastery-server/http";
import sessionRepo from "@/lib/live-sessions/repo";
import { takeSeat, releaseSeat } from "@/lib/live-sessions/service";

// Book (or cancel) the caller's own seat. The user comes from the signed token only.
// Booking is free of charge: access comes from an existing paid course enrolment and this never charges anyone.
export default apiHandler({
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "ls-seat", { windowMs: 60000, max: 30 }, actor.userId)) return;
		res.status(200).json({ session: await takeSeat(sessionRepo, actor, req.query.id) });
	},
	DELETE: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(await releaseSeat(sessionRepo, actor, req.query.id));
	},
});
