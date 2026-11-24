// Telecaller-application e-mails. Pure builders returning { to, subject, html }; nothing is sent here.
// Every applicant- or admin-supplied value is HTML-escaped, and private admin notes are never part of any e-mail.

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const oneLine = (s, n = 60) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").slice(0, n);

const shell = (title, body) => `<!DOCTYPE html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#2f55d4;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:bold">SharpStudy</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;line-height:1.55">
<h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${body}
<p style="color:#667085;font-size:12px;margin-top:24px">You are receiving this because of a telecaller application on SharpStudy.</p>
</div></div></body></html>`;
const button = (href, label) => `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#2f55d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${esc(label)}</a></p>`;
const quote = (t) => (t ? `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #2f55d4;background:#f4f6fb;white-space:pre-wrap">${esc(t)}</blockquote>` : "");

export const STATUS_PATH = "/become-a-telecaller";

// kind: submitted | resubmitted | more_info | approved | rejected | deactivated | reactivated
export function applicantEmail(kind, { app, user, baseUrl, message }) {
	const name = esc(user.first_name || "there");
	const status = `${baseUrl}${STATUS_PATH}`;
	const note = quote(message != null ? message : app && app.feedback);
	const make = (subject, title, body) => ({ to: user.email, subject, html: shell(title, body) });
	switch (kind) {
		case "submitted":
		case "resubmitted":
			return make("We received your telecaller application", "Application received", `<p>Hi ${name}, thanks for applying to join SharpStudy as a telecaller.</p><p>Your application is <strong>pending</strong>. We will email you when there is an update. Applying does not give any access until an administrator approves it.</p>${button(status, "View application status")}`);
		case "more_info":
			return make("More information needed for your telecaller application", "More information needed", `<p>Hi ${name}, we need a little more information before we can decide.</p>${note}<p>Please update your application and resubmit it.</p>${button(status, "Update application")}`);
		case "approved":
			return make("Your telecaller application was approved", "You are approved", `<p>Hi ${name}, congratulations! Your telecaller application was reviewed and <strong>approved</strong>.</p>${note}<p>Your telecaller access is being set up. We will let you know when the telecaller dashboard is available.</p>${button(status, "View application status")}`);
		case "rejected":
			return make("Update on your telecaller application", "Application not approved", `<p>Hi ${name}, thank you for your interest in joining SharpStudy as a telecaller. After review, we are unable to approve your application at this time.</p>${note}<p>You can apply again after the waiting period shown on your status page.</p>${button(status, "View application status")}`);
		case "deactivated":
			return make("Your telecaller access was deactivated", "Telecaller access deactivated", `<p>Hi ${name}, your telecaller access on SharpStudy has been deactivated.</p>${note}<p>Your account and any other access are unaffected.</p>`);
		case "reactivated":
			return make("Your telecaller access was reactivated", "Telecaller access reactivated", `<p>Hi ${name}, your telecaller access on SharpStudy has been reactivated.</p>${note}`);
		default:
			return null;
	}
}

export function adminNewApplicationEmail({ app, user, baseUrl, to }) {
	const who = `${user.first_name || ""} ${user.last_name || ""}`.trim();
	return {
		to,
		subject: `New telecaller application from ${oneLine(who)}`,
		html: shell("New telecaller application", `<p><strong>${esc(who)}</strong> (${esc(user.email)}) submitted an application. Status: <strong>pending</strong>.</p>${button(`${baseUrl}/admin/telecallers/applications/?open=${encodeURIComponent(app.id)}`, "Review application")}`),
	};
}
