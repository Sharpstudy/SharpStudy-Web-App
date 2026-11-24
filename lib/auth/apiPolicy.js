// Pure: which API areas are the STUDENT experience, and which telecaller states may not use them. Enforced in getAccountActor
// (lib/mastery-server/http.js), the single place every authenticated API resolves its caller, using the account state read from the
// database on that request (never the JWT role).
//
// Rule: an account whose role is "student" and whose telecaller state is pending, more_info, inactive or active is NOT an ordinary student.
// For the areas below the caller is treated as signed out (401 on required routes; routes that accept an optional actor behave as
// anonymous), exactly like the page gate. Everything else (the application API, notifications, profile, meetings, the telecaller APIs,
// public catalogue endpoints) is untouched. Admins and instructors are never affected (the rule is for role "student" only).
import { RESTRICTED_STATES } from "./telecallerState.js";

// Student-content API prefixes (matched on a path boundary).
export const STUDENT_CONTENT_API = [
	"/api/learnings", // my courses, progress, lessons, purchase history
	"/api/mastery", // Mastery Ladder: learners, worksheets, study, progress, print
	"/api/family", // family, children, devices, link codes
	"/api/quizzes/student",
	"/api/wishlist",
	"/api/favourites",
	"/api/checkout", // course checkout / purchase
	"/api/subscriptions",
	"/api/coupons/get-coupon",
	"/api/live-sessions", // live classes (Jitsi): joining as a student
	"/api/live-questions",
	"/api/assets", // enrolled-course assets
	"/api/courses/course", // course content for enrolled students
	"/api/books", // library, reader, progress, orders, checkout (public catalogue routes ignore the actor)
];

// Every top-level folder of pages/api must be decided here. tests/auth/api-gate.test.mjs fails when a new folder appears, so a new API
// area is never silently left out of this decision.
export const API_AREAS = {
	// student-content (see STUDENT_CONTENT_API; some folders are only partly student-content)
	learnings: "student", mastery: "student", family: "student", wishlist: "student", favourites: "student", checkout: "student", subscriptions: "student",
	"live-sessions": "student", "live-questions": "student", assets: "student", books: "student",
	quizzes: "mixed", coupons: "mixed", courses: "mixed",
	// not student content
	admin: "other", instructor: "other", telecaller: "other", telecallers: "other", users: "other", notifications: "other", meetings: "other", contact: "other",
	categories: "other", partners: "other", testimonials: "other", questions: "other", "answer-options": "other", students: "other", "site-settings": "other",
	funfacts: "other", "home-courses": "other", "all-courses": "other", swagger: "other",
};

const pathOf = (url) => String(url || "").split("?")[0].replace(/\/+$/, "");
const under = (p, base) => p === base || p.startsWith(base + "/");

export const isStudentContentApi = (url) => {
	const p = pathOf(url);
	return STUDENT_CONTENT_API.some((b) => under(p, b));
};

// States that are NOT an ordinary student for the student-content APIs.
export const isStudentApiBlocked = ({ role, telecallerState, url }) => role === "student" && RESTRICTED_STATES.concat("active").includes(telecallerState) && isStudentContentApi(url);
