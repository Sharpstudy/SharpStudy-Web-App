// Telecaller application rules shared by the browser form and the server (the server is the one that decides).
export const QUALIFICATIONS = ["high_school", "diploma", "bachelor", "master", "doctorate", "other"];
export const EMPLOYMENT = ["full_time", "part_time"];

export const RESUME = {
	maxBytes: 2 * 1024 * 1024, // 2 MB
	maxPerAttempt: 5, // versions kept per attempt (a corrected file is a new version; older ones are never replaced)
	extensions: ["pdf", "doc", "docx"],
};

const digits = (s) => String(s == null ? "" : s).replace(/\D/g, "");
export const validPhone = (s) => /^\+?[0-9 ()\-.]{7,25}$/.test(String(s || "")) && digits(s).length >= 7 && digits(s).length <= 15;

// Required-field rules for submission, evaluated on the merged (stored + new) form.
// `resumeCount` is the number of resume versions already stored for the CURRENT attempt.
export function validateForSubmit(f, { resumeCount = 0 } = {}) {
	const e = {};
	const need = (k, min, msg) => {
		if (String(f[k] == null ? "" : f[k]).trim().length < min) e[k] = msg;
	};
	need("full_name", 3, "Enter your full name.");
	if (!validPhone(f.phone)) e.phone = "Enter a valid phone number (7 to 15 digits).";
	need("city", 2, "Enter your city.");
	need("state", 2, "Enter your state.");
	if (!QUALIFICATIONS.includes(f.qualification)) e.qualification = "Choose your highest qualification.";
	if (f.has_telecalling_experience !== true && f.has_telecalling_experience !== false) e.has_telecalling_experience = "Say whether you have telecalling experience.";
	if (f.has_telecalling_experience === true && !(Number.isInteger(f.experience_years) && f.experience_years >= 0)) e.experience_years = "Enter your years of telecalling experience.";
	need("languages", 2, "Enter the languages you know.");
	if (!EMPLOYMENT.includes(f.employment_preference)) e.employment_preference = "Choose full-time or part-time.";
	if (f.confirmed_adult !== true) e.confirmed_adult = "You must confirm that you are at least 18 years old.";
	if (f.consented_privacy !== true) e.consented_privacy = "You must consent to the review of your application and resume.";
	if (!(resumeCount >= 1)) e.resume = "Upload your resume (PDF, DOC or DOCX, up to 2 MB).";
	return e;
}
