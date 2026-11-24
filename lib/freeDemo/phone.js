// International phone numbers for the Free Demo form and the server (libphonenumber-js, already vetted: no dependencies, pure JS).
// Stored form: E.164, e.g. "+919876543210" (fits the existing 40 character phone column; older rows keep whatever was typed).
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, validatePhoneNumberLength, AsYouType } from "libphonenumber-js/max";

export const DEFAULT_COUNTRY = "IN";

let cache = null;
// [{ code: "IN", name: "India", dial: "91" }], India first, then A-Z. Names come from the browser/Node (Intl.DisplayNames), falling back to the code.
export function countries() {
	if (cache) return cache;
	let names = null;
	try {
		names = new Intl.DisplayNames(["en"], { type: "region" });
	} catch (e) {}
	const list = getCountries().map((code) => {
		let name = code;
		try {
			name = (names && names.of(code)) || code;
		} catch (e) {}
		return { code, name, dial: getCountryCallingCode(code) };
	});
	list.sort((a, b) => (a.code === DEFAULT_COUNTRY ? -1 : b.code === DEFAULT_COUNTRY ? 1 : a.name.localeCompare(b.name)));
	cache = list;
	return list;
}
export const findCountry = (code) => countries().find((c) => c.code === code) || countries()[0];
export const flagSrc = (code) => `/images/flags/${String(code).toLowerCase()}.svg`;

export const searchCountries = (q) => {
	const s = String(q || "").trim().toLowerCase().replace(/^\+/, "");
	if (!s) return countries();
	return countries().filter((c) => c.name.toLowerCase().includes(s) || c.code.toLowerCase() === s || c.dial.startsWith(s));
};

// Longest number a person can type (digits, including a leading national "0"). libphonenumber's own limit is wide (India allows 13 digits for
// old landline formats); for the common countries we stop typing at what a real parent's number needs. Others use the library's limit.
const TYPING_MAX = { IN: 11, US: 10, CA: 10, GB: 11, AU: 10, AE: 10, SA: 10, SG: 8, MY: 11, NZ: 11, QA: 8, KW: 8, OM: 8, BH: 8, NP: 10, LK: 10, BD: 11, PK: 11 };

// Keep only what a person may type in a national number (digits and common separators) and refuse more digits than the country allows.
export function cleanNational(value, country) {
	let s = String(value || "").replace(/[^\d\s\-()]/g, "");
	for (;;) {
		const digits = s.replace(/\D/g, "");
		if (!digits) return s.trim() ? "" : s;
		if (digits.length <= (TYPING_MAX[country] || 15) && validatePhoneNumberLength(digits, country) !== "TOO_LONG") return s;
		s = s.slice(0, -1);
	}
}

export const formatNational = (value, country) => new AsYouType(country).input(String(value || ""));

// -> { ok: true, e164, international } or { ok: false, message }
export function checkPhone(national, country) {
	const digits = String(national || "").replace(/\D/g, "");
	if (!digits) return { ok: false, message: "Please enter your phone number." };
	const info = findCountry(country);
	const p = parsePhoneNumberFromString(digits, country);
	if (!p || !p.isValid()) {
		const len = validatePhoneNumberLength(digits, country);
		const why = len === "TOO_SHORT" ? "is too short" : len === "TOO_LONG" ? "is too long" : "does not look right";
		return { ok: false, message: `This number ${why} for ${info.name} (+${info.dial}). Please check it.` };
	}
	return { ok: true, e164: p.number, international: p.formatInternational() };
}

// Server side: a number that starts with "+" must be a valid international number and is stored as E.164. A number without "+" is an older
// or other client's format: it keeps the original rule (7+ digits), so nothing that worked before is rejected.
export function normalizeIncomingPhone(raw) {
	const s = String(raw == null ? "" : raw).trim();
	if (!s.startsWith("+")) return { legacy: true, value: s };
	const p = parsePhoneNumberFromString(s);
	return p && p.isValid() ? { legacy: false, value: p.number } : { legacy: false, value: null };
}

// For display on the admin and telecaller screens: "+919876543210" -> "+91 98765 43210"; anything else is shown exactly as stored.
export function formatPhoneDisplay(raw) {
	const s = String(raw == null ? "" : raw).trim();
	if (!/^\+\d{8,15}$/.test(s)) return s;
	try {
		const p = parsePhoneNumberFromString(s);
		return p ? p.formatInternational() : s;
	} catch (e) {
		return s;
	}
}
