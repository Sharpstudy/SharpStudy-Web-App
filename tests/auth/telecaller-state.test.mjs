// Telecaller account states, routing and page access. Telecaller accounts are ordinary role=student rows, so every decision here is made
// from the account STATE (derived from the database by /api/users/update and lib/auth/telecallerAccess.js), never from the role alone.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { telecallerState, destinationFor, isTelecallerRestricted, isTelecallerApplicant, APPLICATION_PAGE } from "../../lib/auth/telecallerState.js";
import { pageAccess } from "../../lib/auth/pageAccess.js";
import { navModel } from "../../components/_App/accountLinks.js";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const APPROVED = new Date("2026-10-01");
const mk = (state, extra = {}) => ({ role: "student", telecaller_state: state, telecaller_access: state === "active" ? "active" : null, ...extra });

test("telecallerState: every database situation maps to one state", () => {
	const s = (o) => telecallerState({ role: "student", ...o });
	assert.equal(s({}), "none");
	assert.equal(s({ applicationStatus: "draft" }), "draft");
	assert.equal(s({ applicationStatus: "pending" }), "pending");
	assert.equal(s({ applicationStatus: "more_info_requested" }), "more_info");
	assert.equal(s({ applicationStatus: "rejected" }), "rejected");
	assert.equal(s({ applicationStatus: "approved", profileStatus: "active", approvedAt: APPROVED }), "active");
	assert.equal(s({ applicationStatus: "approved", profileStatus: "inactive", approvedAt: APPROVED }), "inactive");
	assert.equal(s({ profileStatus: "active", approvedAt: null }), "inactive", "an active profile without approved_at is not access");
	assert.equal(s({ applicationStatus: "approved" }), "inactive", "approved with no profile row fails closed");
	assert.equal(telecallerState({ role: "admin", applicationStatus: "pending" }), "none");
	assert.equal(telecallerState({ role: "student", isLearner: true, profileStatus: "active", approvedAt: APPROVED }), "none", "a child's learner login never gets telecaller access");
});

test("landing: each state goes to its own destination; only an ordinary student reaches My Learning", () => {
	assert.equal(destinationFor("active"), "/telecaller/");
	for (const st of ["draft", "pending", "more_info", "rejected", "inactive"]) assert.equal(destinationFor(st), APPLICATION_PAGE, st);
	assert.equal(destinationFor("none"), "", "an ordinary student keeps the normal landing");
	const src = read("lib/auth/landing.js");
	assert.ok(src.indexOf("telecallerStateFor(user)") > 0);
	assert.ok(src.indexOf("telecallerStateFor(user)") < src.indexOf("hasOpenApplication(user.id)"));
	assert.ok(src.indexOf("telecallerStateFor(user)") < src.indexOf("dashboardHome(user.role)"), "decided before My Learning");
});

test("normal student: student pages open, telecaller dashboard closed", () => {
	const u = mk("none");
	for (const p of ["/learning/my-courses/", "/study/", "/family/", "/checkout/", "/"]) assert.equal(pageAccess(p, u), null, p);
	assert.equal(pageAccess("/telecaller/", u), "/");
	assert.equal(pageAccess("/admin", u), "/");
});

test("pending and 'more information' applicants: student areas closed, application page open, dashboards closed", () => {
	for (const st of ["pending", "more_info"]) {
		const u = mk(st);
		for (const p of ["/learning/my-courses/", "/learning/my-books/", "/study/", "/study/anything", "/family/", "/print/x", "/checkout"]) assert.equal(pageAccess(p, u), APPLICATION_PAGE, `${st} ${p}`);
		assert.equal(pageAccess("/telecaller/", u), APPLICATION_PAGE, "typing the telecaller URL shows their status, not the student home");
		assert.equal(pageAccess("/telecaller", u), APPLICATION_PAGE);
		assert.equal(pageAccess("/admin", u), "/");
		for (const p of ["/become-a-telecaller/", "/profile/basic-information/", "/", "/courses/", "/about-us/"]) assert.equal(pageAccess(p, u), null, `${st} ${p}`);
		assert.ok(isTelecallerRestricted(u));
		assert.deepEqual(navModel(u, "/become-a-telecaller/").account.map((l) => l.label), ["Telecaller Application", "Account Settings"], "no student navigation");
		assert.deepEqual(navModel(u, "/").primary, []);
	}
});

test("draft and rejected applicants are steered at sign-in but keep their normal student access", () => {
	for (const st of ["draft", "rejected"]) {
		const u = mk(st);
		assert.equal(pageAccess("/learning/my-courses/", u), null, st);
		assert.ok(isTelecallerApplicant(u));
		assert.ok(!isTelecallerRestricted(u));
		assert.equal(pageAccess("/telecaller/", u), APPLICATION_PAGE);
	}
});

test("approved active telecaller: dashboard open, student learning area closed, only telecaller navigation", () => {
	const u = mk("active");
	assert.equal(pageAccess("/telecaller/", u), null);
	for (const p of ["/learning/my-courses/", "/learning/my-books/", "/learning/wishlist/"]) assert.equal(pageAccess(p, u), "/telecaller/", p);
	assert.deepEqual(navModel(u, "/telecaller/").account.map((l) => l.label), ["Telecaller Dashboard", "Account Settings"]);
	assert.equal(pageAccess("/admin", u), "/");
});

test("deactivated telecaller: no dashboard, no student areas, status page only", () => {
	const u = mk("inactive");
	assert.equal(pageAccess("/telecaller/", u), APPLICATION_PAGE);
	assert.equal(pageAccess("/learning/my-courses/", u), APPLICATION_PAGE);
	assert.equal(pageAccess("/study/", u), APPLICATION_PAGE);
	assert.equal(pageAccess(APPLICATION_PAGE, u), null, "the status page itself is allowed, so there is no redirect loop");
	assert.ok(!navModel(u, "/").account.some((l) => /Learning|Telecaller Dashboard/.test(l.label)));
});

test("no redirect loop for any state: following the gate always ends on an allowed page", () => {
	for (const st of ["none", "draft", "pending", "more_info", "rejected", "active", "inactive"]) {
		const u = mk(st);
		for (const p of ["/learning/my-courses/", "/telecaller/", "/study/", "/become-a-telecaller/", "/family/"]) {
			let at = p;
			const seen = new Set();
			for (let i = 0; i < 4; i++) {
				const to = pageAccess(at, u);
				if (!to) break;
				assert.ok(!seen.has(to), `${st}: loop from ${p}`);
				seen.add(to);
				at = to;
			}
			assert.equal(pageAccess(at, u), null, `${st}: ${p} -> ${at} must be a final page`);
		}
	}
});

test("admins and instructors are unchanged; an instructor with a pending application keeps instructor pages", () => {
	assert.equal(pageAccess("/admin", { role: "admin", telecaller_state: "none" }), null);
	assert.equal(pageAccess("/telecaller/", { role: "admin" }), null, "admins keep Telecaller management access");
	assert.equal(pageAccess("/instructor/courses", { role: "instructor", telecaller_state: "pending" }), null);
	assert.equal(pageAccess("/learning/my-courses/", { role: "instructor", telecaller_state: "pending" }), null);
});

test("the server computes the state: /api/users/update returns it and no client value is trusted", () => {
	const src = read("pages/api/users/update.js");
	assert.match(src, /telecaller_state = user \? telecallerState\(/);
	assert.match(src, /TelecallerApplication\.findOne\(\{ where: \{ user_id: userId \}/);
	assert.doesNotMatch(src, /req\.body\.(telecaller|role)/);
	// the profile-update handler writes only its whitelisted profile fields: never role, status or telecaller data
	const update = src.slice(src.indexOf("const userUpdate"));
	assert.doesNotMatch(update.slice(0, update.indexOf("await User.update")), /\brole\b/);
});

test("the application page tells an active telecaller where the dashboard is, and a pending applicant the student areas are paused", () => {
	const src = read("components/BecomeATelecaller/TelecallerApplicationForm.js");
	assert.doesNotMatch(src, /dashboard is not open yet/);
	assert.match(src, /Open the telecaller dashboard/);
	assert.match(src, /student areas .* stay closed/);
});

// ---- direct API access: the telecaller APIs re-check the database on every call (covered in depth by tests/followups); here the wiring
test("telecaller APIs refuse applicants and deactivated telecallers by themselves, whatever page they could open", async () => {
	const { memoryRepo, U, M, profile } = await import("../followups/memoryRepo.mjs");
	const svc = await import("../../lib/followups/service.js");
	const pending = U(21), rejected = U(22), inactive = U(23), student = U(24), active = U(25), admin = U(26, { role: "admin" });
	const repo = memoryRepo({ users: [pending, rejected, inactive, student, active, admin], profiles: [profile(inactive.id, { status: "inactive" }), profile(active.id)], meetings: [M(1)] });
	const deps = { repo, now: () => new Date("2026-11-04T10:00:00Z") };
	const as = (u) => ({ userId: u.id, role: u.role });
	const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
	for (const u of [pending, rejected, student]) {
		assert.equal(await status(svc.getDashboard(deps, as(u), {})), 403, "dashboard");
		assert.equal(await status(svc.listMeetings(deps, as(u), {})), 403, "list");
		assert.equal(await status(svc.claimMeeting(deps, as(u), "x")), 403, "claim");
	}
	assert.equal(await status(svc.getDashboard(deps, as(inactive), {})), 403);
	assert.equal(await status(svc.listMeetings(deps, as(inactive), {})), 403);
	assert.equal(await status(svc.getDashboard(deps, as(active), {})), 200);
	assert.equal(await status(svc.getDashboard(deps, as(admin), {})), 200, "admins keep read access");
});
