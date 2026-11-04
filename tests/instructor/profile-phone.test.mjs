// Instructor teaching profile: phone number (stored in users.phone, the column the admin screens already read).
// In-memory repo only: no database is touched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizePhone, PHONE_MAX_LENGTH } from "../../lib/phone.js";
import { ProfileError, getOwnProfile, saveOwnProfile } from "../../lib/instructor/profileService.js";
import { toInstructorRow, INSTRUCTOR_LIST_ATTRS } from "../../lib/admin/instructorList.js";
import { loadInstructorDetails } from "../../lib/admin/instructorDetails.js";
import { ANON_DOMAIN } from "../../lib/admin/anonymized.js";

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Behaves like profileRepo.js: users + one instructor_profiles row per user, created only on demand.
function memoryRepo() {
	const users = new Map([
		[A, { id: A, first_name: "Ann", last_name: "Alpha", email: "ann@example.com", role: "instructor", status: true, created_at: "2026-01-01", phone: null, designation: "Maths teacher", bio: "Ann bio", location: "Pune", website: "https://ann.example/", linkedin: "https://linkedin.com/in/ann", profile_photo: null, instructor_subject: null, instructor_description: null }],
		[B, { id: B, first_name: "Ben", last_name: "Beta", email: "ben@example.com", role: "instructor", status: true, created_at: "2026-02-01", phone: "+44 7911 123456", designation: "Biology", bio: "Ben bio", location: "London", website: "", linkedin: "", profile_photo: null }],
	]);
	const profiles = new Map([[A, { user_id: A, qualifications: "MSc", languages: "English, Hindi", subjects: "Algebra", experience: "10 years" }]]);
	const writes = [];
	const USER_FIELDS = ["first_name", "last_name", "email", "designation", "bio", "profile_photo", "location", "website", "linkedin", "phone"];
	return {
		users, profiles, writes,
		async getUser(id) { const u = users.get(id); return u ? Object.fromEntries(USER_FIELDS.map((k) => [k, u[k] === undefined ? null : u[k]])) : null; },
		async getProfile(id) { return profiles.has(id) ? { ...profiles.get(id) } : null; },
		async updateUser(id, patch) { writes.push(["user", id, patch]); users.set(id, { ...users.get(id), ...patch }); },
		async upsertProfile(id, patch) { writes.push(["profile", id, patch]); profiles.set(id, { ...(profiles.get(id) || { user_id: id }), ...patch }); },
	};
}
const actorA = { userId: A, role: "instructor", email: "ann@example.com" };
const actorB = { userId: B, role: "instructor", email: "ben@example.com" };
const fails = (p, status, code) => assert.rejects(p, (e) => e instanceof ProfileError && e.status === status && (!code || e.code === code));

// ---------------------------------------------------------------- validation
test("valid numbers are accepted and normalised (country code, Indian numbers, separators)", () => {
	const cases = [
		["+91 98765 43210", "+91 98765 43210"],
		["+919876543210", "+919876543210"],
		["  +91   98765   43210  ", "+91 98765 43210"],
		["98765 43210", "98765 43210"],
		["+1 (555) 010-0100", "+1 (555) 010-0100"],
		["+44 7911 123456", "+44 7911 123456"],
		["+91 11 2345 6789", "+91 11 2345 6789"], // Delhi landline: area code + number = 10 digits
		["555.0100", "555.0100"], // 7 digits
		["98765\n43210", "98765 43210"], // a pasted line break is whitespace: collapsed, never stored
	];
	for (const [input, out] of cases) assert.deepEqual(normalizePhone(input), { ok: true, value: out }, input);
});

test("empty means 'no phone number'", () => {
	for (const v of ["", "   ", null, undefined]) assert.deepEqual(normalizePhone(v), { ok: true, value: null });
});

test("invalid numbers are rejected with a reason", () => {
	const bad = [
		"abc", "phone: 9876543210", "12345", "123456", // letters / too short (<7 digits)
		"+91 12345", "+91 0876543210", "+91 98765 432101", "+91 987654321", // wrong Indian lengths / invalid first digit
		"++919876543210", "91+9876543210", "+", "+-.", // misplaced or missing digits
		"1234567890123456", // 16 digits
		"+1 555 010 0100 ext 5", "9876543210;DROP TABLE users", "<script>alert(1)</script>",
		"x".repeat(PHONE_MAX_LENGTH + 1), "1".repeat(PHONE_MAX_LENGTH + 1),
		123456789, {}, [], true,
	];
	for (const input of bad) {
		const r = normalizePhone(input);
		assert.equal(r.ok, false, JSON.stringify(input));
		assert.ok(typeof r.error === "string" && r.error.length > 5, JSON.stringify(input));
	}
});

// ---------------------------------------------------------------- saving and loading
test("saving a new phone number stores it in users.phone and returns it", async () => {
	const repo = memoryRepo();
	const r = await saveOwnProfile(repo, actorA, { phone: "+91 98765 43210" });
	assert.equal(r.profile.phone, "+91 98765 43210");
	assert.equal(repo.users.get(A).phone, "+91 98765 43210");
	assert.deepEqual(repo.writes.map((w) => [w[0], Object.keys(w[2])]), [["user", ["phone"]]], "only users.phone was written");
});

test("updating an existing number replaces it", async () => {
	const repo = memoryRepo();
	await saveOwnProfile(repo, actorA, { phone: "+91 98765 43210" });
	const r = await saveOwnProfile(repo, actorA, { phone: "+91 91234 56789" });
	assert.equal(r.profile.phone, "+91 91234 56789");
	assert.equal(repo.users.get(A).phone, "+91 91234 56789");
});

test("reopening the profile loads the saved number (GET)", async () => {
	const repo = memoryRepo();
	assert.equal((await getOwnProfile(repo, A)).profile.phone, "", "nothing saved yet reads as an empty field");
	await saveOwnProfile(repo, actorA, { phone: "+91 98765 43210" });
	const again = await getOwnProfile(repo, A);
	assert.equal(again.profile.phone, "+91 98765 43210");
	assert.equal((await getOwnProfile(repo, B)).profile.phone, "+44 7911 123456", "each instructor reads their own number");
});

test("clearing the field removes the number", async () => {
	const repo = memoryRepo();
	await saveOwnProfile(repo, actorA, { phone: "+91 98765 43210" });
	const r = await saveOwnProfile(repo, actorA, { phone: "" });
	assert.equal(r.profile.phone, "");
	assert.equal(repo.users.get(A).phone, null);
});

// ---------------------------------------------------------------- nothing else changes
test("a phone-only update leaves every other profile field exactly as it was", async () => {
	const repo = memoryRepo();
	const before = { user: { ...repo.users.get(A) }, profile: { ...repo.profiles.get(A) } };
	await saveOwnProfile(repo, actorA, { phone: "+91 98765 43210" });
	const after = { user: { ...repo.users.get(A) }, profile: { ...repo.profiles.get(A) } };
	assert.deepEqual({ ...after.user, phone: null }, { ...before.user, phone: null });
	assert.deepEqual(after.profile, before.profile);
});

test("updating other fields does not touch the phone number, and no empty instructor_profiles row is created", async () => {
	const repo = memoryRepo();
	await saveOwnProfile(repo, actorB, { phone: "+44 7911 123456" });
	assert.equal(repo.profiles.has(B), false, "a phone-only save creates no instructor_profiles row");
	const r = await saveOwnProfile(repo, actorB, { bio: "New bio" });
	assert.equal(r.profile.phone, "+44 7911 123456");
	assert.equal(r.profile.bio, "New bio");
	assert.equal(r.profile.designation, "Biology");
	assert.equal(repo.profiles.has(B), false, "still no teaching-profile row: none of its fields were sent");
});

test("the full form (all fields incl. phone) saves everything, and the existing profile row is updated, not duplicated", async () => {
	const repo = memoryRepo();
	const r = await saveOwnProfile(repo, actorA, { designation: "Senior teacher", location: "Mumbai", phone: "+91 98765 43210", bio: "Bio", qualifications: "MSc, BEd", subjects: "Algebra, Geometry", languages: "English", experience: "12 years", website: "https://a.example/", linkedin: "https://linkedin.com/in/a" });
	assert.deepEqual([r.profile.designation, r.profile.location, r.profile.phone, r.profile.qualifications, r.profile.subjects], ["Senior teacher", "Mumbai", "+91 98765 43210", "MSc, BEd", "Algebra, Geometry"]);
	assert.equal(repo.profiles.size, 1, "one instructor_profiles row for this instructor");
});

test("extra properties in the body (first_name, role, email, status...) are ignored", async () => {
	const repo = memoryRepo();
	await saveOwnProfile(repo, actorA, { phone: "+91 98765 43210", role: "admin", email: "evil@example.com", first_name: "Hacked", status: false });
	const u = repo.users.get(A);
	assert.deepEqual([u.role, u.email, u.first_name, u.status], ["instructor", "ann@example.com", "Ann", true]);
});

// ---------------------------------------------------------------- rejection and authorization
test("an invalid phone number is rejected with 422 and NOTHING is written, even the other fields in the request", async () => {
	const repo = memoryRepo();
	await fails(saveOwnProfile(repo, actorA, { phone: "12abc", bio: "Should not be saved", subjects: "Nope" }), 422, "invalid_phone");
	await fails(saveOwnProfile(repo, actorA, { phone: "+91 12345" }), 422, "invalid_phone");
	assert.equal(repo.writes.length, 0);
	assert.equal(repo.users.get(A).bio, "Ann bio");
	assert.equal(repo.users.get(A).phone, null);
});

test("invalid links are still rejected (existing behaviour), also without writing the phone", async () => {
	const repo = memoryRepo();
	await fails(saveOwnProfile(repo, actorA, { phone: "+91 98765 43210", website: "http://insecure.example" }), 422, "invalid");
	assert.equal(repo.writes.length, 0);
});

test("an instructor can only change their OWN number: ids supplied in the body are ignored", async () => {
	const repo = memoryRepo();
	const bPhone = repo.users.get(B).phone;
	await saveOwnProfile(repo, actorA, { phone: "+91 98765 43210", userId: B, id: B, user_id: B, instructorId: B });
	assert.equal(repo.users.get(A).phone, "+91 98765 43210");
	assert.equal(repo.users.get(B).phone, bPhone, "B's number is untouched");
	assert.ok(repo.writes.every(([, id]) => id === A), "every write targeted the authenticated user");
});

test("the API route authenticates first, takes the id from the verified actor, and never from the request", () => {
	const api = read("pages/api/instructor/profile.js");
	assert.match(api, /requireRole\(req, res, \["instructor", "admin"\]\)/); // students, parents and anonymous callers get 401/403
	assert.ok(api.indexOf("requireRole") < api.indexOf("saveOwnProfile("));
	assert.match(api, /saveOwnProfile\(profileRepo, actor, req\.body\)/);
	assert.doesNotMatch(api, /req\.query|req\.body\.(userId|id)/);
	assert.match(api, /no-store/);
	const svc = read("lib/instructor/profileService.js");
	assert.match(svc, /repo\.updateUser\(actor\.userId,/);
	assert.match(svc, /repo\.upsertProfile\(actor\.userId,/);
	assert.doesNotMatch(svc, /b\.(userId|id|user_id)\b/);
});

test("an anonymized account cannot be edited", async () => {
	const repo = memoryRepo();
	repo.users.set(A, { ...repo.users.get(A), email: `anonymized-${A}@${ANON_DOMAIN}` });
	await fails(saveOwnProfile(repo, { userId: A, role: "instructor", email: `anonymized-${A}@${ANON_DOMAIN}` }, { phone: "+91 98765 43210" }), 403, "anonymized");
	assert.equal(repo.writes.length, 0);
});

// ---------------------------------------------------------------- admin sees the saved number
test("Admin > Instructors table: the saved number appears in the Phone column and replaces N/A", async () => {
	const repo = memoryRepo();
	const column = async (id) => { const u = repo.users.get(id); return toInstructorRow({ ...u }).phone; };
	assert.equal(await column(A), null, "before saving: empty -> shown as N/A");
	await saveOwnProfile(repo, actorA, { phone: "+91 98765 43210" });
	assert.equal(await column(A), "+91 98765 43210");
	assert.equal(await column(B), "+44 7911 123456", "another instructor's row is unaffected");
});

test("the saved users.phone wins over an older application phone", () => {
	assert.equal(toInstructorRow({ id: A, email: "a@b.c", role: "instructor", phone: "+91 98765 43210" }, null, { phone: "+1 555 0100" }).phone, "+91 98765 43210");
	assert.equal(toInstructorRow({ id: A, email: "a@b.c", role: "instructor", phone: null }, null, { phone: "+1 555 0100" }).phone, "+1 555 0100", "application phone is only the fallback");
});

test("Admin > Instructor details: the saved number appears under Phone", async () => {
	const repo = memoryRepo();
	const detailsRepo = {
		async getInstructor(id) { const u = repo.users.get(id); return u && u.role === "instructor" ? { ...u } : null; },
		async getProfile() { return null; }, async getApplicationPhone() { return null; },
		async listSessions() { return []; }, async listSeats() { return []; }, async listAttendance() { return []; },
		async listCourses() { return []; }, async courseTitles() { return new Map(); }, async enrolmentCounts() { return new Map(); }, async studentUsers() { return new Map(); },
	};
	assert.equal((await loadInstructorDetails(detailsRepo, A)).profile.phone, null);
	await saveOwnProfile(repo, actorA, { phone: "+91 98765 43210" });
	assert.equal((await loadInstructorDetails(detailsRepo, A)).profile.phone, "+91 98765 43210");
	assert.equal((await loadInstructorDetails(detailsRepo, B)).profile.phone, "+44 7911 123456");
});

test("anonymized instructors never show a phone number in Admin (own column cleared, fallbacks suppressed)", () => {
	const row = toInstructorRow({ id: A, email: `anonymized-${A}@${ANON_DOMAIN}`, role: "instructor", phone: null }, { subjects: "x" }, { phone: "+1 555 0100" });
	assert.equal(row.phone, null);
});

test("admin endpoints read the same column and are never cached", () => {
	assert.ok(INSTRUCTOR_LIST_ATTRS.includes("phone"));
	assert.match(read("lib/admin/instructorDetailsRepo.js"), /"phone"/);
	assert.match(read("pages/api/instructor/instructors.js"), /no-store/);
	assert.match(read("pages/api/admin/instructors/[id].js"), /no-store/);
	assert.match(read("lib/instructor/profileRepo.js"), /"phone"/); // GET returns it
});

// ---------------------------------------------------------------- form + no schema change
test("the form has the Phone number field near the top, validates before saving, and keeps Save profile", () => {
	const page = read("pages/instructor/profile.js");
	assert.match(page, /label="Phone number"/);
	assert.ok(page.indexOf('label="Phone number"') < page.indexOf('label="Biography"'));
	assert.ok(page.indexOf('label="Phone number"') > page.indexOf('label="Professional title"'));
	assert.match(page, /type="tel"/);
	assert.match(page, /normalizePhone\(p\.phone\)/);
	assert.match(page, /Save profile/);
	assert.match(page, /invalid_phone/);
});

test("no schema change: no new phone column or migration, and the service writes to the existing users.phone", () => {
	const svc = read("lib/instructor/profileService.js") + read("lib/instructor/profileRepo.js");
	assert.doesNotMatch(svc, /addColumn|createTable|queryInterface|sequelize\.query/i);
	assert.match(read("database/models/user.js"), /phone: Types\.STRING/);
	assert.doesNotMatch(read("database/models/instructor_application.js").slice(read("database/models/instructor_application.js").indexOf("InstructorProfile.init")), /phone/);
});
