// Test fixture: the production flow, driven the way a child drives it. The learner's own account (student_user_id,
// set by an instructor in real life) asks for the code. Nothing else can create a code.
import { issueLinkCodeForChild } from "../../lib/family/links.js";

export async function parentCode(repo, learnerId, ctx) {
	const learner = await repo.getLearner(learnerId);
	let uid = learner.student_user_id;
	if (!uid) {
		uid = `child-of-${learnerId}`;
		await repo.updateLearner(learnerId, { student_user_id: uid });
	}
	return issueLinkCodeForChild(repo, { kind: "account", userId: uid, role: "student", permissions: new Set() }, ctx);
}
