// Server-side page gate used by pages/_app.js (getInitialProps runs on the server for
// the first request of every page). `user` is the database row fetched with the verified
// token, so the role here is never taken from the browser. APIs enforce the same rules
// independently; this keeps the instructor / admin SCREENS from rendering at all for
// people who do not hold the role.
//
// Returns the path to send the visitor to, or null when the page may render.

import { PARENT_HOME, parentMayOpen } from "../family/parentMode.js";
import { TELECALLER_HOME, isTelecallerOnly, isStudentLearningPath } from "./telecallerNav.js";
import { APPLICATION_PAGE, isTelecallerApplicant, isTelecallerRestricted } from "./telecallerState.js";

const under = (pathname, base) => pathname === base || pathname.startsWith(base + "/");

// The account-bound student experience: learning area, Mastery Ladder, Family, printables and checkout. (The public course / book
// catalogue is marketing content anyone can open, so it is not part of this.)
const STUDENT_AREAS = ["/learning", "/study", "/family", "/print", "/checkout"];
export const isStudentArea = (pathname) => STUDENT_AREAS.some((b) => under(String(pathname || ""), b)) || /^\/books\/[^/]+\/checkout(\/|$)/.test(String(pathname || "")); // a book purchase page is a checkout too

export function pageAccess(pathname, user) {
	const p = String(pathname || "");
	// A parent-only account (see lib/family/parentMode.js) sees Progress and Family only. `is_parent` is computed on the
	// server from the database in /api/users/update, never taken from the browser.
	if (user && user.is_parent) return parentMayOpen(p) ? null : PARENT_HOME;
	// An approved, ACTIVE telecaller has no student learning area: /learning/* goes to their dashboard. /telecaller itself is allowed
	// for them (below), so this can never bounce back and forth.
	if (isTelecallerOnly(user) && isStudentLearningPath(p)) return TELECALLER_HOME;
	// A telecaller applicant whose application is pending / awaiting more information, or a deactivated telecaller, is NOT an ordinary
	// student even though users.role is "student": the student areas stay closed and they are sent to the application / access status
	// page. (Draft and rejected applicants keep their normal student access; they are only steered there at sign-in.) The state is
	// computed from the database in /api/users/update, never from the browser.
	if (isTelecallerRestricted(user) && isStudentArea(p)) return APPLICATION_PAGE;
	if (under(p, "/admin")) return user && user.role === "admin" ? null : "/";
	// The telecaller dashboard: an admin, or an account the server found to hold an ACTIVE approved telecaller profile
	// (`telecaller_access`, computed from the database in /api/users/update). The telecaller APIs re-check this independently.
	if (under(p, "/telecaller")) {
		if (user && (user.role === "admin" || user.telecaller_access === "active")) return null;
		// An applicant (or a deactivated telecaller) who types /telecaller/ is shown their status, not bounced through the student home.
		return isTelecallerApplicant(user) ? APPLICATION_PAGE : "/";
	}
	if (under(p, "/instructor")) {
		if (user && (user.role === "instructor" || user.role === "admin")) return null;
		// students are pointed at the application, everyone else home
		return user && user.role === "student" ? "/become-an-instructor" : "/";
	}
	return null;
}

export const isGatedPath = (pathname) => under(String(pathname || ""), "/admin") || under(String(pathname || ""), "/instructor") || under(String(pathname || ""), "/telecaller");
