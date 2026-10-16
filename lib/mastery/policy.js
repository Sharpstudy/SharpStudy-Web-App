// Authorization policy for the Mastery Ladder. Pure functions; every API
// handler resolves an actor and calls these before touching data.
//
// Actors:
//   account actor  { kind: "account", userId, role, permissions: Set<string> }
//   learner actor  { kind: "learner", learnerId, accountUserId }

export const PERMISSIONS = {
	ADMIN_ACCESS: "admin.access",
	USERS_MANAGE: "users.manage",
	ROLES_MANAGE: "roles.manage",
	LEARNERS_MANAGE_ALL: "learners.manage_all",
	LEARNERS_CREATE: "learners.create",
	AUDIT_VIEW: "audit.view",
	TUTOR_CONFIGURE: "tutor.configure",
	FEEDBACK_MANAGE: "feedback.manage",
	GLOBAL_RESET: "system.global_reset",
	PRINT_ANY: "curriculum.print_any",
};

export const PERMISSION_DESCRIPTIONS = {
	"admin.access": "Open the admin area and see presence",
	"users.manage": "View users and change their roles",
	"roles.manage": "Create and edit roles and access rights",
	"learners.manage_all": "View and manage every learner (placement, PINs, resets)",
	"learners.create": "Create learner profiles (family accounts; students do not have this by default)",
	"audit.view": "Read the audit log",
	"tutor.configure": "Configure the Sage AI tutor",
	"feedback.manage": "Read and triage feedback",
	"system.global_reset": "Reset ALL learner progress (destructive)",
	"curriculum.print_any": "Print any worksheet and answer key, regardless of learner unlocks",
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// Built-in grants from the existing users.role column. Custom roles
// (ml_roles) add to these; they never remove built-in access.
export const BUILTIN_ROLE_PERMISSIONS = {
	admin: ALL_PERMISSIONS,
	instructor: [PERMISSIONS.PRINT_ANY, PERMISSIONS.LEARNERS_CREATE],
	student: [],
};

export function resolvePermissions(role, customPermissions = []) {
	const set = new Set(BUILTIN_ROLE_PERMISSIONS[role] || []);
	for (const p of customPermissions) if (ALL_PERMISSIONS.includes(p)) set.add(p);
	return set;
}

export const can = (actor, permission) =>
	!!actor && actor.kind === "account" && actor.permissions instanceof Set && actor.permissions.has(permission);

// Access an account actor has to one learner.
//   view  – see dashboard/progress, print unlocked worksheets
//   place – placement overrides, enrolments, daily goal, reminders
//   admin – adult mode, PIN reset, guardians, progress reset, removal
export function learnerAccess(actor, learner, guardianLink) {
	const none = { view: false, place: false, admin: false };
	if (!actor || !learner) return none;
	if (actor.kind === "learner") {
		const self = actor.learnerId === learner.id;
		return { view: self, place: self && !!learner.adult_mode, admin: false, self };
	}
	if (actor.kind !== "account") return none;
	if (learner.owner_user_id === actor.userId) {
		// Owning a profile is not enough to manage it: managing (placement, PIN,
		// adult access, reset, removal) needs family/instructor/admin standing, i.e.
		// the learners.create permission. A plain student account that merely owns
		// a profile (for example one created before this rule) can only view it.
		if (can(actor, PERMISSIONS.LEARNERS_CREATE) || can(actor, PERMISSIONS.LEARNERS_MANAGE_ALL)) {
			return { view: true, place: true, admin: true, owner: true };
		}
		return { view: true, place: false, admin: false, owner: true };
	}
	if (can(actor, PERMISSIONS.LEARNERS_MANAGE_ALL)) return { view: true, place: true, admin: true };
	if (guardianLink && guardianLink.user_id === actor.userId) {
		if (guardianLink.relation === "parent") return { view: true, place: true, admin: true };
		if (guardianLink.relation === "instructor") return { view: true, place: true, admin: false };
	}
	// The account student this profile was explicitly linked to: their own profile, read-only.
	if (learner.student_user_id && learner.student_user_id === actor.userId) return { view: true, place: false, admin: false, self: true };
	return none;
}
