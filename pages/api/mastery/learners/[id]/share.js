import isEmail from "validator/lib/isEmail";
import { apiHandler, getAccountActor, repo, body, clientIp, rateLimit } from "@/lib/mastery-server/http";
import { learnerDashboard, writeAudit, ServiceError } from "@/lib/mastery/service";
import { progressSummary, progressSummaryHtml } from "@/lib/mastery/share";
import { transport } from "email-templates/config";

// Emails a progress summary using the project's existing SMTP transport.
// GET returns the summary text (used for the mailto: fallback).
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json(progressSummary(await learnerDashboard(repo, actor, req.query.id)));
	},
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (!rateLimit(req, res, "share", { windowMs: 60 * 60 * 1000, max: 10 }, actor && actor.userId)) return;
		const email = String(body(req).email || "").trim();
		if (!isEmail(email)) throw new ServiceError(422, "invalid", "Enter a valid email address");
		const dash = await learnerDashboard(repo, actor, req.query.id);
		const summary = progressSummary(dash);
		try {
			await transport.sendMail({
				to: email,
				from: "SharpStudy <hello@sharpstudy.io>",
				replyTo: actor.email || undefined,
				subject: summary.subject,
				text: `${summary.text}\n\nShared by ${actor.name || actor.email} via SharpStudy.`,
				html: progressSummaryHtml(summary),
			});
		} catch (e) {
			throw new ServiceError(502, "email_failed", "Email could not be sent right now. Use 'Open in my email app' instead.");
		}
		await writeAudit(repo, actor, "learner.progress_shared", dash.learner.id, { to: email.replace(/^(.).*(@.*)$/, "$1***$2") }, clientIp(req));
		res.status(200).json({ ok: true });
	},
});
