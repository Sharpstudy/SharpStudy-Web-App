// Row shape for Admin > Instructors. Pure, so the field mapping is testable without a database.
//
// Where each column really lives:
//   Phone   users.phone; otherwise the phone the person entered on their instructor application
//           (instructor_applications.phone). The approval flow never copies it onto `users`.
//   Subject users.instructor_subject (legacy "become an instructor" form); otherwise instructor_profiles.subjects
//           (written when an application is approved).
//   Text    users.instructor_description (legacy form); otherwise the instructor's own `bio`.
// A blank stays null, and the UI shows "N/A". Nothing is borrowed from another user's record.
import { isAnonymized } from "./anonymized.js";

// Only these columns leave the server for this screen (no reset tokens, social links, etc.).
export const INSTRUCTOR_LIST_ATTRS = ["id", "first_name", "last_name", "email", "role", "status", "created_at", "phone", "bio", "instructor_subject", "instructor_description"];

const clean = (v) => {
	const s = String(v == null ? "" : v).trim();
	return s || null;
};

export const orNA = (v) => clean(v) || "N/A";

export function toInstructorRow(user, profile, application) {
	const own = (k) => clean(user[k]);
	// An anonymized account must not resurface personal details from the retained application records.
	const fallbacks = !isAnonymized(user);
	return {
		id: user.id,
		first_name: user.first_name,
		last_name: user.last_name,
		email: user.email,
		role: user.role,
		status: user.status,
		created_at: user.created_at,
		phone: own("phone") || (fallbacks && application ? clean(application.phone) : null),
		subject: own("instructor_subject") || (fallbacks && profile ? clean(profile.subjects) : null),
		about: own("instructor_description") || own("bio"),
	};
}
