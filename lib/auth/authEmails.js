// Plain, self-contained e-mails for the password flows. Pure (returns { to, subject, html }); sent through lib/meetings/mailer.js, the
// project's existing SES transport. Never contains a password. The reset link is the only secret in any of them.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const shell = (inner) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#f1f1f1;font-family:Lato,Arial,sans-serif;font-size:15px;line-height:1.7;color:#333">
<div style="max-width:560px;margin:0 auto;background:#fff;padding:32px;border-radius:8px">${inner}
<p style="margin-top:28px">Regards,<br>SharpStudy Support Team<br><a href="https://sharpstudy.io/" style="color:#3056de">www.sharpstudy.io</a></p></div></body></html>`;

const first = (u) => esc((u && u.first_name) || "there");

export function resetEmail({ user, link, minutes = 60 }) {
	return {
		to: user.email,
		subject: "Reset your SharpStudy password",
		html: shell(`<h2 style="margin-top:0">Reset your password</h2>
<p>Hi ${first(user)},</p>
<p>We received a request to reset the password for your SharpStudy account. This link works once and expires in ${esc(minutes)} minutes.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#3056de;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Choose a new password</a></p>
<p>If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p>If you did not ask for this, you can ignore this email: your password stays the same.</p>`),
	};
}

export function passwordChangedEmail({ user, baseUrl }) {
	return {
		to: user.email,
		subject: "Your SharpStudy password was changed",
		html: shell(`<h2 style="margin-top:0">Your password was changed</h2>
<p>Hi ${first(user)},</p>
<p>The password for your SharpStudy account was just changed, and you were signed out of your other sessions.</p>
<p>If this was you, there is nothing more to do. If it was not, <a href="${esc(baseUrl)}/forgot-password" style="color:#3056de">reset your password</a> right away and contact support.</p>`),
	};
}
