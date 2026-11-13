import { handle } from "@/lib/meetings/http";
import { requireRole } from "@/lib/auth/requireRole";
import { rateLimit } from "@/lib/mastery-server/http";
import { emailConfigStatus, verifyEmailTransport, sendTestEmail } from "@/lib/meetings/mailer";

// Admin only. GET: which e-mail settings are present (never their values). POST:
//   { action: "verify" }                    -> connect + authenticate to the SMTP server, sends nothing
//   { action: "send_test", confirm: true }  -> send ONE test message to MEETING_ADMIN_EMAIL (never to a caller-supplied address)
export default handle(async (req, res) => {
	if (!["GET", "POST"].includes(req.method)) {
		res.setHeader("Allow", "GET, POST");
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	const actor = await requireRole(req, res, ["admin"]);
	if (!actor) return;
	if (req.method === "GET") return res.status(200).json({ config: emailConfigStatus() });

	if (!rateLimit(req, res, "meeting-email-check", { windowMs: 60 * 60 * 1000, max: 10 }, actor.userId)) return;
	const b = req.body && typeof req.body === "object" ? req.body : {};
	const config = emailConfigStatus();
	if (b.action === "verify") {
		const r = await verifyEmailTransport();
		return res.status(r.ok ? 200 : r.skipped ? 409 : 502).json({ ok: r.ok, message: r.ok ? "Connected and authenticated. Nothing was sent." : r.error, config });
	}
	if (b.action === "send_test") {
		if (b.confirm !== true) return res.status(422).json({ message: "Confirm that you want to send a test e-mail." });
		const r = await sendTestEmail();
		return res.status(r.ok ? 200 : r.skipped ? 409 : 502).json({
			ok: r.ok,
			message: r.ok ? `The server accepted a test message for ${config.adminEmailMasked}. Delivery is only proven once it arrives in that inbox.` : r.error,
			config,
		});
	}
	return res.status(422).json({ message: "Unknown action" });
});
