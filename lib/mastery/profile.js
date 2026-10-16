// Learner profile fields beyond the name: school grade, age / date of birth and an optional
// parent or guardian contact. Pure helpers shared by the service and the UI.
//
// Privacy: the date of birth and the contact are only ever returned to adults who can manage the
// learner (see service.adultProfile). Learner sessions and the picker only get grade and AGE.

export const GRADES = [
	{ code: "LKG", label: "LKG" },
	{ code: "UKG", label: "UKG" },
	...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ code: `C${n}`, label: `Class ${n}` })),
];
export const GRADE_CODES = GRADES.map((g) => g.code);
export const gradeLabel = (code) => (GRADES.find((g) => g.code === code) || {}).label || null;
export const gradeIndex = (code) => GRADE_CODES.indexOf(code);

export const AGE_MIN = 2;
export const AGE_MAX = 25;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const parts = (s) => {
	const m = YMD.exec(String(s || ""));
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const probe = new Date(Date.UTC(y, mo - 1, d));
	if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
	return { y, mo, d };
};

// Age in whole years. The date of birth wins whenever it exists, so age and date can never disagree;
// otherwise the birth year gives an approximate age.
export function ageOf(learner, now = Date.now()) {
	if (!learner) return null;
	const at = new Date(now);
	const dob = learner.birth_date ? parts(typeof learner.birth_date === "string" ? learner.birth_date.slice(0, 10) : new Date(learner.birth_date).toISOString().slice(0, 10)) : null;
	if (dob) {
		let age = at.getUTCFullYear() - dob.y;
		if (at.getUTCMonth() + 1 < dob.mo || (at.getUTCMonth() + 1 === dob.mo && at.getUTCDate() < dob.d)) age--;
		return Math.max(0, age);
	}
	if (learner.birth_year) return Math.max(0, at.getUTCFullYear() - learner.birth_year);
	return null;
}

const blank = (v) => v === undefined || v === null || String(v).trim() === "";

// Returns the columns to write (only for fields present in `input`); throws { message } on bad input.
// input: grade, birthDate (YYYY-MM-DD) or age, contactName, contactPhone, contactEmail.
export function validateProfile(input, now = Date.now(), { bad }) {
	const out = {};
	if (input.grade !== undefined) {
		if (blank(input.grade)) out.grade = null;
		else if (GRADE_CODES.includes(String(input.grade))) out.grade = String(input.grade);
		else bad("Choose a grade from LKG, UKG or Class 1 to Class 7");
	}
	const at = new Date(now);
	if (!blank(input.birthDate)) {
		const p = parts(input.birthDate);
		if (!p) bad("Date of birth must be a real date (YYYY-MM-DD)");
		const dob = Date.UTC(p.y, p.mo - 1, p.d);
		if (dob > now) bad("Date of birth cannot be in the future");
		const age = ageOf({ birth_date: String(input.birthDate) }, now);
		if (age < AGE_MIN || age > AGE_MAX) bad(`Age must be between ${AGE_MIN} and ${AGE_MAX}`);
		out.birth_date = String(input.birthDate);
		out.birth_year = p.y;
	} else if (!blank(input.age)) {
		const age = Number(input.age);
		if (!Number.isInteger(age) || age < AGE_MIN || age > AGE_MAX) bad(`Age must be a whole number from ${AGE_MIN} to ${AGE_MAX}`);
		// an age without a date of birth: keep the birth year only, so the two can never contradict
		out.birth_year = at.getUTCFullYear() - age;
		out.birth_date = null;
	} else if (input.birthDate !== undefined || input.age !== undefined) {
		out.birth_date = null; // explicitly cleared
	}
	if (input.contactName !== undefined) {
		const v = String(input.contactName || "").trim();
		if (v.length > 80) bad("Contact name must be at most 80 characters");
		out.contact_name = v || null;
	}
	if (input.contactPhone !== undefined) {
		const v = String(input.contactPhone || "").trim();
		if (v && !/^[0-9+()\-\s.]{5,32}$/.test(v)) bad("Contact phone can contain digits, spaces, + ( ) - . only (5-32 characters)");
		out.contact_phone = v || null;
	}
	if (input.contactEmail !== undefined) {
		const v = String(input.contactEmail || "").trim();
		if (v && (v.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v))) bad("Contact e-mail is not a valid address");
		out.contact_email = v || null;
	}
	return out;
}

// Suggests where on the ladder to start for a grade: the grade's position among the nine grades
// (LKG ... Class 7) mapped onto the number of ready worksheets sets. This is a starting suggestion
// only, not an official curriculum mapping; the instructor can pick any worksheet.
export function recommendedIndex(code, count) {
	const i = gradeIndex(code);
	if (i < 0 || count <= 0) return -1;
	return Math.min(count - 1, Math.floor(((i + 0.5) / GRADES.length) * count));
}
