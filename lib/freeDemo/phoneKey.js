// Duplicate detection for phone numbers (no libraries, so the repository and the in-memory test repository share it).
// New requests store the international form ("+919876543210"); older ones were stored exactly as typed ("+91 98765 43210", "98765 43210").
// phoneKeys() lists every spelling that means the same number, and stripPhone() is what the database compares them with, so an older Indian
// enquiry and a new one for the same parent are still recognised as the same request. Nothing is rewritten in the database.
export const stripPhone = (p) => String(p == null ? "" : p).replace(/[\s\-().]/g, "");

export function phoneKeys(phone) {
	const s = stripPhone(phone);
	const keys = new Set([s]);
	if (s.startsWith("+")) keys.add(s.slice(1));
	const india = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(s); // an Indian mobile number in any of its usual spellings
	if (india) ["+91" + india[1], "91" + india[1], "0" + india[1], india[1]].forEach((k) => keys.add(k));
	return [...keys].filter(Boolean);
}

// Same number in the in-memory repository (tests).
export const samePhone = (a, b) => {
	const keys = new Set(phoneKeys(b));
	return phoneKeys(a).some((k) => keys.has(k));
};

// Admin / telecaller search: "90000 22222" or "+91 90000-22222" should find "+919000022222" (and the other way round).
// Returns the query without separators when it looks like a phone number (3+ digits, nothing else), otherwise null.
export function phoneSearchTerm(q) {
	const s = String(q == null ? "" : q).trim();
	if (!/^[+\d\s\-().]+$/.test(s)) return null;
	const stripped = stripPhone(s);
	return stripped.replace(/\D/g, "").length >= 3 ? stripped : null;
}
export const phoneMatchesSearch = (phone, q) => {
	const term = phoneSearchTerm(q);
	return !!term && stripPhone(phone).includes(term);
};
