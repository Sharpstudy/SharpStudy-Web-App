// Runtime dependencies for the telecaller dashboard APIs.
import masteryRepo from "@/lib/mastery-server/repo";
import repo from "./repo";

export const followupDeps = () => ({
	repo,
	// Reuses the Mastery Ladder audit log, so ownership changes, calls and status changes show in the same place as the other admin audit.
	audit: (action, actorUserId, details) => masteryRepo.addAudit({ actor_user_id: actorUserId, action, details }),
	now: () => new Date(),
});
