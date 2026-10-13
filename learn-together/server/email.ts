// Caregiver invite email. Uses the app's existing nodemailer transport, but only when
// LT_SEND_EMAIL=true so dev/preview never sends real mail. Otherwise the link is returned.
import type { IncomingMessage } from "http";

export async function sendCaregiverInvite(req: IncomingMessage, inviterName: string, email: string, token: string) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  const link = `${proto}://${host}/learn/invite/${encodeURIComponent(token)}`;
  if (process.env.LT_SEND_EMAIL !== "true") return { emailed: false, link };
  const { transport } = await import("@/email-templates/config");
  await transport.sendMail({
    from: process.env.LT_EMAIL_FROM || "Sharp Study <no-reply@sharpstudy.io>",
    to: email,
    subject: `${inviterName} invited you to Learn Together on Sharp Study`,
    text: `${inviterName} invited you to help with Learn Together activities on Sharp Study.\n\nSign in or create an account with this email address, then open:\n${link}\n\nThis link expires in 7 days.`,
  });
  return { emailed: true, link };
}
