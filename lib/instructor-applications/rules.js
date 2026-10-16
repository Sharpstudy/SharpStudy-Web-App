// Shared, dependency-free rules: used by the server (service.js) AND the browser form for inline hints.
// The server is the authority; the browser copy only saves a round trip.

export const EDUCATION_LEVELS = ["high_school", "diploma", "bachelor", "master", "doctorate", "other"];
export const STUDENT_LEVELS = ["elementary", "middle_school", "high_school", "college", "adult", "professional"];
export const TEACHING_MODES = ["online", "offline"];
export const SAMPLE_KINDS = ["video", "document", "lesson_plan"];
export const RUBRIC_KEYS = ["subject_knowledge", "teaching_clarity", "lesson_structure", "communication", "level_appropriateness", "sample_quality", "qualifications_experience"];

// Required-field rules for submission, evaluated on the merged (stored + new) form.
export function validateForSubmit(f) {
	const e = {};
	const need = (k, min, msg) => {
		if (String(f[k] == null ? "" : f[k]).trim().length < min) e[k] = msg;
	};
	need("full_name", 3, "Enter your full name.");
	need("phone", 7, "Enter a phone number.");
	need("country", 2, "Enter your country.");
	if (!EDUCATION_LEVELS.includes(f.education_level)) e.education_level = "Choose your highest education level.";
	need("degree", 2, "Enter your degree or qualification.");
	need("institution", 2, "Enter your institution.");
	if (f.has_teaching_experience !== true && f.has_teaching_experience !== false) e.has_teaching_experience = "Say whether you have formal teaching experience.";
	if (f.has_teaching_experience === true) {
		if (!(f.teaching_years >= 1)) e.teaching_years = "Enter your years of teaching experience.";
		if (!(f.teaching_modes || []).length) e.teaching_modes = "Choose online, offline or both.";
		need("prior_experience", 20, "Describe your previous teaching in a sentence or two.");
	}
	if (!(f.student_levels || []).length) e.student_levels = "Choose at least one student level.";
	if (!(f.subjects || []).length) e.subjects = "Choose at least one subject.";
	need("topics", 10, "List the topics or skills you would teach.");
	need("languages", 2, "Enter the language(s) you teach in.");
	if (!SAMPLE_KINDS.includes(f.sample_kind)) e.sample_kind = "Choose how you will show your teaching.";
	else if (f.sample_kind !== "lesson_plan" && !f.sample_url) e.sample_url = "Add a link to your teaching sample.";
	need("sample_title", 3, "Enter a title for your sample lesson.");
	need("sample_outline", f.sample_kind === "lesson_plan" ? 150 : 50, f.sample_kind === "lesson_plan" ? "A written lesson demonstration needs a detailed outline (at least 150 characters)." : "Outline your sample lesson (at least 50 characters).");
	need("methodology", 50, "Explain your teaching approach (at least 50 characters).");
	need("motivation", 30, "Tell us why you want to teach on SharpStudy.");
	if (f.agreed_policies !== true) e.agreed_policies = "You must agree to the instructor policies.";
	if (f.consented_privacy !== true) e.consented_privacy = "You must consent to the application review and privacy terms.";
	return e;
}

