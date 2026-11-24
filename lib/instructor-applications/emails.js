// Instructor-application e-mails. Pure builders returning { to, subject, html };
// nothing is sent here. Every applicant- or admin-supplied value is HTML-escaped,
// and admin-only notes are never part of any applicant e-mail.

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const oneLine = (s, n = 60) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").slice(0, n);

const shell = (title, body) => `<!DOCTYPE html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#2f55d4;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:bold">SharpStudy</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;line-height:1.55">
<h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${body}
<p style="color:#667085;font-size:12px;margin-top:24px">You are receiving this because of an instructor application on SharpStudy.</p>
</div></div></body></html>`;
const button = (href, label) => `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#2f55d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${esc(label)}</a></p>`;
const quote = (t) => (t ? `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #2f55d4;background:#f4f6fb;white-space:pre-wrap">${esc(t)}</blockquote>` : "");

// kind: submitted | resubmitted | under_review | more_info | approved | rejected | revoked
export function applicationEmail(kind, { app, user, baseUrl }) {
	const name = esc(user.first_name || "there");
	const status = `${baseUrl}/become-an-instructor`;
	const feedback = quote(app.applicant_feedback);
	const make = (subject, title, body) => ({ to: user.email, subject, html: shell(title, body) });
	switch (kind) {
		case "submitted":
		case "resubmitted":
			return make("We received your instructor application", "Application received", `<p>Hi ${name}, thanks for applying to teach on SharpStudy.</p><p>Your application is <strong>pending</strong>. We will review your teaching evidence and email you when there is an update. Until it is approved, your account keeps its student access.</p>${button(status, "View application status")}`);
		case "under_review":
			return make("Your instructor application is under review", "Application under review", `<p>Hi ${name}, a member of our team has started reviewing your application.</p>${button(status, "View application status")}`);
		case "more_info":
			return make("More information needed for your instructor application", "More information needed", `<p>Hi ${name}, we need a little more information before we can decide.</p>${feedback}<p>Please update your application and resubmit it.</p>${button(status, "Update application")}`);
		case "approved":
			return make("Your instructor application was approved", "You are approved to teach", `<p>Hi ${name}, congratulations! Your application was reviewed and <strong>approved</strong>.</p>${feedback}<p>Your account now has instructor access. Sign in again if you do not see the instructor menu.</p>${button(`${baseUrl}/instructor/dashboard`, "Open instructor dashboard")}`);
		case "rejected":
			return make("Update on your instructor application", "Application not approved", `<p>Hi ${name}, thank you for your interest in teaching on SharpStudy. After review, we are unable to approve your application at this time.</p>${feedback}<p>You can apply again after the waiting period shown on your status page.</p>${button(status, "View application status")}`);
		case "revoked":
			return make("Your instructor access was removed", "Instructor access removed", `<p>Hi ${name}, your instructor access on SharpStudy has been removed.</p>${feedback}<p>Your student account and purchases are unaffected.</p>${button(status, "View application status")}`);
		default:
			return null;
	}
}

export function adminNewApplicationEmail({ app, user, baseUrl, to }) {
	const who = `${user.first_name || ""} ${user.last_name || ""}`.trim();
	return {
		to,
		subject: `New instructor application from ${oneLine(who)}`,
		html: shell("New instructor application", `<p><strong>${esc(who)}</strong> (${esc(user.email)}) submitted an application. Status: <strong>pending</strong>.</p>${button(`${baseUrl}/admin/instructor/requests/?open=${encodeURIComponent(app.id)}`, "Review application")}`),
	};
}
