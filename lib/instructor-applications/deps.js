// Runtime dependencies for the API routes (everything configurable by environment).
import baseUrl from "@/utils/baseUrl";
import masteryRepo from "@/lib/mastery-server/repo";
import { sendMail } from "@/lib/meetings/mailer";
import repo from "./repo";

export const applicationDeps = () => ({
	repo,
	mailer: sendMail, // existing SES transport; reports "skipped" when credentials are not configured
	baseUrl: String(process.env.BASE_URL || baseUrl || "http://localhost:3000").replace(/\/$/, ""),
	adminEmail: process.env.INSTRUCTOR_ADMIN_EMAIL || process.env.MEETING_ADMIN_EMAIL || "",
	reapplyDays: Number(process.env.INSTRUCTOR_REAPPLY_DAYS) > 0 ? Number(process.env.INSTRUCTOR_REAPPLY_DAYS) : 30,
	// Reuses the Mastery Ladder audit log so role/permission changes show in one place.
	audit: (action, actorUserId, details) => masteryRepo.addAudit({ actor_user_id: actorUserId, action, details }),
	now: () => new Date(),
});
