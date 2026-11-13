// Safe e-mail configuration check for the meeting-request system.
//   yarn check:email                 -> reports which settings are present (never prints values); sends nothing
//   yarn check:email -- --verify     -> also connects + authenticates to the SMTP server; sends nothing
//   yarn check:email -- --send-test  -> sends ONE test message to MEETING_ADMIN_EMAIL (explicit opt-in)
import { emailConfigStatus, verifyEmailTransport, sendTestEmail } from "../lib/meetings/mailer.js";

const args = process.argv.slice(2);
const s = emailConfigStatus();
const yes = (b) => (b ? "set" : "MISSING");
console.log("SMTP credentials (AWS_SES_USER / AWS_SES_PASSWORD):", yes(s.smtpCredentialsSet));
console.log("SMTP host:", s.smtpHost);
console.log("MEETING_ADMIN_EMAIL:", s.adminEmailSet ? `set (${s.adminEmailMasked || "invalid address"})` : "MISSING");
console.log("Status-link secret (MEETING_LINK_SECRET or JWT_SECRET):", yes(s.linkSecretSet));
console.log("MEETING_DEFAULT_URL:", s.defaultMeetingUrlSet ? "set" : "not set (optional)");
for (const p of s.problems) console.log("PROBLEM:", p);
console.log("Ready to send:", s.ready ? "yes" : "no" + (s.missing.length ? ` (missing: ${s.missing.join(", ")})` : ""));

let code = s.ready ? 0 : 1;
if (args.includes("--verify")) {
	const r = await verifyEmailTransport();
	console.log("SMTP login check:", r.ok ? "OK (connected and authenticated; nothing was sent)" : `FAILED - ${r.error}`);
	if (!r.ok) code = 1;
}
if (args.includes("--send-test")) {
	const r = await sendTestEmail();
	console.log("Test e-mail:", r.ok ? `accepted by the SMTP server for ${s.adminEmailMasked}. Check that inbox; delivery is only proven once you receive it.` : `NOT sent - ${r.error}`);
	if (!r.ok) code = 1;
}
if (!args.includes("--verify") && !args.includes("--send-test")) console.log("(No connection was made and nothing was sent. Use --verify to test the login, --send-test to send one message.)");
process.exit(code);
