// Fixed vocabularies for the bookstore: categories, subjects, age groups, grade levels and reading
// levels. Pure and shared by the server (validation, filtering) and the UI (labels, cards).
// Ids are stored in the database; labels are display text only.

export const CATEGORIES = [
	{ id: "mathematics", label: "Mathematics", icon: "ri-calculator-line" },
	{ id: "science", label: "Science", icon: "ri-flask-line" },
	{ id: "english", label: "English", icon: "ri-quill-pen-line" },
	{ id: "computer-science", label: "Computer Science", icon: "ri-code-s-slash-line" },
	{ id: "competitive-exams", label: "Competitive Exams", icon: "ri-medal-line" },
	{ id: "childrens-books", label: "Children's Books", icon: "ri-bear-smile-line" },
	{ id: "general", label: "General", icon: "ri-book-open-line" },
];

export const SUBJECTS = [
	{ id: "math", label: "Mathematics" },
	{ id: "science", label: "Science" },
	{ id: "english", label: "English & Literacy" },
	{ id: "computer-science", label: "Computer Science" },
	{ id: "social-studies", label: "Social Studies" },
	{ id: "languages", label: "World Languages" },
	{ id: "arts", label: "Arts & Creativity" },
	{ id: "test-prep", label: "Test Preparation" },
	{ id: "life-skills", label: "Life Skills" },
	{ id: "general", label: "General" },
];

// Ages are inclusive. The last group is open-ended; 18 sits in both neighbours on purpose.
export const AGE_GROUPS = [
	{ id: "baby-toddler", label: "Baby & Toddler", range: "Ages 0–3", min: 0, max: 3, icon: "ri-heart-2-line" },
	{ id: "preschool", label: "Preschool & Kindergarten", range: "Ages 4–6", min: 4, max: 6, icon: "ri-palette-line" },
	{ id: "young-readers", label: "Young Readers", range: "Ages 7–9", min: 7, max: 9, icon: "ri-book-open-line" },
	{ id: "independent-readers", label: "Independent Readers", range: "Ages 10–12", min: 10, max: 12, icon: "ri-rocket-line" },
	{ id: "middle-secondary", label: "Middle & Secondary School", range: "Ages 13–15", min: 13, max: 15, icon: "ri-compass-3-line" },
	{ id: "senior-secondary", label: "Senior Secondary", range: "Ages 16–18", min: 16, max: 18, icon: "ri-award-line" },
	{ id: "adult", label: "College & Lifelong Learning", range: "Ages 18+", min: 18, max: 120, icon: "ri-lightbulb-flash-line" },
];

// -1 = Pre-K, 0 = Kindergarten, 1-12 = grades, 13 = College / adult.
export const GRADE_MIN = -1;
export const GRADE_MAX = 13;
export const gradeLabel = (g) => (g === -1 ? "Pre-K" : g === 0 ? "Kindergarten" : g === 13 ? "College & adult" : `Grade ${g}`);
export const GRADES = Array.from({ length: GRADE_MAX - GRADE_MIN + 1 }, (_, i) => ({ id: GRADE_MIN + i, label: gradeLabel(GRADE_MIN + i) }));

export const READING_LEVELS = [
	{ id: "pre-reader", label: "Pre-reader (read aloud)" },
	{ id: "beginner", label: "Beginner" },
	{ id: "intermediate", label: "Intermediate" },
	{ id: "advanced", label: "Advanced" },
];

export const SORTS = ["relevance", "newest", "popular", "price_asc", "price_desc", "title"];
export const STATUSES = ["draft", "published", "archived"];

export const MAX_AGE = 120;
export const LANGUAGE_RE = /^[a-z]{2,3}$/;

const by = (list) => new Map(list.map((x) => [x.id, x]));
const catMap = by(CATEGORIES);
const subjMap = by(SUBJECTS);
const ageMap = by(AGE_GROUPS);
const levelMap = by(READING_LEVELS);

export const categoryLabel = (id) => (catMap.get(id) || {}).label || null;
export const subjectLabel = (id) => (subjMap.get(id) || {}).label || null;
export const ageGroupById = (id) => ageMap.get(id) || null;
export const readingLevelLabel = (id) => (levelMap.get(id) || {}).label || null;
export const isCategory = (id) => catMap.has(id);
export const isSubject = (id) => subjMap.has(id);
export const isAgeGroup = (id) => ageMap.has(id);
export const isReadingLevel = (id) => levelMap.has(id);

// The group a single age belongs to (18 is reported as Senior Secondary; every group that contains it still matches filters).
export const ageGroupForAge = (age) => AGE_GROUPS.find((g) => age >= g.min && age <= g.max) || null;

// Every group whose inclusive range overlaps the book's range. A book with no range suits all ages.
// Boundaries are inclusive, so age 3 is Baby & Toddler only, age 4 is Preschool, and age 18 is both
// Senior Secondary and College & Lifelong Learning.
export const matchingAgeGroups = (min, max) => (min == null || max == null ? AGE_GROUPS : AGE_GROUPS.filter((g) => g.min <= max && g.max >= min));

export const ageRangeLabel = (min, max) => (min == null || max == null ? "All ages" : max >= MAX_AGE ? `Ages ${min}+` : min === max ? `Age ${min}` : `Ages ${min}–${max}`);
export const gradeRangeLabel = (min, max) => (min == null || max == null ? null : min === max ? gradeLabel(min) : `${gradeLabel(min)} – ${gradeLabel(max)}`);

export const languageName = (code) => {
	try {
		return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
	} catch (e) {
		return code;
	}
};
