import { apiHandler, getAccountActor, repo, body, rateLimit } from "@/lib/mastery-server/http";
import { createAssignment } from "@/lib/mastery/assignments";
import { notifyAssignmentAfter } from "@/lib/mastery-server/assignmentNotifyHttp";

export default apiHandler({
	// { preview: true, ... } validates and returns the review; without it the assignment is published.
	POST: async (req, res) => {
		const actor = await getAccountActor(req);
		if (actor && !rateLimit(req, res, "ml-assign", { windowMs: 60000, max: 30 }, actor.userId)) return;
		const b = body(req);
		const result = await createAssignment(repo, actor, b);
		if (result.preview) return res.status(200).json(result);
		// Saved first. Telling the family can fail without affecting the assignment (and a retry is deduplicated).
		const notified = result.duplicate ? null : await notifyAssignmentAfter("assigned", { assignment: { id: result.assignmentId, title: result.title, due_at: result.dueAt, instructions: result.instructions }, learnerIds: result.students.map((s) => s.id), actor: { userId: actor.userId, name: actor.name } });
		res.status(result.duplicate ? 200 : 201).json({ ...result, notified });
	},
});
