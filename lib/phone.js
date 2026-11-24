// Phone number validation shared by the browser form and the API (pure; no Node imports).
//
// Accepted: an optional single leading "+" (country code), then digits with spaces, dots, dashes or brackets
// as separators. 7 to 15 digits (the E.164 maximum). Indian numbers with +91 must have exactly 10 national
// digits (a mobile starting 6-9, or an area code plus number), so "+91 98765 43210" passes and "+91 12345" does not.
// An empty value is allowed and means "no phone number".
export const PHONE_MAX_LENGTH = 25;
export const PHONE_HINT = "Include the country code, for example +91 98765 43210.";

// -> { ok: true, value: "+91 98765 43210" | null } or { ok: false, error: "..." }
export function normalizePhone(input) {
	if (input === undefined || input === null) return { ok: true, value: null };
	if (typeof input !== "string") return { ok: false, error: "Enter a valid phone number." };
	const value = input.trim().replace(/\s+/g, " ");
	if (value === "") return { ok: true, value: null };
	if (value.length > PHONE_MAX_LENGTH) return { ok: false, error: `Phone number is too long (at most ${PHONE_MAX_LENGTH} characters).` };
	if (!/^\+?[0-9 ()\-.]+$/.test(value)) return { ok: false, error: "Use only digits, spaces, dashes, dots or brackets, with an optional leading +." };
	const digits = value.replace(/\D/g, "");
	if (digits.length < 7) return { ok: false, error: "Phone number is too short." };
	if (digits.length > 15) return { ok: false, error: "Phone number has too many digits." };
	if (value.startsWith("+91") && !/^[1-9]\d{9}$/.test(digits.slice(2))) return { ok: false, error: "Indian (+91) numbers need 10 digits after the country code." };
	return { ok: true, value };
}
