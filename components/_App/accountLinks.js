// Single source of truth for header navigation.
//
// LINKS defines every destination once. Role lists below only reference LINKS
// keys, and `navModel` removes from the account section anything already shown
// in the primary navigation, so a destination can never appear twice.
//
// The user passed in is the one verified on the server in _app.getInitialProps
// (token -> database). Nothing here reads the role from the URL or the browser.

import { isTelecallerOnly } from "../../lib/auth/telecallerNav.js";

const LINKS = {
	dashboard: { href: "/instructor/dashboard/", label: "Dashboard", icon: "ri-dashboard-3-line" },
	students: { href: "/instructor/students/", label: "Students", icon: "ri-group-line" },
	teachingProfile: { href: "/instructor/profile/", label: "Teaching Profile", icon: "ri-profile-line" },
	application: { href: "/become-an-instructor/", label: "Instructor Application", icon: "ri-file-list-3-line" },
	myCourses: { href: "/instructor/courses/", label: "My Courses", icon: "ri-book-2-line" },
	createCourse: { href: "/instructor/course/create/", label: "Create Course", icon: "ri-add-box-line" },
	admin: { href: "/admin/", label: "Admin Dashboard", icon: "ri-dashboard-line" },
	telecaller: { href: "/telecaller/", label: "Telecaller Dashboard", icon: "ri-customer-service-2-line" },
	mastery: { href: "/study/", label: "Mastery Ladder", icon: "ri-bar-chart-line" },
	family: { href: "/family/", label: "Family", icon: "ri-parent-line" },
	learners: { href: "/family/", label: "Learners", icon: "ri-parent-line" }, // /family/ as an instructor sees it
	learning: { href: "/learning/my-courses/", label: "My Learning", icon: "ri-book-read-line" },
	browse: { href: "/courses/", label: "Browse Courses", icon: "ri-search-line" },
	myBooks: { href: "/learning/my-books/", label: "My Books", icon: "ri-book-2-line" },
	books: { href: "/books/", label: "Browse Books", icon: "ri-book-open-line" },
	purchases: { href: "/learning/my-purchase-history/", label: "Purchases", icon: "ri-bank-card-line" },
	wishlist: { href: "/learning/wishlist/", label: "Wishlist", icon: "ri-heart-3-line" },
	settings: { href: "/profile/basic-information/", label: "Account Settings", icon: "ri-user-settings-line" },
};

// Everything an account can reach, in menu order, per role.
const ACCOUNT_ORDER = {
	student: ["mastery", "family", "learning", "myBooks", "books", "purchases", "wishlist", "settings"],
	instructor: ["dashboard", "myCourses", "createCourse", "students", "teachingProfile", "mastery", "learners", "learning", "myBooks", "books", "purchases", "wishlist", "settings"],
	admin: ["admin", "mastery", "family", "learning", "myBooks", "books", "purchases", "wishlist", "settings"],
};

// Primary navigation of the dashboard header (students and instructors only).
const DASHBOARD_PRIMARY = {
	student: ["learning", "mastery", "family", "browse", "purchases"],
	instructor: ["dashboard", "myCourses", "createCourse", "mastery", "learners", "browse"],
};

// Public marketing navigation.
export const primaryNav = [
	{ href: "/", label: "Home", exact: true },
	{ href: "/courses/", label: "Courses" },
	{ href: "/books/", label: "Books" },
	{ href: "/blog/blogs/", label: "Blog" },
	{ href: "/about-us/", label: "About" },
	{ href: "/contact-us/", label: "Contact" },
];

// Signed-in students and instructors get the dashboard header (and no public
// footer) in these areas instead of the public chrome. Admins keep their own
// layout and are never switched. Logged-out visitors always see public chrome.
//   - dashboard areas: learning, mastery, instructor tools, account settings
//   - shopping areas: catalogue, course details, categories and checkout. They use
//     the dashboard header plus the cart, so a signed-in user can browse and buy
//     without the marketing navigation.
// Public marketing pages (blog, about, contact, faq, legal) keep public chrome.
const DASHBOARD_PREFIXES = ["/study", "/family", "/print", "/learning", "/instructor", "/profile"];
const SHOPPING_PREFIXES = ["/courses", "/course", "/category", "/checkout", "/books"];
export const DASHBOARD_ROLES = ["student", "instructor"];

const inPrefixes = (pathname, list) => list.some((p) => pathname === p || pathname.startsWith(p + "/"));
export const isDashboardArea = (pathname = "") => inPrefixes(pathname, DASHBOARD_PREFIXES) || inPrefixes(pathname, SHOPPING_PREFIXES);
export const isShoppingArea = (pathname = "") => inPrefixes(pathname, SHOPPING_PREFIXES);

export const showDashboardHeader = (user, pathname) => !!user && DASHBOARD_ROLES.includes(user.role) && isDashboardArea(pathname);

export const useDashboardHeader = showDashboardHeader; // component-facing name

// Where each role lands after login (enforced server-side on "/", see lib/auth/landing.js).
export const dashboardHome = (role) => (role === "instructor" ? "/instructor/dashboard/" : role === "student" ? "/learning/my-courses/" : "/");

const norm = (href) => href.replace(/\/$/, "") || "/";
const pick = (keys) => keys.map((k) => LINKS[k]);

// Account menu entries for a role (unknown roles get the student set).
// A student who has started an instructor application also sees its status page (never instructor tools).
export const accountLinks = (role, applicationStatus = null, telecallerAccess = null) => {
	const keys = [...(ACCOUNT_ORDER[role] || ACCOUNT_ORDER.student)];
	// An approved, ACTIVE telecaller (flag computed from the database in /api/users/update) also gets the telecaller dashboard. Display only: the page and every API re-check it.
	if (telecallerAccess === "active" && role !== "admin") keys.splice(keys.indexOf("settings"), 0, "telecaller");
	if ((role === "student" || !ACCOUNT_ORDER[role]) && applicationStatus) keys.splice(keys.indexOf("settings"), 0, "application");
	return pick(keys);
};

// Primary navigation shown in the dashboard header for a role.
export const dashboardNav = (role) => pick(DASHBOARD_PRIMARY[role] || DASHBOARD_PRIMARY.student);

// What the header and drawer should render for this user on this route.
//   primary: main navigation (public links, or the role's dashboard links)
//   account: account menu entries, with anything already in `primary` removed
// An approved, ACTIVE telecaller whose account is an ordinary student account (see lib/auth/telecallerNav.js). Admins and instructors
// keep their own navigation (an instructor who is also a telecaller just gets the extra link above), and a parent-only account keeps
// the parent experience. This only shapes what is DISPLAYED: the page gate and every API re-check access.
export { isTelecallerOnly };

export function navModel(user, pathname) {
	// A telecaller sees the telecaller menu only: no public or student navigation at all (the header is just the logo and this menu).
	if (isTelecallerOnly(user)) return { dash: false, primary: [], account: pick(["telecaller", "settings"]) };
	const dash = showDashboardHeader(user, pathname);
	const primary = dash ? dashboardNav(user.role) : primaryNav;
	const taken = new Set(primary.map((l) => norm(l.href)));
	const account = user ? accountLinks(user.role, user.instructor_application_status, user.telecaller_access).filter((l) => !taken.has(norm(l.href))) : [];
	// Two entries can still point at one URL (e.g. Family / Learners): keep the first.
	const seen = new Set();
	const uniqueAccount = account.filter((l) => (seen.has(norm(l.href)) ? false : seen.add(norm(l.href))));
	return { dash, primary, account: uniqueAccount };
}
