// Catalogue queries, age/grade matching and recommendations. Pure functions over plain book rows,
// so the HTTP layer, the pages and the tests all share one definition of "which books match".
//
// Age and grade are RANGES on a book (min_age..max_age, grade_min..grade_max); a book can span several
// age groups. Matching means "the ranges overlap", never "equals". Books with no age range are suitable
// for all ages, and are not hidden by an age filter. Age and grade are only two of the recommendation signals.
import { BookError } from "./errors.js";
import {
	CATEGORIES,
	SUBJECTS,
	SORTS,
	GRADE_MIN,
	GRADE_MAX,
	LANGUAGE_RE,
	READING_LEVELS,
	isCategory,
	isSubject,
	isAgeGroup,
	isReadingLevel,
	ageGroupById,
	categoryLabel,
	subjectLabel,
	ageRangeLabel,
	gradeRangeLabel,
	readingLevelLabel,
	languageName,
	MAX_AGE,
	matchingAgeGroups,
} from "./taxonomy.js";

export const PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 48;
export const MAX_QUERY_LENGTH = 80;

const bad = (message) => {
	throw new BookError(400, "bad_query", message);
};
const one = (v) => (Array.isArray(v) ? v[0] : v);
const blank = (v) => v === undefined || v === null || v === "";

// Validates the browser's query string into a filter. Unknown values are rejected, not ignored,
// so a typo or a manipulated parameter never silently widens a result set.
export function parseCatalogQuery(query = {}) {
	const q = {};
	const text = one(query.q);
	if (!blank(text)) {
		const s = String(text).trim().replace(/\s+/g, " ");
		if (s.length > MAX_QUERY_LENGTH) bad(`Search text can be at most ${MAX_QUERY_LENGTH} characters`);
		q.q = s;
	}
	const category = one(query.category);
	if (!blank(category)) {
		if (!isCategory(category)) bad("Unknown category");
		q.category = category;
	}
	const subject = one(query.subject);
	if (!blank(subject)) {
		if (!isSubject(subject)) bad("Unknown subject");
		q.subject = subject;
	}
	const ageGroup = one(query.ageGroup);
	if (!blank(ageGroup)) {
		if (!isAgeGroup(ageGroup)) bad("Unknown age group");
		q.ageGroup = ageGroup;
	}
	const age = one(query.age);
	if (!blank(age)) {
		const n = /^\d{1,3}$/.test(String(age)) ? Number(age) : NaN;
		if (!Number.isInteger(n) || n > MAX_AGE) bad("Age must be a whole number from 0 to 120");
		q.age = n;
	}
	const grade = one(query.grade);
	if (!blank(grade)) {
		const n = /^-?\d{1,2}$/.test(String(grade)) ? Number(grade) : NaN;
		if (!Number.isInteger(n) || n < GRADE_MIN || n > GRADE_MAX) bad("Unknown grade");
		q.grade = n;
	}
	const level = one(query.level);
	if (!blank(level)) {
		if (!isReadingLevel(level)) bad("Unknown reading level");
		q.level = level;
	}
	const language = one(query.language);
	if (!blank(language)) {
		if (!LANGUAGE_RE.test(String(language))) bad("Unknown language");
		q.language = String(language);
	}
	const price = one(query.price);
	if (!blank(price)) {
		if (price !== "free" && price !== "paid") bad("Price must be free or paid");
		q.price = price;
	}
	const sort = one(query.sort);
	q.sort = blank(sort) ? (q.q ? "relevance" : "newest") : sort;
	if (!SORTS.includes(q.sort)) bad("Unknown sort order");
	const page = one(query.page);
	q.page = blank(page) ? 1 : /^\d{1,5}$/.test(String(page)) && Number(page) >= 1 ? Number(page) : bad("Page must be a positive whole number");
	const size = one(query.pageSize);
	q.pageSize = blank(size) ? PAGE_SIZE : /^\d{1,3}$/.test(String(size)) && Number(size) >= 1 && Number(size) <= MAX_PAGE_SIZE ? Number(size) : bad(`Page size must be 1-${MAX_PAGE_SIZE}`);
	return q;
}

// ---- ranges ---------------------------------------------------------------------------------

const overlaps = (aMin, aMax, bMin, bMax) => aMin <= bMax && aMax >= bMin;
const hasAges = (b) => b.min_age != null && b.max_age != null;
const hasGrades = (b) => b.grade_min != null && b.grade_max != null;

// The age window a filter asks for: an exact age, or the whole span of an age group.
export function ageWindow(f) {
	if (f.age != null) return [f.age, f.age];
	if (f.ageGroup) {
		const g = ageGroupById(f.ageGroup);
		return [g.min, g.max];
	}
	return null;
}

export function matchesAge(book, window) {
	if (!window) return true;
	if (!hasAges(book)) return true; // no stated range: suitable for all ages
	return overlaps(book.min_age, book.max_age, window[0], window[1]);
}
export function matchesGrade(book, grade) {
	if (grade == null) return true;
	if (!hasGrades(book)) return false; // a grade filter is an explicit request: unlabeled books do not claim a grade
	return book.grade_min <= grade && book.grade_max >= grade;
}

// ---- search ---------------------------------------------------------------------------------

const norm = (s) => String(s || "").toLowerCase();
const fields = (b) => ({
	title: norm(b.title),
	author: norm(b.author),
	subject: norm(`${subjectLabel(b.subject) || ""} ${b.subject || ""}`),
	category: norm(`${categoryLabel(b.category) || ""} ${b.category || ""}`),
	tags: norm((Array.isArray(b.tags) ? b.tags : []).join(" ")),
});

// Every word must appear in the title, author, subject or category. Returns 0 for no match, else a score.
export function searchScore(book, q) {
	if (!q) return 1;
	const f = fields(book);
	let score = 0;
	for (const token of norm(q).split(" ").filter(Boolean)) {
		let s = 0;
		if (f.title.includes(token)) s += f.title.startsWith(token) ? 6 : 4;
		if (f.author.includes(token)) s += 3;
		if (f.subject.includes(token)) s += 2;
		if (f.category.includes(token)) s += 2;
		if (f.tags.includes(token)) s += 2;
		if (!s) return 0;
		score += s;
	}
	return score;
}

// ---- filter / sort / paginate ----------------------------------------------------------------

export function applyFilter(books, f, ctx = {}) {
	const window = ageWindow(f);
	const popular = ctx.popular || new Map();
	const rows = [];
	for (const b of books) {
		if (f.category && b.category !== f.category) continue;
		if (f.subject && b.subject !== f.subject) continue;
		if (f.language && b.language !== f.language) continue;
		if (f.level && b.reading_level !== f.level) continue;
		if (f.price === "free" && b.price_cents !== 0) continue;
		if (f.price === "paid" && b.price_cents === 0) continue;
		if (!matchesAge(b, window)) continue;
		if (!matchesGrade(b, f.grade)) continue;
		const score = searchScore(b, f.q);
		if (!score) continue;
		rows.push({ b, score });
	}
	const time = (b) => new Date(b.published_at || b.created_at || 0).getTime();
	const sorters = {
		relevance: (x, y) => y.score - x.score || time(y.b) - time(x.b),
		newest: (x, y) => time(y.b) - time(x.b),
		popular: (x, y) => (popular.get(y.b.id) || 0) - (popular.get(x.b.id) || 0) || time(y.b) - time(x.b),
		price_asc: (x, y) => x.b.price_cents - y.b.price_cents || x.b.title.localeCompare(y.b.title),
		price_desc: (x, y) => y.b.price_cents - x.b.price_cents || x.b.title.localeCompare(y.b.title),
		title: (x, y) => x.b.title.localeCompare(y.b.title),
	};
	rows.sort((x, y) => (sorters[f.sort] || sorters.newest)(x, y) || String(x.b.id).localeCompare(String(y.b.id)));
	return rows.map((r) => r.b);
}

export function paginate(items, page, pageSize) {
	const total = items.length;
	const pages = Math.max(1, Math.ceil(total / pageSize));
	const current = Math.min(Math.max(1, page), pages); // out-of-range pages clamp instead of erroring
	return { items: items.slice((current - 1) * pageSize, current * pageSize), total, page: current, pages, pageSize };
}

// ---- recommendations --------------------------------------------------------------------------

const span = (min, max) => Math.max(1, max - min + 1);
const overlapSize = (aMin, aMax, bMin, bMax) => Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin) + 1);

// Scores one book against what we know about the reader or the book being viewed. Age and grade are
// strong signals, but subject, category, reading level and popularity also count, so a book can be
// recommended outside the exact age band when it is otherwise a good fit.
export function fitScore(book, want, ctx = {}) {
	let s = 0;
	if (want.window && hasAges(book)) {
		const o = overlapSize(book.min_age, book.max_age, want.window[0], want.window[1]);
		if (o) s += 10 * (o / Math.min(span(book.min_age, book.max_age), span(want.window[0], want.window[1])));
		else s -= 3;
	} else if (want.window) s += 2; // all-ages book
	if (want.grade != null && hasGrades(book)) s += book.grade_min <= want.grade && book.grade_max >= want.grade ? 6 : 0;
	if (want.subject && book.subject === want.subject) s += 5;
	if (want.category && book.category === want.category) s += 3;
	if (want.level && book.reading_level === want.level) s += 2;
	if (want.language && book.language === want.language) s += 1;
	if (book.featured) s += 1;
	s += Math.min(3, Math.log2(1 + ((ctx.popular && ctx.popular.get(book.id)) || 0)));
	return s;
}

export function recommend(books, want, { limit = 8, exclude = [], popular } = {}) {
	const skip = new Set(exclude);
	return books
		.filter((b) => !skip.has(b.id))
		.map((b) => ({ b, s: fitScore(b, want, { popular }) }))
		.filter((r) => r.s > 0)
		.sort((x, y) => y.s - x.s || x.b.title.localeCompare(y.b.title))
		.slice(0, limit)
		.map((r) => r.b);
}

// Titles related to the book being viewed: its own age span, grade span, subject and category.
export function relatedTo(book, books, { limit = 6, popular } = {}) {
	const want = {
		window: hasAges(book) ? [book.min_age, book.max_age] : null,
		grade: hasGrades(book) ? Math.round((book.grade_min + book.grade_max) / 2) : null,
		subject: book.subject,
		category: book.category,
		level: book.reading_level,
		language: book.language,
	};
	return recommend(books, want, { limit, exclude: [book.id], popular }).filter((b) => b.subject === book.subject || b.category === book.category || (hasAges(book) && hasAges(b) && overlaps(book.min_age, book.max_age, b.min_age, b.max_age)));
}

// ---- public shape -----------------------------------------------------------------------------

// What the browser may see about a book. Storage keys (file_path, preview_path, cover_path) and the
// reading link never leave the server in this shape.
export function publicBook(b) {
	return {
		id: b.id,
		slug: b.slug,
		title: b.title,
		author: b.author,
		description: b.description || "",
		category: b.category,
		categoryLabel: categoryLabel(b.category),
		subject: b.subject || null,
		subjectLabel: subjectLabel(b.subject),
		language: b.language,
		languageName: languageName(b.language),
		priceCents: b.price_cents,
		currency: "inr",
		free: b.price_cents === 0,
		coverUrl: b.cover_url || (b.cover_path ? `/api/books/${b.id}/cover` : null),
		hasPreview: !!b.preview_path,
		format: b.file_path ? "pdf" : b.external_url ? "external" : null,
		publisher: b.publisher || null,
		publishedYear: b.published_year || null,
		featured: !!b.featured,
		ageGroup: b.age_group || null,
		ageGroupLabel: b.age_group ? (ageGroupById(b.age_group) || {}).label || null : null,
		minAge: b.min_age == null ? null : b.min_age,
		maxAge: b.max_age == null ? null : b.max_age,
		ageRange: ageRangeLabel(b.min_age, b.max_age),
		// Every group the range overlaps (a book can sit in several), in age order.
		ageGroups: (b.min_age == null ? [] : matchingAgeGroups(b.min_age, b.max_age)).map((g) => ({ id: g.id, label: g.label, range: g.range })),
		openEnded: b.max_age != null && b.max_age >= MAX_AGE,
		tags: Array.isArray(b.tags) ? b.tags : [],
		isDemo: !!b.is_demo,
		gradeMin: b.grade_min == null ? null : b.grade_min,
		gradeMax: b.grade_max == null ? null : b.grade_max,
		gradeRange: gradeRangeLabel(b.grade_min, b.grade_max),
		readingLevel: b.reading_level || null,
		readingLevelLabel: readingLevelLabel(b.reading_level),
	};
}

export const FILTER_OPTIONS = { categories: CATEGORIES, subjects: SUBJECTS, readingLevels: READING_LEVELS };
