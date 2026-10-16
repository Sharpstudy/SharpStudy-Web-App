import { apiHandler, getAccountActor, repo, rateLimit } from "@/lib/mastery-server/http";
import { studentDirectory } from "@/lib/mastery/directory";
import { requireRole } from "@/lib/auth/requireRole";

// The instructor's student directory: one row per person, only people in the caller's own scope
// (paid students of the caller's own courses, plus learner profiles the caller owns or is linked to).
// `courseId` is only accepted for a course the caller owns.
export default apiHandler({
	GET: async (req, res) => {
		// 401 without a valid login, 403 unless the DATABASE role is instructor or admin (never the client).
		if (!(await requireRole(req, res, ["instructor", "admin"]))) return;
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "inst-students", { windowMs: 60000, max: 120 }, actor.userId)) return;
		const { q, courseId, grade, subject, status, state, page, all } = req.query;
		res.status(200).json(await studentDirectory(repo, actor, { q, courseId, grade, subject, status, state, page, all }));
	},
});
