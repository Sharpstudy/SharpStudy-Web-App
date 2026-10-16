// Runtime wiring for notifications (real mailer + public base URL). The API routes call
// this AFTER the session change is saved; it never throws and never waits long.
import baseUrl from "@/utils/baseUrl";
import { sendMail } from "@/lib/meetings/mailer";
import sessionRepo from "./repo";
import { notifySession } from "./notify";

const TIMEOUT_MS = 10000;

export async function notifyAfter(kind, view, actor) {
	const recipients = (view && view.participants ? view.participants : []).filter((p) => p.userId);
	if (!recipients.length) return null;
	const work = notifySession(sessionRepo, kind, view, recipients, {
		instructorName: actor && actor.name ? actor.name : "",
		baseUrl: String(process.env.BASE_URL || baseUrl || "http://localhost:3000"),
		mailer: sendMail,
	});
	// A slow mail server must not hold up the response; the work still finishes in the background.
	return Promise.race([work, new Promise((r) => setTimeout(() => r({ pending: true }), TIMEOUT_MS))]).catch(() => null);
}
