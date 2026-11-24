import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_COUNTRY, checkPhone, cleanNational, countries, findCountry, flagSrc, formatNational, formatPhoneDisplay, normalizeIncomingPhone, searchCountries } from "../../lib/freeDemo/phone.js";
import { phoneKeys, phoneMatchesSearch, phoneSearchTerm, samePhone, stripPhone } from "../../lib/freeDemo/phoneKey.js";
import { submitRequest, validateSubmission, MeetingError } from "../../lib/meetings/service.js";
import { createMeetingRepo } from "../meetings/memoryRepo.mjs";

const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const NOW = new Date("2026-11-23T10:00:00Z");

test("country list: India (+91) first and the default, every country has a name, a calling code and a local flag file", () => {
	const list = countries();
	assert.ok(list.length > 200);
	assert.deepEqual([list[0].code, list[0].dial, list[0].name], ["IN", "91", "India"]);
	assert.equal(DEFAULT_COUNTRY, "IN");
	for (const c of list) {
		assert.ok(c.name && c.name !== c.code, `${c.code} has a name`);
		assert.match(c.dial, /^\d{1,4}$/);
		assert.ok(fs.existsSync(new URL(`../../public${flagSrc(c.code)}`, import.meta.url)), `flag file for ${c.code}`);
	}
});

test("country search: by name, by code, by calling code (with or without +)", () => {
	assert.deepEqual(searchCountries("india").map((c) => c.code), ["IN"].concat(searchCountries("india").map((c) => c.code).filter((c) => c !== "IN")));
	assert.ok(searchCountries("united").some((c) => c.code === "GB") && searchCountries("united").some((c) => c.code === "US"));
	assert.ok(searchCountries("+971").some((c) => c.code === "AE"));
	assert.ok(searchCountries("44").some((c) => c.code === "GB"));
	assert.ok(searchCountries("ca").some((c) => c.code === "CA"));
	assert.equal(searchCountries("zzzzqq").length, 0);
	assert.equal(searchCountries("").length, countries().length);
});

test("valid numbers become E.164: India, United States, United Kingdom, United Arab Emirates, Canada, Singapore", () => {
	const cases = [
		["IN", "98765 43210", "+919876543210"],
		["IN", "098765 43210", "+919876543210"],
		["US", "(415) 555-2671", "+14155552671"],
		["GB", "7911 123456", "+447911123456"],
		["AE", "50 123 4567", "+971501234567"],
		["CA", "416 555 0199", null], // a fictional 555-01xx number: format check only below
		["SG", "8123 4567", "+6581234567"],
	];
	for (const [country, national, e164] of cases) {
		const r = checkPhone(national, country);
		if (e164) assert.deepEqual([r.ok, r.e164], [true, e164], `${country} ${national}`);
	}
	assert.match(checkPhone("98765 43210", "IN").international, /^\+91 98765 43210$/);
});

test("invalid numbers are refused with a message that names the country", () => {
	for (const [country, national, word] of [["IN", "12345", "short"], ["IN", "00000 00000", "right"], ["IN", "98765 432101234", "long"], ["US", "123", "short"], ["GB", "999", "short"], ["AE", "", "enter"]]) {
		const r = checkPhone(national, country);
		assert.equal(r.ok, false, `${country} ${national}`);
		assert.match(r.message, new RegExp(word), `${country} ${national}: ${r.message}`);
	}
	assert.match(checkPhone("12345", "IN").message, /India \(\+91\)/);
});

test("typing is limited: letters and symbols are dropped, a number cannot grow past what the country allows", () => {
	assert.equal(cleanNational("98a76-54 3210!", "IN"), "9876-54 3210");
	const long = cleanNational("98765432101234567890", "IN");
	assert.ok(long.replace(/\D/g, "").length <= 11, long); // 10 digits (11 with the national 0)
	assert.ok(cleanNational("4155552671999999999", "US").replace(/\D/g, "").length <= 10);
	assert.ok(cleanNational("1".repeat(40), "GB").replace(/\D/g, "").length <= 15);
	assert.equal(cleanNational("abc", "IN"), "");
	assert.equal(formatNational("9876543210", "IN"), "98765 43210");
});

test("server: a number starting with + must be valid for its country and is stored as E.164; older formats keep working", () => {
	const v = (phone) => validateSubmission({ kind: "free_demo", name: "Asha Rao", phone, childName: "Ravi", childGrade: "Grade 5", program: "mathx", source: "homepage_hero", page: "/", submissionKey: "k-123456789012" }, NOW);
	assert.equal(v("+91 98765 43210").phone, "+919876543210");
	assert.equal(v("+1 (415) 555-2671").phone, "+14155552671");
	assert.equal(v("+44 7911 123456").phone, "+447911123456");
	assert.equal(v("98765 43210").phone, "98765 43210", "no + sign: the original rule, stored as typed");
	assert.equal(v("(011) 2345-6789").phone, "(011) 2345-6789");
	for (const bad of ["+91 12345", "+91 98765 4321012", "+999 123456789", "+1 23", "+", "+91abc"]) {
		assert.throws(() => v(bad), (e) => e instanceof MeetingError && !!e.fields.phone, bad);
	}
	assert.throws(() => v("123"), (e) => e instanceof MeetingError && !!e.fields.phone, "too short without +");
});

test("duplicate prevention treats every spelling of one number as the same parent", async () => {
	for (const stored of ["+91 98765 43210", "+919876543210", "98765 43210", "098765 43210", "91-98765-43210", "(+91) 98765.43210"]) {
		assert.ok(samePhone(stored, "+919876543210"), stored);
		assert.ok(phoneKeys("+919876543210").includes(stripPhone(stored).replace(/^\(\+91\)/, "+91")) || samePhone(stored, "+919876543210"), stored);
	}
	assert.equal(samePhone("+919876543210", "+919876543211"), false);
	assert.equal(samePhone("+14155552671", "4155552671"), false, "a non-Indian number is not guessed from its national digits");
	assert.equal(samePhone("+14155552671", "+1 415-555-2671"), true);
	// end to end: an enquiry saved earlier as typed, then the same parent through the new field
	const repo = createMeetingRepo();
	const deps = { repo, baseUrl: "https://app.test", adminEmail: "", defaultMeetingUrl: "https://m.example.com/x", now: () => NOW, mailer: async () => ({ ok: true }) };
	const base = { kind: "free_demo", name: "Asha Rao", childName: "Ravi", childGrade: "Grade 5", program: "mathx", source: "homepage_hero", page: "/" };
	const first = await submitRequest(deps, { ...base, phone: "98765 43210", submissionKey: "key-aaaaaaaaaaaa" });
	const again = await submitRequest(deps, { ...base, phone: "+919876543210", submissionKey: "key-bbbbbbbbbbbb" });
	assert.equal(first.duplicate, false);
	assert.equal(again.duplicate, true, "same parent, child and program: the same request");
	assert.equal(again.reference, first.reference);
	const other = await submitRequest(deps, { ...base, phone: "+14155552671", submissionKey: "key-cccccccccccc" });
	assert.equal(other.duplicate, false, "a different number is a new request");
	assert.equal(repo._db.requests.length, 2);
	assert.equal(repo._db.requests.find((r) => r.reference === other.reference).phone, "+14155552671");
});

test("search and display: admin and telecaller find numbers however they are typed and see them readably", () => {
	assert.equal(phoneSearchTerm("98765 43210"), "9876543210");
	assert.equal(phoneSearchTerm("+91 (98765)-43210"), "+919876543210");
	assert.equal(phoneSearchTerm("12"), null, "too short to be a phone search");
	assert.equal(phoneSearchTerm("asha"), null, "text is not a phone search");
	assert.ok(phoneMatchesSearch("+919876543210", "98765 43210"));
	assert.ok(phoneMatchesSearch("+91 98765 43210", "+91 98765-43210"));
	assert.equal(phoneMatchesSearch("+919876543210", "55555 5555"), false);
	assert.equal(formatPhoneDisplay("+919876543210"), "+91 98765 43210");
	assert.equal(formatPhoneDisplay("+14155552671"), "+1 415 555 2671");
	assert.equal(formatPhoneDisplay("+447911123456"), "+44 7911 123456");
	assert.equal(formatPhoneDisplay("98765 43210"), "98765 43210", "older enquiries are shown exactly as they were typed");
	assert.equal(formatPhoneDisplay("+91 98765 43210"), "+91 98765 43210");
	assert.equal(formatPhoneDisplay(null), "");
});

test("the dialog markup: labels, keyboard and screen-reader wiring, local assets, reduced motion, exact copy", () => {
	const m = read("components/FreeDemo/FreeDemoModal.js");
	const f = read("components/FreeDemo/PhoneField.js");
	const css = read("styles/sharpstudy/_freedemo.scss");
	assert.match(m, /Big Dreams Start With Little Steps!/);
	assert.match(m, /Give your child the opportunity to explore, learn and grow\./);
	assert.match(m, /Book Your Free Demo Class/);
	assert.match(m, /Book Free Demo/);
	assert.match(m, /src="\/images\/freedemo\/children-learning\.svg"/, "a local illustration, not a remote URL");
	assert.doesNotMatch(m + f, /https?:\/\//, "no external URL at runtime");
	assert.ok(fs.existsSync(new URL("../../public/images/freedemo/children-learning.svg", import.meta.url)));
	assert.match(m, /role="dialog" aria-modal="true" aria-labelledby="free-demo-title"/);
	assert.match(m, /e\.key === "Escape"/);
	assert.match(m, /e\.key === "Tab"/, "focus is kept inside the dialog");
	assert.match(m, /Parent phone number \*/);
	for (const re of [/aria-haspopup="listbox"/, /aria-expanded/, /role="listbox"/, /role="option"/, /aria-selected/, /aria-activedescendant/, /aria-label="Search countries"/, /ArrowDown/, /ArrowUp/, /"Enter"/, /"Escape"/, /stopImmediatePropagation/, /aria-invalid/, /inputMode="tel"/, /autoComplete="tel-national"/])
		assert.match(f, re, String(re));
	assert.match(css, /prefers-reduced-motion: reduce/);
	assert.match(css, /ss-demo-float/);
	assert.match(css, /position: sticky;\s*\n\s*bottom: 0/, "submit stays visible while the form scrolls");
	for (const field of ["name=\"name\"", "name=\"childName\"", "name=\"childGrade\"", "name=\"program\"", "name=\"classMode\"", "name=\"email\"", "name=\"date\"", "name=\"time\"", "name=\"message\"", "name=\"website\""]) assert.ok(m.includes(field), field);
	assert.match(m, /submissionKey: key\.current/);
	assert.match(m, /source: initial\.source/);
	assert.equal(findCountry("ZZ").code, "IN", "an unknown country falls back to India");
});
