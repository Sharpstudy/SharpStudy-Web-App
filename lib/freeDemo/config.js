// Free Demo Class: shared rules for the CTA buttons, the popup and the enquiry text. Plain ES module (no framework imports) so it is unit tested.
//
// How an enquiry is stored: a demo request is a meeting request of kind "free_demo" (POST /api/meetings/request), kept in the existing
// meeting_requests table. Parent name, phone, child name, grade, program, class type, source and page are real columns (migration
// 20261123...-meeting-requests-free-demo). The source/page are informational only; nothing trusts them for access or security decisions,
// and the server validates, de-duplicates and rate-limits every request again.
import { PROGRAMS } from "../programs/catalog.js";

export const DEMO_PURPOSE = "product_demo";
export const MESSAGE_MAX = 2000; // matches the server limit (lib/meetings/service.js LIMITS.messageMax)

// ---------------------------------------------------------------- automatic popup timing
// Rules: the first automatic popup appears 5 s after the visitor opens an eligible page. If it is closed without a request being sent, the next
// one appears 10 s after it was closed, and so on, up to 3 automatic displays per visit (= per browser tab session). A sent request stops all
// further automatic popups (for a week on this browser). A "Book Free Demo" button always opens the popup immediately and never touches this
// schedule or the count.
//
// The schedule lives in sessionStorage as "show the next one at <timestamp>" plus "<n> shown so far", NOT in a running timer. A timer is only a
// wake-up call derived from it, so navigating between pages, reloading, or a hidden tab can never restart the first 5 s or reset the count.
export const AUTO_POPUP = {
	firstDelayMs: 5000,
	repeatDelayMs: 10000,
	maxPerVisit: 3,
	firstMinMs: 300, // the first popup is never closer than this to the moment the schedule is created (the dialog needs a moment to be ready)
	resumeMinMs: 1000, // if the due time passed while the visitor was on an excluded page, show it this long after they come back
	submitCooldownMs: 7 * 24 * 60 * 60 * 1000, // after a request was sent: no automatic popup for a week
	submittedKey: "ss_free_demo_dismissed", // session flag set when a request was sent (name kept from the first version)
	untilKey: "ss_free_demo_until",
	shownKey: "ss_free_demo_shown",
	nextKey: "ss_free_demo_next",
};

const safe = (fn, fallback = null) => {
	try {
		return fn();
	} catch (e) {
		return fallback;
	}
};
const num = (v) => {
	const n = Number(v);
	return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};

// A request was sent: no more automatic popups. `session` and `local` are Storage-like ({ getItem, setItem }); either may throw or be missing.
export const isSuppressed = ({ session, local }, now = Date.now()) => {
	if (session && safe(() => session.getItem(AUTO_POPUP.submittedKey)) === "1") return true;
	const until = num(local && safe(() => local.getItem(AUTO_POPUP.untilKey)));
	return until !== null && until > now;
};
export const markSubmitted = ({ session, local }, now = Date.now()) => {
	if (session) safe(() => session.setItem(AUTO_POPUP.submittedKey, "1"));
	if (local) safe(() => local.setItem(AUTO_POPUP.untilKey, String(now + AUTO_POPUP.submitCooldownMs)));
};

export const shownCount = (session) => Math.max(0, Math.floor(num(session && safe(() => session.getItem(AUTO_POPUP.shownKey))) || 0));
const setNext = (session, at) => session && safe(() => session.setItem(AUTO_POPUP.nextKey, String(at)));

// What should the timer do right now? -> { stop: true } (never again this visit) or { stop: false, delay } (wake up in `delay` ms).
// The very first call of a visit starts the 5 s countdown and stores it, so later calls (another page, a reload) resume it instead of restarting.
// `sinceLoadMs` = how long the page has already been open (performance.now()). Only the very first plan of a visit uses it, so the 5 s are
// counted from when the page opened, not from when the script finished hydrating. A stored schedule is never changed by it.
export const autoPlan = ({ session, local }, now = Date.now(), sinceLoadMs = 0) => {
	if (isSuppressed({ session, local }, now)) return { stop: true, reason: "request sent" };
	if (shownCount(session) >= AUTO_POPUP.maxPerVisit) return { stop: true, reason: "limit reached" };
	const next = num(session && safe(() => session.getItem(AUTO_POPUP.nextKey)));
	if (next === null) {
		const elapsed = Math.min(Math.max(0, num(sinceLoadMs) || 0), AUTO_POPUP.firstDelayMs);
		const delay = Math.max(AUTO_POPUP.firstMinMs, AUTO_POPUP.firstDelayMs - elapsed);
		setNext(session, now + delay);
		return { stop: false, delay };
	}
	return { stop: false, delay: next > now ? next - now : AUTO_POPUP.resumeMinMs };
};
// An automatic popup was opened: count it (the next one is provisionally 10 s later; closing it sets the real time).
export const recordShown = (session, now = Date.now()) => {
	if (!session) return;
	safe(() => session.setItem(AUTO_POPUP.shownKey, String(shownCount(session) + 1)));
	setNext(session, now + AUTO_POPUP.repeatDelayMs);
};
// An automatic popup was closed without a request being sent: the next one is 10 s from now.
export const recordClosed = (session, now = Date.now()) => setNext(session, now + AUTO_POPUP.repeatDelayMs);
// The moment was not right (a dialog or menu is already open): try again after `ms`, without counting a display.
export const postponeNext = (session, ms, now = Date.now()) => setNext(session, now + ms);

// ---------------------------------------------------------------- where the CTA / popup appear
const norm = (p) => (String(p || "/").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/");
const under = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

// Public marketing pages. The automatic popup only ever appears on these.
const MARKETING = ["/about-us", "/programs", "/gallery", "/blog", "/success-stories", "/contact-us", "/faq"];
// The header button also appears in the course catalogue and course pages (a visitor browsing courses may want a demo first), but never on
// login/registration, checkout, the meeting form itself, career/application journeys, or any dashboard (they are simply not listed).
const HEADER_EXTRA = ["/courses", "/course", "/category", "/terms-conditions", "/privacy-policy"];

export const isMarketingPage = (pathname) => {
	const p = norm(pathname);
	return p === "/" || MARKETING.some((m) => under(p, m));
};
export const showHeaderDemo = (pathname, user) => !user && (isMarketingPage(pathname) || HEADER_EXTRA.some((m) => under(norm(pathname), m)));
export const autoPopupEligible = (pathname, user) => !user && isMarketingPage(pathname);

// ---------------------------------------------------------------- sources
const programSource = (slug) => `program_${slug.replace(/-/g, "_")}`;
export const SOURCES = [
	"homepage_header",
	"header",
	"homepage_hero",
	"homepage_footer",
	...PROGRAMS.map((p) => programSource(p.slug)),
	"programs_overview_cta",
	"gallery_cta",
	"about_cta",
	"contact_cta",
	"blog_cta",
	"success_stories_cta",
	"course_detail_cta",
	"automatic_popup",
];
const KNOWN = new Set(SOURCES);
// Anything that is not one of the known source names is recorded as "other".
export const sourceId = (s) => (KNOWN.has(s) ? s : "other");
export const sourceForProgram = (slug) => programSource(slug);
export const headerSource = (pathname) => (norm(pathname) === "/" ? "homepage_header" : "header");

// ---------------------------------------------------------------- programs
export const PROGRAM_OPTIONS = PROGRAMS.map((p) => ({ value: p.slug, label: p.title }));
export const programTitle = (slug) => (PROGRAMS.find((p) => p.slug === slug) || {}).title || "Not sure yet";
export const validProgram = (slug) => (PROGRAMS.some((p) => p.slug === slug) ? slug : "");

// ---------------------------------------------------------------- the form
export const safePage = (page) => (/^\/[A-Za-z0-9\-_/]{0,120}$/.test(String(page || "")) ? String(page) : "/");
export const GRADES = ["Kindergarten", ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`), "College / adult"];
export const CLASS_MODES = [
	{ value: "online", label: "Online" },
	{ value: "offline", label: "Offline (in person)" },
];

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayLocal = () => ymd(new Date());
export const maxDateLocal = () => ymd(new Date(Date.now() + 179 * 86400000)); // the server accepts requests up to 180 days ahead

// Client-side checks that mirror the server's rules (the server stays the authority). Required: parent name, phone, child name, grade,
// program. Optional: email, class type, date + time (both or neither), message.
export function validateDemoForm(v, today = todayLocal()) {
	const e = {};
	if (String(v.name || "").trim().length < 2) e.name = "Please enter the parent or guardian's name.";
	const phone = String(v.phone || "").trim();
	if (!/^[0-9+()\-.\s]{7,40}$/.test(phone) || phone.replace(/\D/g, "").length < 7) e.phone = "Please enter a valid phone number.";
	if (String(v.childName || "").trim().length < 2) e.childName = "Please enter your child's name.";
	if (!String(v.childGrade || "").trim()) e.childGrade = "Please choose your child's grade.";
	if (!validProgram(v.program)) e.program = "Please choose a program.";
	const email = String(v.email || "").trim();
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) e.email = "Please enter a valid email address, or leave it empty.";
	if (v.date || v.time) {
		if (!v.date) e.date = "Please choose a date, or clear the time as well.";
		else if (v.date < today) e.date = "That date is in the past.";
		if (!v.time) e.time = "Please choose a time, or clear the date as well.";
		if (!v.timeZone) e.timeZone = "Please choose a time zone.";
	}
	return e;
}
