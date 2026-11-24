// Shared by the API and the forms (pure; no Node imports).
export const REASONS = [
	{ code: "registered_incorrectly", label: "Student registered incorrectly" },
	{ code: "duplicate_profile", label: "Duplicate learner profile" },
	{ code: "no_longer_belongs", label: "Student no longer belongs to this instructor" },
	{ code: "incorrect_assignment", label: "Incorrect student assignment" },
	{ code: "other", label: "Other" },
];
export const REASON_CODES = REASONS.map((r) => r.code);
export const reasonLabel = (code) => (REASONS.find((r) => r.code === code) || { label: String(code || "") }).label;
export const COMMENT_MAX = 1000;
export const NOTE_MAX = 1000;
export const MIN_TEXT = 3; // "Other" needs a real explanation; a rejection needs a real explanation
export const STATUSES = ["pending", "approved", "rejected"];
export const STATUS_LABEL = { pending: "Pending approval", approved: "Approved", rejected: "Rejected" };
export const STATUS_TONE = { pending: "warning", approved: "success", rejected: "danger" };
