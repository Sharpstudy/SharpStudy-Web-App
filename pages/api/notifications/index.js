import { apiHandler, getAccountActor, body } from "@/lib/mastery-server/http";
import sessionRepo from "@/lib/live-sessions/repo";
import { listNotifications, markNotificationsRead } from "@/lib/live-sessions/notify";

// The signed-in user's own in-app notifications.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		const r = await listNotifications(sessionRepo, actor);
		if (r.status === 401) return res.status(401).json({ message: "Sign in first" });
		res.status(200).json({ notifications: r.notifications, unread: r.unread });
	},
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		const b = body(req);
		const r = await markNotificationsRead(sessionRepo, actor, b.ids);
		if (r.status === 401) return res.status(401).json({ message: "Sign in first" });
		res.status(200).json({ unread: r.unread });
	},
});
