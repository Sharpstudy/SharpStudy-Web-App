import { handle } from "@/lib/meetings/http";
import { meetingDeps } from "@/lib/meetings/deps";
import { visitorView, visitorAct } from "@/lib/meetings/service";
import { rateLimit } from "@/lib/mastery-server/http";

// Public, but only for the person holding the secret link from their e-mail /
// confirmation page: view their own request, cancel it, or accept a proposed time.
export default handle(async (req, res) => {
	if (!["GET", "POST"].includes(req.method)) {
		res.setHeader("Allow", "GET, POST");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	if (!rateLimit(req, res, "meeting-manage", { windowMs: 10 * 60 * 1000, max: 40 })) return;
	if (req.method === "GET") {
		return res.status(200).json({ request: await visitorView(meetingDeps(), String(req.query.ref || ""), String(req.query.token || "")) });
	}
	const b = req.body && typeof req.body === "object" ? req.body : {};
	res.status(200).json({ request: await visitorAct(meetingDeps(), String(b.ref || ""), String(b.token || ""), String(b.action || "")) });
});
