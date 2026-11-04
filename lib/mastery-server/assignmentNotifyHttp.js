// Runtime wiring for assignment notifications: the Mastery repo (learners, guardians), the shared
// notifications repo, the project's mailer and the public base URL. Called after the assignment
// is saved; it never throws and never holds the response for long.
import baseUrl from "@/utils/baseUrl";
import { sendMail } from "@/lib/meetings/mailer";
import notifRepo from "@/lib/live-sessions/repo";
import repo from "./repo";
import { notifyAssignment } from "@/lib/mastery/assignmentNotify";

const TIMEOUT_MS = 10000;

export async function notifyAssignmentAfter(kind, info) {
	const work = notifyAssignment(
		{ mastery: repo, notif: notifRepo, mailer: sendMail, baseUrl: String(process.env.BASE_URL || baseUrl || "http://localhost:3000") },
		kind,
		info
	);
	return Promise.race([work, new Promise((r) => setTimeout(() => r({ pending: true }), TIMEOUT_MS))]).catch(() => null);
}
