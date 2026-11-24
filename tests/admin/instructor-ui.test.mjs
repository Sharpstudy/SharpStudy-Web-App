// Admin > Instructors: the Actions menu and the Phone / Subject / Text columns.
// There is no DOM in `node --test`, so behaviour is covered by pure modules (placement, single-open registry, menu
// items, field mapping) plus static checks of the markup/CSS wiring. Real-browser behaviour is verified separately.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { placeMenu } from "../../lib/ui/menuPosition.js";
import { claimMenu, releaseMenu, openMenuCount } from "../../lib/ui/menuRegistry.js";
import { accountMenuItems } from "../../lib/admin/accountMenu.js";
import { INSTRUCTOR_LIST_ATTRS, toInstructorRow, orNA } from "../../lib/admin/instructorList.js";
import { ANON_DOMAIN } from "../../lib/admin/anonymized.js";

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// ---------------------------------------------------------------- placement
const rect = (top, right, h = 32, w = 32) => ({ top, bottom: top + h, left: right - w, right });
const PANEL = { width: 220, height: 130 };

test("menu opens below the button, right-aligned with it", () => {
	const p = placeMenu({ anchor: rect(100, 1000), size: PANEL, viewport: { width: 1280, height: 800 } });
	assert.equal(p.placement, "below");
	assert.equal(p.top, 100 + 32 + 6);
	assert.equal(p.left, 1000 - 220);
});

test("menu flips above when there is no room below (last rows of a long table)", () => {
	const p = placeMenu({ anchor: rect(740, 1000), size: PANEL, viewport: { width: 1280, height: 800 } });
	assert.equal(p.placement, "above");
	assert.equal(p.top + 130 + 6, 740);
});

test("menu stays inside a small phone screen horizontally", () => {
	const left = placeMenu({ anchor: rect(100, 40), size: PANEL, viewport: { width: 360, height: 640 } });
	assert.equal(left.left, 8);
	const right = placeMenu({ anchor: rect(100, 360), size: PANEL, viewport: { width: 360, height: 640 } });
	assert.ok(right.left + right.width <= 360 - 8);
	const tiny = placeMenu({ anchor: rect(100, 200), size: { width: 400, height: 130 }, viewport: { width: 320, height: 640 } });
	assert.ok(tiny.width <= 320 - 16 && tiny.left >= 8);
});

test("menu is height-capped (scrollable) when neither side can hold it", () => {
	const p = placeMenu({ anchor: rect(60, 300), size: { width: 220, height: 500 }, viewport: { width: 400, height: 200 } });
	assert.ok(p.maxHeight < 500);
	assert.ok(p.top >= 8);
});

// ---------------------------------------------------------------- one menu open at a time
test("opening a menu closes the one that was open; releasing clears the registry", () => {
	const log = [];
	const a = () => log.push("a");
	const b = () => log.push("b");
	claimMenu(a);
	assert.equal(openMenuCount(), 1);
	claimMenu(b); // opens row B -> row A must close
	assert.deepEqual(log, ["a"]);
	claimMenu(b); // re-claiming the same menu does not close itself
	assert.deepEqual(log, ["a"]);
	releaseMenu(a); // a stale release must not clear B
	assert.equal(openMenuCount(), 1);
	releaseMenu(b);
	assert.equal(openMenuCount(), 0);
});

// ---------------------------------------------------------------- which actions each row offers
const labels = (u) => accountMenuItems(u, {}).map((i) => i.label);
test("active account: View Details, Deactivate Account, Anonymize Account", () => {
	for (const status of [true, 1]) assert.deepEqual(labels({ role: "instructor", email: "a@b.c", status }), ["View Details", "Deactivate Account", "Anonymize Account"]);
});
test("inactive account: View Details, Reactivate Account, Anonymize Account", () => {
	for (const status of [false, 0, null]) assert.deepEqual(labels({ role: "instructor", email: "a@b.c", status }), ["View Details", "Reactivate Account", "Anonymize Account"]);
});
test("anonymized and administrator rows only offer View Details", () => {
	assert.deepEqual(labels({ role: "instructor", email: `x@${ANON_DOMAIN}`, status: false }), ["View Details"]);
	assert.deepEqual(labels({ role: "admin", email: "a@b.c", status: true }), ["View Details"]);
});
test("each menu item runs the matching handler with the row's user, and Anonymize is the only danger item", () => {
	const user = { role: "student", email: "a@b.c", status: true };
	const calls = [];
	const on = Object.fromEntries(["view", "deactivate", "reactivate", "anonymize"].map((k) => [k, (u) => calls.push([k, u])]));
	for (const item of accountMenuItems(user, on)) item.onClick();
	assert.deepEqual(calls.map((c) => c[0]), ["view", "deactivate", "anonymize"]);
	assert.ok(calls.every((c) => c[1] === user));
	assert.deepEqual(accountMenuItems(user, on).filter((i) => i.danger).map((i) => i.key), ["anonymize"]);
	assert.ok(!labels(user).some((l) => /delete/i.test(l)), "no 'Delete' wording anywhere");
});

test("an instructor's View Details is a link to that instructor's own details page (no handler, no shared id)", () => {
	const view = accountMenuItems({ id: "11111111-1111-4111-8111-111111111111", role: "instructor", email: "a@b.c", status: true }, {})[0];
	assert.equal(view.label, "View Details");
	assert.equal(view.href, "/admin/instructor/11111111-1111-4111-8111-111111111111/");
	assert.equal(view.onClick, undefined);
});

// REGRESSION: on the real Instructors page the menu opened but was empty, because the page never passed
// `menuItems` to the rows (an edit that silently did not apply). Pin it for both account tables.
test("both account pages hand every row its menu items, and an empty menu renders no button", () => {
	for (const [file, v] of [["pages/admin/instructor/index.js", "instructor"], ["pages/admin/students/index.js", "user"]]) {
		assert.ok(read(file).includes("menuItems={itemsFor(" + v + ")}"), file + " must pass menuItems to its rows");
	}
	assert.ok(read("components/ui/ActionMenu.js").includes("if (!items || !items.length) return null;"));
});

// ---------------------------------------------------------------- clipping: the actual cause and the fix
test("root cause is present in the stylesheet: .table-responsive clips overflow (so an in-table absolute menu is clipped)", () => {
	const css = fs.readFileSync(new URL("../../styles/bootstrap.min.css", import.meta.url), "utf8");
	assert.match(css, /\.table-responsive\{overflow-x:auto/);
});

test("ActionMenu renders its panel in a portal on <body> with position: fixed, so no table ancestor can clip it", () => {
	const src = read("components/ui/ActionMenu.js");
	assert.match(src, /createPortal\([\s\S]*document\.body\s*\)/);
	assert.match(src, /ss-menu__panel--floating/);
	const scss = read("styles/sharpstudy/_app.scss");
	const rule = scss.slice(scss.indexOf(".ss-menu__panel--floating"));
	assert.match(rule.slice(0, 400), /position:\s*fixed/);
	assert.match(rule.slice(0, 400), /z-index:\s*2000/); // above nav/drawer (<=1050), below confirm dialogs (3000)
	assert.match(read("styles/sharpstudy/_play.scss"), /\.ss-confirm \{[^}]*z-index: 3000/);
});

test("the menu closes on outside press and Escape, supports arrow keys, and the trigger is not treated as 'outside'", () => {
	const src = read("components/ui/ActionMenu.js");
	assert.match(src, /addEventListener\("pointerdown"/);
	assert.match(src, /trigger\.current\.contains\(e\.target\)\) return/); // avoids close-then-reopen on the trigger click
	assert.match(src, /e\.key === "Escape"/);
	for (const k of ["ArrowDown", "ArrowUp", "Home", "End"]) assert.match(src, new RegExp(k));
	assert.match(src, /aria-haspopup="menu"/);
	assert.match(src, /aria-expanded=\{open\}/);
	assert.match(src, /claimMenu\(fn\)/);
});

test("the pages no longer rely on a min-height hack to make room for the menu", () => {
	for (const f of ["pages/admin/instructor/index.js", "pages/admin/students/index.js"]) assert.doesNotMatch(read(f), /minHeight/);
});

// ---------------------------------------------------------------- Phone / Subject / Text
const base = { id: "u1", first_name: "Ann", last_name: "Teach", email: "ann@example.com", role: "instructor", status: 1, created_at: "2026-01-01" };

test("INSTRUCTOR_LIST_ATTRS never includes credentials or unrelated private columns", () => {
	for (const bad of ["password", "reset_password_token", "reset_password_at", "twitter", "facebook", "youtube", "location"]) assert.ok(!INSTRUCTOR_LIST_ATTRS.includes(bad), bad);
	for (const need of ["phone", "instructor_subject", "instructor_description", "bio", "status", "email"]) assert.ok(INSTRUCTOR_LIST_ATTRS.includes(need), need);
});

test("fields on the user record map straight through", () => {
	const r = toInstructorRow({ ...base, phone: "+91 98765 43210", instructor_subject: "Maths", instructor_description: "Ten years teaching" });
	assert.equal(r.phone, "+91 98765 43210");
	assert.equal(r.subject, "Maths");
	assert.equal(r.about, "Ten years teaching");
	assert.equal(r.email, "ann@example.com");
});

test("instructors approved through the application flow: subject and phone come from their own profile/application", () => {
	const r = toInstructorRow(base, { subjects: "Math, Physics" }, { phone: "+1 555 0100" });
	assert.equal(r.subject, "Math, Physics");
	assert.equal(r.phone, "+1 555 0100");
});

test("user columns win over the fallbacks", () => {
	const r = toInstructorRow({ ...base, phone: "111", instructor_subject: "Art" }, { subjects: "Math" }, { phone: "222" });
	assert.equal(r.phone, "111");
	assert.equal(r.subject, "Art");
});

test("Text is the legacy description, else the instructor's own bio", () => {
	assert.equal(toInstructorRow({ ...base, instructor_description: "legacy", bio: "bio" }).about, "legacy");
	assert.equal(toInstructorRow({ ...base, bio: "My bio" }).about, "My bio");
});

test("genuinely empty values stay null and render as N/A (never a blank cell, never someone else's data)", () => {
	const r = toInstructorRow({ ...base, phone: "", instructor_subject: "   ", instructor_description: null, bio: undefined });
	assert.deepEqual([r.phone, r.subject, r.about], [null, null, null]);
	for (const v of [null, undefined, "", "   "]) assert.equal(orNA(v), "N/A");
	assert.equal(orNA(" Maths "), "Maths");
	assert.equal(orNA(0), "0");
	// each row is built from its own user + its own profile/application only
	const other = toInstructorRow({ ...base, id: "u2" }, undefined, undefined);
	assert.equal(other.phone, null);
});

test("an anonymized account does not resurface personal details from retained application records", () => {
	const r = toInstructorRow({ ...base, email: `anonymized-u1@${ANON_DOMAIN}`, status: 0, phone: null, bio: null }, { subjects: "Math" }, { phone: "+1 555 0100" });
	assert.deepEqual([r.phone, r.subject, r.about], [null, null, null]);
});

test("API is admin-only, selects explicit columns and maps through toInstructorRow; the row shows N/A for empties", () => {
	const api = read("pages/api/instructor/instructors.js");
	assert.ok(api.indexOf('requireRole(req, res, ["admin"])') > -1 && api.indexOf("requireRole") < api.indexOf("User.findAll"));
	assert.match(api, /attributes: INSTRUCTOR_LIST_ATTRS/);
	assert.match(api, /toInstructorRow\(/);
	assert.match(api, /role: "instructor"/);
	const row = read("components/Admin/InstructorRow.js");
	for (const f of ["phone", "subject", "about"]) assert.match(row, new RegExp(`orNA\\(${f}\\)`));
});
