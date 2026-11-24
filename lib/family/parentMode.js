// "Parent mode": the restricted experience for accounts that are only parents.
//
// There is no parent role. A parent account is an ordinary `student`-role user (the Family sign-up creates one), and
// what makes it a parent is a link: an ml_learner_guardians row with relation "parent". So the restriction is derived
// from the database on every request, never from the browser, and it is deliberately narrow. An account is treated as
// parent-only when ALL of these hold:
//   - role is "student" (instructors and administrators are never restricted);
//   - it is an active parent of at least one learner;
//   - it is not itself a learner's linked student account (a child using the Study page);
//   - it has no paid course enrolment and no paid book order (an ordinary customer who also happens to be a parent
//     keeps the normal student experience, plus the Family page).
// An account that registered as a parent but has not linked a child yet cannot be told apart from any other new
// student, so it is not restricted until the first link (see docs/family/01-implementation.md).

export const PARENT_HOME = "/family/";

export function isParentOnly(facts) {
	const f = facts || {};
	return f.role === "student" && f.active !== false && f.parentLinks > 0 && f.studentLinks === 0 && f.paidCourses === 0 && f.paidBooks === 0;
}

const under = (pathname, base) => pathname === base || pathname.startsWith(base + "/");

// The only screens a parent-only account may open: Progress and Family (and their set-up pages), the legal pages and the
// framework's own error pages. Everything else (home, explore, courses, books, learning, study, profile, print...) is
// sent to Progress by the page gate.
// "/become-a-telecaller" is also open: a parent may apply (the application grants nothing until an admin approves it).
const PARENT_PAGES = ["/family", "/become-a-telecaller", "/terms-conditions", "/privacy-policy", "/_error", "/404", "/500"];
export const parentMayOpen = (pathname) => PARENT_PAGES.some((base) => under(String(pathname || ""), base));
