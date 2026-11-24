// Sends built e-mails through the project's existing nodemailer transport
// (email-templates/config.js; SES SMTP credentials from the environment) and
// offers safe ways to check the configuration. Nothing here returns or logs a
// credential, and nothing is sent unless sendMail / sendTestEmail is called.
import { transport as defaultTransport } from "../../email-templates/config.js";

const SMTP_HOST = "email-smtp.ca-central-1.amazonaws.com"; // fixed in email-templates/config.js (not a secret)
const DEFAULT_FROM = "Sharpstudy Online Courses <hello@sharpstudy.io>";
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ""));

// Remove any configured secret (or fragment of the SMTP login) from text before it is stored or shown.
export function scrub(text, env = process.env) {
	let out = String(text == null ? "" : text);
	for (const v of [env.AWS_SES_USER, env.AWS_SES_PASSWORD]) if (v && String(v).length >= 4) out = out.split(String(v)).join("[hidden]");
	return out.slice(0, 200);
}

const maskEmail = (e) => {
	const [u, d] = String(e).split("@");
	return `${u.slice(0, 1)}***@${d}`;
};

// What is configured, WITHOUT revealing values. `ready` means e-mails can be attempted.
export function emailConfigStatus(env = process.env) {
	const missing = [];
	if (!env.AWS_SES_USER) missing.push("AWS_SES_USER");
	if (!env.AWS_SES_PASSWORD) missing.push("AWS_SES_PASSWORD");
	const adminSet = !!env.MEETING_ADMIN_EMAIL;
	const adminValid = looksLikeEmail(env.MEETING_ADMIN_EMAIL);
	if (!adminSet) missing.push("MEETING_ADMIN_EMAIL");
	const problems = [];
	if (adminSet && !adminValid) problems.push("MEETING_ADMIN_EMAIL is not a valid e-mail address");
	if (env.MEETING_DEFAULT_URL && !/^https?:\/\//.test(env.MEETING_DEFAULT_URL)) problems.push("MEETING_DEFAULT_URL must start with http:// or https://");
	if (env.MEETING_MAIL_FROM && !/<[^>]+@[^>]+>|^[^\s@]+@[^\s@]+$/.test(env.MEETING_MAIL_FROM)) problems.push("MEETING_MAIL_FROM is not a valid sender address");
	return {
		smtpCredentialsSet: !!(env.AWS_SES_USER && env.AWS_SES_PASSWORD),
		smtpHost: SMTP_HOST,
		adminEmailSet: adminSet,
		adminEmailMasked: adminValid ? maskEmail(env.MEETING_ADMIN_EMAIL) : null,
		linkSecretSet: !!(env.MEETING_LINK_SECRET || env.JWT_SECRET),
		defaultMeetingUrlSet: !!env.MEETING_DEFAULT_URL,
		missing,
		problems,
		ready: !!(env.AWS_SES_USER && env.AWS_SES_PASSWORD) && adminValid && problems.length === 0,
	};
}

export async function sendMail({ to, subject, html }, { transport = defaultTransport, env = process.env } = {}) {
	if (!env.AWS_SES_USER || !env.AWS_SES_PASSWORD) return { ok: false, skipped: true, error: "e-mail credentials are not configured" };
	if (!to) return { ok: false, skipped: true, error: "no recipient" };
	try {
		await transport.sendMail({ to, from: env.MEETING_MAIL_FROM || DEFAULT_FROM, subject, html });
		return { ok: true };
	} catch (e) {
		// message only (scrubbed): the error object can contain connection details
		return { ok: false, error: scrub((e && e.message) || "send failed", env) };
	}
}

// Connects and authenticates against the SMTP server but sends NO message.
export async function verifyEmailTransport({ transport = defaultTransport, env = process.env } = {}) {
	if (!env.AWS_SES_USER || !env.AWS_SES_PASSWORD) return { ok: false, skipped: true, error: "e-mail credentials are not configured" };
	try {
		await transport.verify();
		return { ok: true };
	} catch (e) {
		return { ok: false, error: scrub((e && e.message) || "verification failed", env) };
	}
}

// Sends exactly one clearly-labelled test message, ONLY to MEETING_ADMIN_EMAIL (never to an
// address supplied by a caller). Callers must have asked for it explicitly.
export async function sendTestEmail({ transport = defaultTransport, env = process.env } = {}) {
	const status = emailConfigStatus(env);
	if (!status.ready) return { ok: false, skipped: true, error: `not configured: ${[...status.missing, ...status.problems].join(", ")}` };
	return sendMail(
		{
			to: env.MEETING_ADMIN_EMAIL,
			subject: "SharpStudy e-mail test",
			html: "<p>This is a test message from the SharpStudy meeting-request system. If you can read it, e-mail delivery is configured correctly. No action is needed.</p>",
		},
		{ transport, env }
	);
}
