// Pure: the password rules for NEW passwords (sign-up and password reset). Existing passwords are never re-checked at sign-in,
// so nobody is locked out by a stricter rule. bcrypt only uses the first 72 BYTES, so longer passwords are refused rather than
// silently truncated.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;

const COMMON = new Set(["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop", "iloveyou1", "welcome123", "letmein123", "admin1234", "sharpstudy", "sharpstudy1", "sharpstudy123"]);

// -> null when acceptable, otherwise a message for the person.
export function passwordProblem(password, { email = "" } = {}) {
	if (typeof password !== "string" || !password) return "Enter a password.";
	if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters long.`;
	if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) return `Password must be at most ${PASSWORD_MAX_BYTES} bytes long.`;
	if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Password must contain at least one letter and one number.";
	if (COMMON.has(password.toLowerCase())) return "That password is too common. Choose a different one.";
	if (email && password.toLowerCase() === String(email).toLowerCase()) return "Password must not be your email address.";
	const local = String(email || "").split("@")[0].toLowerCase();
	if (local.length >= 4 && password.toLowerCase().includes(local)) return "Password must not contain your email name.";
	return null;
}
