// Server-side validation of book records and uploads. Pure; nothing here trusts the browser.
import { BookError } from "./errors.js";
import { isCategory, isSubject, isAgeGroup, isReadingLevel, ageGroupById, GRADE_MIN, GRADE_MAX, MAX_AGE, LANGUAGE_RE, STATUSES } from "./taxonomy.js";

export const LIMITS = {
	titleMin: 2,
	titleMax: 200,
	authorMax: 160,
	descriptionMax: 5000,
	publisherMax: 160,
	// Prices are INR in paise (minor units). A paid book must clear the card network / Stripe minimum.
	maxPriceCents: 5000000, // ₹50,000.00
	minPaidCents: 5000, // ₹50.00 (use 0 for a free book)
	tagMax: 10,
	tagLen: 30,
	coverBytes: 2 * 1024 * 1024,
	fileBytes: 20 * 1024 * 1024,
};

const bad = (message) => {
	throw new BookError(422, "invalid", message);
};
const has = (o, k) => o[k] !== undefined;
const str = (v, max, label, { required = false } = {}) => {
	const s = String(v == null ? "" : v).trim();
	if (required && !s) bad(`${label} is required`);
	if (s.length > max) bad(`${label} must be at most ${max} characters`);
	return s || null;
};
const int = (v, min, max, label) => {
	if (v === null || v === "" || v === undefined) return null;
	const n = typeof v === "number" ? v : /^-?\d{1,4}$/.test(String(v).trim()) ? Number(v) : NaN;
	if (!Number.isInteger(n) || n < min || n > max) bad(`${label} must be a whole number from ${min} to ${max}`);
	return n;
};

// Rupees as typed ("125", "125.5", "125.50") -> paise (12550). Never floats, never exponent forms, never negative.
export function parsePriceCents(v) {
	if (typeof v === "number") {
		if (!Number.isFinite(v) || v < 0) bad("Enter a valid price with at most two decimals");
		v = String(v);
	}
	const s = String(v == null ? "" : v).trim();
	const m = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(s);
	if (!m) bad("Enter a valid price with at most two decimals");
	const cents = Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0);
	if (cents > LIMITS.maxPriceCents) bad(`The price cannot exceed ₹${LIMITS.maxPriceCents / 100}`);
	if (cents > 0 && cents < LIMITS.minPaidCents) bad(`A paid book must cost at least ₹${LIMITS.minPaidCents / 100}. Use 0 for a free book.`);
	return cents;
}

// Free-form tags -> a clean, de-duplicated list (or null).
export function parseTags(v) {
	if (v === null || v === "" || v === undefined) return null;
	const list = Array.isArray(v) ? v : String(v).split(",");
	const out = [];
	for (const raw of list) {
		const t = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
		if (!t) continue;
		if (t.length < 2 || t.length > LIMITS.tagLen || !/^[a-z0-9][a-z0-9 +#.&-]*$/.test(t)) bad(`Tags must be ${2}-${LIMITS.tagLen} characters of letters, numbers, spaces or + # . & -`);
		if (!out.includes(t)) out.push(t);
	}
	if (out.length > LIMITS.tagMax) bad(`Use at most ${LIMITS.tagMax} tags`);
	return out.length ? out : null;
}

// The primary age group must be consistent with the recommended range (their spans overlap).
export function checkAgeGroupConsistency(ageGroup, min, max) {
	if (!ageGroup || min == null || max == null) return;
	const g = ageGroupById(ageGroup);
	if (!g || !(g.min <= max && g.max >= min)) bad(`The age group "${g ? g.label : ageGroup}" does not match the recommended ages ${min}-${max}`);
}

export const slugify = (s) =>
	String(s || "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Fixed API / page names under /books that a book address must not shadow.
export const RESERVED_SLUGS = ["home", "mine", "orders", "checkout", "webhook", "new"];

// Returns the database patch for a create (partial=false) or an edit (partial=true).
// Fields never accepted from the client: id, file/cover paths, timestamps.
export function validateBookInput(input, { partial = false } = {}) {
	input = input && typeof input === "object" ? input : {};
	const out = {};
	if (!partial || has(input, "title")) {
		const t = str(input.title, LIMITS.titleMax, "Title", { required: true });
		if (t.length < LIMITS.titleMin) bad(`Title must be at least ${LIMITS.titleMin} characters`);
		out.title = t;
	}
	if (!partial || has(input, "author")) out.author = str(input.author, LIMITS.authorMax, "Author", { required: true });
	if (!partial || has(input, "description")) out.description = str(input.description, LIMITS.descriptionMax, "Description");
	if (has(input, "slug") && input.slug !== "") {
		if (!SLUG_RE.test(String(input.slug)) || String(input.slug).length > 80 || RESERVED_SLUGS.includes(String(input.slug))) bad("The web address may use lowercase letters, numbers and dashes only, and cannot be a reserved word");
		out.slug = String(input.slug);
	}
	if (!partial || has(input, "category")) {
		if (!isCategory(input.category)) bad("Choose a category");
		out.category = input.category;
	}
	if (has(input, "subject")) {
		if (input.subject !== null && input.subject !== "" && !isSubject(input.subject)) bad("Choose a subject from the list");
		out.subject = input.subject || null;
	}
	if (!partial || has(input, "language")) {
		const l = String(input.language == null ? "en" : input.language).trim().toLowerCase();
		if (!LANGUAGE_RE.test(l)) bad("Language must be a language code such as en");
		out.language = l;
	}
	if (!partial || has(input, "price")) out.price_cents = parsePriceCents(input.price);
	if (has(input, "publisher")) out.publisher = str(input.publisher, LIMITS.publisherMax, "Publisher");
	if (has(input, "publishedYear")) out.published_year = int(input.publishedYear, 1400, new Date().getUTCFullYear() + 1, "Publication year");
	if (has(input, "isbn")) {
		const raw = str(input.isbn, 20, "ISBN");
		const digits = raw ? raw.replace(/[-\s]/g, "") : null;
		if (digits && !/^(\d{9}[\dXx]|\d{13})$/.test(digits)) bad("ISBN must have 10 or 13 digits");
		out.isbn = digits ? digits.toUpperCase() : null;
	}
	if (has(input, "externalUrl")) {
		const u = str(input.externalUrl, 500, "Reading link");
		if (u) {
			let parsed;
			try {
				parsed = new URL(u);
			} catch (e) {
				bad("The reading link must be a valid https address");
			}
			if (parsed.protocol !== "https:") bad("The reading link must start with https://");
		}
		out.external_url = u;
	}
	if (has(input, "coverUrl")) {
		const u = str(input.coverUrl, 500, "Cover image link");
		if (u && !/^https:\/\//i.test(u)) bad("The cover image link must start with https://");
		out.cover_url = u;
	}
	if (has(input, "status")) {
		if (!STATUSES.includes(input.status)) bad("Unknown status");
		out.status = input.status;
	}
	if (has(input, "tags")) out.tags = parseTags(input.tags);
	if (has(input, "featured")) out.featured = input.featured === true || input.featured === "true";

	// ---- discovery metadata ----
	if (has(input, "ageGroup")) {
		if (input.ageGroup !== null && input.ageGroup !== "" && !isAgeGroup(input.ageGroup)) bad("Choose an age group from the list");
		out.age_group = input.ageGroup || null;
	}
	// On create a blank field means "not provided" (so an age group can supply the defaults); on edit a blank clears it.
	const given = (k) => has(input, k) && (partial || (input[k] !== "" && input[k] !== null));
	const openEnded = input.openEnded === true || input.openEnded === "true";
	const minGiven = given("minAge");
	const maxGiven = given("maxAge") || openEnded;
	if (minGiven) out.min_age = int(input.minAge, 0, MAX_AGE, "Minimum age");
	// "18+": no upper limit is stored as the maximum representable age.
	if (maxGiven) out.max_age = openEnded ? MAX_AGE : int(input.maxAge, 0, MAX_AGE, "Maximum age");
	// An age group alone gives sensible default bounds; explicit ages may widen or narrow them (books can span groups).
	if (out.age_group && !minGiven && !maxGiven && !partial) {
		const g = ageGroupById(out.age_group);
		out.min_age = g.min;
		out.max_age = g.max;
	}
	if (minGiven !== maxGiven && partial) bad("Change the minimum and maximum age together");
	if ((out.min_age == null) !== (out.max_age == null) && (minGiven || maxGiven || out.age_group)) bad("Give both a minimum and a maximum age, or neither");
	if (out.min_age != null && out.max_age != null && out.min_age > out.max_age) bad("The minimum age cannot be above the maximum age");
	checkAgeGroupConsistency(out.age_group, out.min_age, out.max_age);
	const gMin = has(input, "gradeMin");
	const gMax = has(input, "gradeMax");
	if (gMin !== gMax) bad("Change the lowest and highest grade together");
	if (gMin) {
		out.grade_min = int(input.gradeMin, GRADE_MIN, GRADE_MAX, "Lowest grade");
		out.grade_max = int(input.gradeMax, GRADE_MIN, GRADE_MAX, "Highest grade");
		if ((out.grade_min == null) !== (out.grade_max == null)) bad("Give both a lowest and a highest grade, or neither");
		if (out.grade_min != null && out.grade_min > out.grade_max) bad("The lowest grade cannot be above the highest grade");
	}
	if (has(input, "readingLevel")) {
		if (input.readingLevel !== null && input.readingLevel !== "" && !isReadingLevel(input.readingLevel)) bad("Choose a reading level from the list");
		out.reading_level = input.readingLevel || null;
	}
	return out;
}

// ---- uploads --------------------------------------------------------------------------------

const startsWith = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);

// Content is sniffed from the bytes; the file name and the declared MIME type are never trusted.
// `size` is the full object size when `buf` is only its first bytes (direct-to-storage uploads).
export function sniffUpload(kind, buf, size = buf && buf.length) {
	if (!Buffer.isBuffer(buf) || buf.length === 0 || !size) bad("The file is empty");
	if (kind === "cover") {
		if (size > LIMITS.coverBytes) bad(`Cover images can be at most ${LIMITS.coverBytes / 1024 / 1024} MB`);
		if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
		if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
		if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", ext: "webp" };
		bad("Covers must be PNG, JPEG or WebP images");
	}
	if (kind === "file" || kind === "preview") {
		if (size > LIMITS.fileBytes) bad(`Book files can be at most ${LIMITS.fileBytes / 1024 / 1024} MB`);
		if (buf.subarray(0, 1024).indexOf("%PDF-") === -1) bad("Only PDF books are supported");
		return { mime: "application/pdf", ext: "pdf" };
	}
	return bad("Unknown upload type");
}

export const UPLOAD_KINDS = ["cover", "file", "preview"];

export function decodeBase64(data, maxBytes) {
	if (typeof data !== "string" || !data) bad("No file was sent");
	const s = data.replace(/^data:[^;]+;base64,/, "");
	// Reject before decoding: base64 is ~4/3 of the byte size.
	if (s.length > Math.ceil((maxBytes * 4) / 3) + 8) bad("The file is too large");
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) bad("The file could not be read");
	return Buffer.from(s, "base64");
}
