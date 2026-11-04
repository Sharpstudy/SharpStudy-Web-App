// Pure helpers (no imports, no database) for how an approved, ACTIVE telecaller is treated by the site chrome and the page gate.
//
// `telecaller_access === "active"` is computed on the server in /api/users/update from the telecaller_profiles row (status "active"
// AND approved_at set, and not a child's learner login). It is never derived from the e-mail, the name or users.role, and there is no
// `telecaller` role. These helpers only decide what is DISPLAYED or where a page request is sent: every telecaller API and the
// telecaller dashboard re-check access from the database on each request.

export const TELECALLER_HOME = "/telecaller/";

// An approved, active telecaller whose account is an ordinary student account. Instructors and admins keep their own experience,
// and a parent-only account keeps the parent Progress / Family experience.
export const isTelecallerOnly = (user) => !!user && user.role === "student" && user.telecaller_access === "active" && !user.is_parent;

// The student learning area (My courses, My books, Live sessions, Wishlist, Purchases, course player, certificates).
export const isStudentLearningPath = (pathname) => {
	const p = String(pathname || "");
	return p === "/learning" || p.startsWith("/learning/");
};
