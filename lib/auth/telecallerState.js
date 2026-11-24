// Pure (no imports, no database): the ONE place that turns "what the database says about this account's telecaller application
// and profile" into an account state. Everything that decides where a person goes (landing, page gate, navigation) reads this
// state instead of looking at users.role alone, because telecaller applicants and active telecallers all have role "student".
//
// States
//   none      no telecaller involvement (an ordinary student; also admins, instructors who never applied, child learner logins)
//   draft     started the application, not submitted
//   pending   submitted, waiting for an administrator
//   more_info an administrator asked for more information (the applicant must respond)
//   rejected  not approved (may reapply after the waiting period)
//   active    approved AND an active telecaller profile with approved_at set
//   inactive  has (or had) a telecaller profile that is deactivated; or approved with no usable profile (fails closed)
export const TELECALLER_STATES = ["none", "draft", "pending", "more_info", "rejected", "active", "inactive"];

// States whose student experience is suspended: the person only sees their application / access status.
export const RESTRICTED_STATES = ["pending", "more_info", "inactive"];
// States that land on the application / status page after sign-in (everything except none and active).
export const APPLICANT_STATES = ["draft", "pending", "more_info", "rejected", "inactive"];

export const APPLICATION_PAGE = "/become-a-telecaller/";

export function telecallerState({ role, isLearner = false, applicationStatus = null, profileStatus = null, approvedAt = null } = {}) {
	if (role === "admin" || isLearner) return "none";
	if (profileStatus) {
		return profileStatus === "active" && approvedAt ? "active" : "inactive";
	}
	switch (applicationStatus) {
		case "draft":
			return "draft";
		case "pending":
			return "pending";
		case "more_info_requested":
			return "more_info";
		case "rejected":
			return "rejected";
		case "approved":
			return "inactive"; // approved but no profile row: never treat as an ordinary student, never grant access
		default:
			return "none";
	}
}

// Server-computed state on a user object (set by /api/users/update). Unknown / missing values mean "none".
export const stateOf = (user) => (user && TELECALLER_STATES.includes(user.telecaller_state) ? user.telecaller_state : "none");

// Only student accounts are held in the applicant experience; instructors and admins keep their own.
export const isTelecallerApplicant = (user) => !!user && user.role === "student" && !user.is_parent && APPLICANT_STATES.includes(stateOf(user));
export const isTelecallerRestricted = (user) => !!user && user.role === "student" && !user.is_parent && RESTRICTED_STATES.includes(stateOf(user));

// Where sign-in / the home page sends someone with this state ("" = no telecaller-specific destination).
export const destinationFor = (state, telecallerHome = "/telecaller/") => (state === "active" ? telecallerHome : APPLICANT_STATES.includes(state) ? APPLICATION_PAGE : "");
