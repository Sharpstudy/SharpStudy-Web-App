// Runtime dependencies for the API routes (everything configurable by environment).
import baseUrl from "@/utils/baseUrl";
import meetingRepo from "./repo";
import { sendMail } from "./mailer";

export const meetingDeps = () => ({
	repo: meetingRepo,
	mailer: sendMail,
	baseUrl: String(process.env.BASE_URL || baseUrl || "http://localhost:3000").replace(/\/$/, ""),
	adminEmail: process.env.MEETING_ADMIN_EMAIL || "",
	defaultMeetingUrl: process.env.MEETING_DEFAULT_URL || "",
	// Secret for the visitors' status-link tokens (HMAC). Falls back to the login secret.
	linkSecret: process.env.MEETING_LINK_SECRET || process.env.JWT_SECRET || "",
	now: () => new Date(),
});
