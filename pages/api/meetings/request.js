import { handle } from "@/lib/meetings/http";
import { meetingDeps } from "@/lib/meetings/deps";
import { submitRequest } from "@/lib/meetings/service";
import { rateLimit } from "@/lib/mastery-server/http";

// Public: submit a meeting request. Rate limited per client address (and per
// e-mail address inside the service). The visitor learns only their own
// reference and secret status link.
export default handle(async (req, res) => {
	if (req.method !== "POST") {
		res.setHeader("Allow", "POST");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	if (!rateLimit(req, res, "meeting-request", { windowMs: 60 * 60 * 1000, max: 30 })) return;
	const body = req.body && typeof req.body === "object" ? req.body : {};
	// Hidden "website" field: humans leave it empty, simple bots fill it. Pretend success, store nothing.
	if (body.website) return res.status(201).json({ reference: "MTG-00000000", status: "pending", duplicate: false });
	const out = await submitRequest(meetingDeps(), body);
	res.status(out.duplicate ? 200 : 201).json(out);
});
