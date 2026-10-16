import { apiHandler, getAccountActor, body } from "@/lib/mastery-server/http";
import { ServiceError } from "@/lib/mastery/service";
import sessionRepo from "@/lib/live-sessions/repo";
import { getSessionDetail, rescheduleSession, cancelSession, endSession } from "@/lib/live-sessions/service";
import { notifyAfter } from "@/lib/live-sessions/notifyHttp";

export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json({ session: await getSessionDetail(sessionRepo, actor, req.query.id) });
	},
	// Instructor controls: { action: "reschedule" | "cancel" | "end", ...when }
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		const b = body(req);
		const run = {
			reschedule: () => rescheduleSession(sessionRepo, actor, req.query.id, b),
			cancel: () => cancelSession(sessionRepo, actor, req.query.id),
			end: () => endSession(sessionRepo, actor, req.query.id),
		}[String(b.action)];
		if (!run) throw new ServiceError(422, "invalid", "Unknown action");
		const session = await run();
		// Saved first; notifying is idempotent (a retry never notifies twice) and cannot undo the change.
		const kind = { reschedule: "rescheduled", cancel: "cancelled" }[String(b.action)];
		const notified = kind ? await notifyAfter(kind, session, actor) : null;
		res.status(200).json({ session, notified });
	},
});
