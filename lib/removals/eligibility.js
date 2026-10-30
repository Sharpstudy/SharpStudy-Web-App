// Whether a row of the instructor's student directory can offer "Request Removal" (pure; the server re-checks everything
// when a request is created). Only a learner profile the instructor is LINKED to qualifies. The other ways an instructor
// reaches a student are never removable here: a profile they own (removing the owner would orphan it) and a paid-course
// student (the link is the payment-backed enrolment, which this workflow never modifies).
export function removalEligibility(row) {
	if (row && row.learnerId && row.relation === "instructor") return { allowed: true };
	if (row && row.relation === "owner") return { allowed: false, reason: "You own this profile, so it can't be removed from your account." };
	if (row && row.relation === "self") return { allowed: false, reason: "This is the student's own profile." };
	return { allowed: false, reason: "This student is linked through a paid course enrolment, which can't be removed here." };
}
