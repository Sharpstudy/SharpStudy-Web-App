import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
	AUTO_POPUP, GRADES, SOURCES, autoPlan, autoPopupEligible, headerSource, isSuppressed, markSubmitted, postponeNext, recordClosed, recordShown, shownCount, safePage, showHeaderDemo, sourceForProgram, sourceId, validateDemoForm,
} from "../../lib/freeDemo/config.js";
import { validateSubmission } from "../../lib/meetings/service.js";

const mem = () => {
	const m = new Map();
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("automatic popup timing constants: first after 5 s, then 10 s after each close, at most 3 per visit", () => {
	assert.deepEqual([AUTO_POPUP.firstDelayMs, AUTO_POPUP.repeatDelayMs, AUTO_POPUP.maxPerVisit], [5000, 10000, 3]);
});

test("the schedule over a visit: 5 s, then 10 s after each close, exactly 3 automatic popups, never a fourth", () => {
	const s = { session: mem(), local: mem() };
	const T = 1_000_000;
	assert.deepEqual(autoPlan(s, T), { stop: false, delay: 5000 }, "first popup 5 s after the page opens");
	// popup 1 appears at +5 s and is closed at +8 s
	recordShown(s.session, T + 5000);
	assert.equal(shownCount(s.session), 1);
	recordClosed(s.session, T + 8000);
	assert.deepEqual(autoPlan(s, T + 8000), { stop: false, delay: 10000 }, "next one 10 s after the close");
	// popup 2 at +18 s, closed at +20 s
	recordShown(s.session, T + 18000);
	recordClosed(s.session, T + 20000);
	assert.deepEqual(autoPlan(s, T + 20000), { stop: false, delay: 10000 }, "third one 10 s after the second close");
	// popup 3 at +30 s, closed at +31 s: the limit is reached
	recordShown(s.session, T + 30000);
	assert.equal(shownCount(s.session), 3);
	recordClosed(s.session, T + 31000);
	assert.deepEqual(autoPlan(s, T + 31000), { stop: true, reason: "limit reached" }, "no fourth automatic popup in this visit");
	assert.deepEqual(autoPlan(s, T + 9_999_999), { stop: true, reason: "limit reached" }, "and none later either");
});

test("navigating between pages, or reloading, resumes the schedule: the first 5 s starts once and the count is kept", () => {
	const s = { session: mem(), local: mem() };
	const T = 5_000_000;
	assert.equal(autoPlan(s, T).delay, 5000, "the visit starts the 5 s countdown");
	assert.equal(autoPlan(s, T + 2000).delay, 3000, "another page 2 s later: 3 s left, NOT a fresh 5 s");
	assert.equal(autoPlan(s, T + 4900).delay, 100, "and again: still the original countdown");
	recordShown(s.session, T + 5000);
	recordClosed(s.session, T + 6000);
	assert.equal(shownCount(s.session), 1, "the count survives navigation");
	assert.equal(autoPlan(s, T + 9000).delay, 7000, "a page change mid-wait does not reset the 10 s wait either");
	// a visit that spent a long time on an excluded page (login): the due time passed, so it shows shortly after the visitor returns
	assert.equal(autoPlan(s, T + 600_000).delay, AUTO_POPUP.resumeMinMs);
	// a new visit (new session storage) starts again from 5 s with the count at zero
	const fresh = { session: mem(), local: s.local };
	assert.equal(autoPlan(fresh, T + 700_000).delay, 5000);
	assert.equal(shownCount(fresh.session), 0);
});

test("a request that was sent stops every further automatic popup (this visit, and a week on this browser)", () => {
	const s = { session: mem(), local: mem() };
	const T = 9_000_000;
	autoPlan(s, T);
	recordShown(s.session, T + 5000);
	markSubmitted(s, T + 6000);
	assert.equal(isSuppressed(s, T + 7000), true);
	assert.deepEqual(autoPlan(s, T + 20000), { stop: true, reason: "request sent" });
	const nextVisit = { session: mem(), local: s.local }; // another tab / visit, same browser
	assert.equal(autoPlan(nextVisit, T + 60000).stop, true, "still stopped");
	assert.equal(autoPlan({ session: mem(), local: s.local }, T + 6000 + AUTO_POPUP.submitCooldownMs + 1).stop, false, "a week later it may appear again");
	assert.equal(isSuppressed({}, 1), false, "no storage available: not suppressed, no crash");
});

test("a moment that is not right (another dialog or menu open) is postponed without counting a display", () => {
	const s = { session: mem(), local: mem() };
	const T = 2_000_000;
	autoPlan(s, T);
	postponeNext(s.session, 3000, T + 5000);
	assert.equal(shownCount(s.session), 0);
	assert.equal(autoPlan(s, T + 5000).delay, 3000);
});

test("the provider: one timer, derived from the stored schedule; manual buttons never touch the schedule; cleaned up on unmount", () => {
	const p = read("components/FreeDemo/FreeDemoProvider.js");
	assert.equal((p.match(/setTimeout\(/g) || []).length, 1, "a single setTimeout call");
	assert.match(p, /const arm = useCallback\(\(\) => \{\s*clearTimer\(\);/, "every arm() clears the previous wake-up first: no duplicate timers");
	assert.match(p, /return clearTimer;/, "the timer is cleared on unmount / change");
	assert.match(p, /visibilitychange/);
	assert.match(p, /document\.hidden/);
	const openDemo = p.slice(p.indexOf("const openDemo"), p.indexOf("const fireRef"));
	assert.doesNotMatch(openDemo, /recordShown|recordClosed|postponeNext|autoPlan/, "opening the dialog (a button) does not touch the schedule or the count");
	assert.match(p, /if \(wasAutomatic\) recordClosed\(/, "only an AUTOMATIC popup's close schedules the next one");
	assert.match(p, /onSubmitted = useCallback\(\(\) => \{\s*markSubmitted\(stores\(\)\);\s*clearTimer\(\);/, "a sent request cancels the pending popup");
	assert.equal((p.match(/<FreeDemoModal/g) || []).length, 1, "only one dialog instance");
	assert.doesNotMatch(p, /clampDelay|markDismissed|NEXT_PUBLIC_FREE_DEMO/);
});

test("automatic popup only on public marketing pages, never on login, checkout, careers, the meeting form, application pages or any dashboard", () => {
	for (const p of ["/", "/about-us/", "/programs/", "/programs/mathx/", "/gallery/", "/blog/blogs/", "/blog/1", "/success-stories/", "/contact-us/", "/faq/"]) assert.equal(autoPopupEligible(p, null), true, p);
	for (const p of ["/auth/", "/checkout/", "/careers/", "/schedule-a-call/", "/become-an-instructor/", "/become-a-telecaller/", "/courses/", "/course/x/", "/study/", "/family/", "/learning/my-courses/", "/instructor/dashboard/", "/admin/", "/admin/meetings/", "/telecaller/", "/profile/basic-information/", "/forgot-password/"]) assert.equal(autoPopupEligible(p, null), false, p);
	assert.equal(autoPopupEligible("/", { role: "student" }), false, "signed-in users never get it");
});

test("the header button follows the same rule plus the course catalogue and course pages, and never appears for signed-in users", () => {
	for (const p of ["/", "/programs/leadership/", "/courses/", "/course/some-course/", "/category/x"]) assert.equal(showHeaderDemo(p, null), true, p);
	for (const p of ["/auth/", "/checkout/", "/careers/", "/schedule-a-call/", "/admin/", "/telecaller/", "/study/"]) assert.equal(showHeaderDemo(p, null), false, p);
	assert.equal(showHeaderDemo("/", { role: "admin" }), false);
});

test("source names: the requested ones exist, unknown values become 'other', program sources follow the program slug", () => {
	for (const s of ["homepage_header", "homepage_hero", "homepage_footer", "program_personality_enrichment", "program_mathx", "program_leadership", "program_public_speaking", "gallery_cta", "about_cta", "contact_cta", "blog_cta", "course_detail_cta", "automatic_popup"]) assert.ok(SOURCES.includes(s), s);
	assert.equal(sourceId("program_mathx"), "program_mathx");
	assert.equal(sourceId("<script>"), "other");
	assert.equal(sourceForProgram("public-speaking"), "program_public_speaking");
	assert.equal(headerSource("/"), "homepage_header");
	assert.equal(headerSource("/about-us/"), "header");
});

test("form rules: required = parent name, phone, child name, grade, program; email, class type, date/time, message are optional", () => {
	const ok = { name: "Asha Rao", phone: "+91 98765 43210", childName: "Ravi", childGrade: "Grade 5", program: "mathx" };
	assert.deepEqual(validateDemoForm(ok, "2026-11-23"), {});
	for (const missing of ["name", "phone", "childName", "childGrade", "program"]) assert.ok(validateDemoForm({ ...ok, [missing]: "" }, "2026-11-23")[missing], missing);
	assert.ok(validateDemoForm({ ...ok, program: "chess" })["program"], "only the four real programs");
	assert.ok(validateDemoForm({ ...ok, email: "nope" }).email);
	assert.deepEqual(validateDemoForm({ ...ok, email: "a@b.co" }, "2026-11-23"), {});
	assert.ok(validateDemoForm({ ...ok, date: "2026-12-01", timeZone: "UTC" }, "2026-11-23").time, "date without time");
	assert.ok(validateDemoForm({ ...ok, time: "10:00", timeZone: "UTC" }, "2026-11-23").date, "time without date");
	assert.ok(validateDemoForm({ ...ok, date: "2026-11-01", time: "10:00", timeZone: "UTC" }, "2026-11-23").date, "past date");
	assert.deepEqual(validateDemoForm({ ...ok, date: "2026-12-01", time: "10:00", timeZone: "UTC" }, "2026-11-23"), {});
	assert.equal(safePage("/a/b-c_d"), "/a/b-c_d");
	assert.equal(safePage("//evil.example"), "/", "no scheme-relative or odd paths");
	assert.ok(GRADES.includes("Grade 5") && GRADES.length >= 13);
});

test("a request built from the form is accepted by the server validation, with source and page stored as fields", () => {
	const out = validateSubmission({ kind: "free_demo", name: "Asha Rao", phone: "+91 98765 43210", childName: "Ravi", childGrade: "Grade 5", program: "leadership", source: "homepage_hero", page: "/", classMode: "online", timeZone: "Asia/Kolkata", submissionKey: "k-123456789012" }, new Date("2026-11-23T00:00:00Z"));
	assert.deepEqual([out.kind, out.purpose, out.program, out.source, out.source_page, out.class_mode, out.email, out.requested_at], ["free_demo", "product_demo", "leadership", "homepage_hero", "/", "online", null, null]);
});

test("one shared button component and one dialog: no second booking form, API or model was added", () => {
	const p = read("components/FreeDemo/FreeDemoProvider.js");
	assert.match(p, /export const BookFreeDemoButton/);
	assert.match(p, /openRef\.current/);
	assert.equal((p.match(/<FreeDemoModal/g) || []).length, 1, "a single modal instance is rendered");
	assert.match(read("components/FreeDemo/FreeDemoModal.js"), /\/api\/meetings\/request/);
	assert.match(read("components/FreeDemo/FreeDemoModal.js"), /kind: "free_demo"/);
	assert.ok(!fs.existsSync(new URL("../../pages/api/free-demo", import.meta.url)) && !fs.existsSync(new URL("../../pages/api/demo", import.meta.url)));
	assert.doesNotMatch(read("components/_App/Navbar.js"), /<FreeDemoModal|axios/);
});

test("the first 5 s are counted from when the page opened (slow hydration shortens the wait; a stored schedule is never changed)", () => {
	const s = { session: mem(), local: mem() };
	assert.equal(autoPlan(s, 1000, 0).delay, 5000); // script ready at once: full 5 s
	const t = { session: mem(), local: mem() };
	assert.equal(autoPlan(t, 1000, 2000).delay, 3000); // 2 s were spent loading: 3 s left
	assert.equal(autoPlan(t, 1500, 4000).delay, 2500); // the stored time (1000 + 3000) is kept, whatever the page age
	const late = { session: mem(), local: mem() };
	assert.equal(autoPlan(late, 1000, 9000).delay, AUTO_POPUP.firstMinMs); // very slow load: shown almost at once, never negative
	const bad = { session: mem(), local: mem() };
	assert.equal(autoPlan(bad, 1000, NaN).delay, 5000);
	assert.equal(autoPlan({ session: mem(), local: mem() }, 1000, -50).delay, 5000);
});
