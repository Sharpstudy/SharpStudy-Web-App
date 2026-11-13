import { apiHandler, getAccountActor, repo, body } from "@/lib/mastery-server/http";
import { updateAssignment } from "@/lib/mastery/assignments";
import { notifyAssignmentAfter } from "@/lib/mastery-server/assignmentNotifyHttp";

export default apiHandler({
	// { dueAt?: ISO|null, instructions?: string, cancel?: true } - the creator (or an admin) only.
	PATCH: async (req, res) => {
		const actor = await getAccountActor(req);
		const r = await updateAssignment(repo, actor, req.query.id, body(req));
		const kind = r.changed.includes("cancelled") ? "cancelled" : r.changed.includes("due") ? "due" : null;
		const notified = kind ? await notifyAssignmentAfter(kind, { assignment: r.assignment, learnerIds: r.learnerIds, actor: { userId: actor.userId, name: actor.name } }) : null;
		res.status(200).json({ assignment: { id: r.assignment.id, status: r.assignment.status, dueAt: r.assignment.due_at, instructions: r.assignment.instructions || "" }, changed: r.changed, notified });
	},
});
