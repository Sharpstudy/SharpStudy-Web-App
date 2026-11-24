// Central data for the /gallery/ page. Every entry points at a REAL asset in public/images/gallery/ (a screenshot of the running SharpStudy
// site, captured from public pages only) or is an `illustration` (an icon tile, clearly labelled as artwork, never an actual event).
//
// Entry fields:
//   id, title, description (short, factual), category, alt
//   section      "programs" | "platform" | "experiences"   which editorial section shows it
//   type         "screenshot" | "illustration"
//   image, width, height   (screenshots only: real file and its real pixel size, so the layout reserves space)
//   moment       true = also shown in the "Activities and Learning Moments" mosaic
//   route, linkLabel   optional real route
//   icon, tone   illustration tiles only
//
// Nothing here is a student photo, award, result or statistic. Genuine, consented photographs go in lib/gallery/items.js (they then appear in
// the mosaic automatically, under Activities or Achievements). Screens that need a sign-in (dashboards, Mastery Ladder, Sage, instructor and
// admin tools) are NOT captured yet; see docs/website-sections/README.md.
import { PROGRAMS, programHref } from "../programs/catalog.js";
import { GALLERY_ITEMS, publishableItems } from "./items.js";

export const SHOWCASE_CATEGORIES = [
	{ slug: "all", label: "All" },
	{ slug: "programs", label: "Our Programs" },
	{ slug: "inside", label: "Inside SharpStudy" },
	{ slug: "experiences", label: "Learning Experiences" },
	{ slug: "activities", label: "Activities" },
	{ slug: "achievements", label: "Achievements" },
];

const G = "/images/gallery/";

const PROGRAM_SHOTS = {
	"personality-enrichment": { image: `${G}programs/personality-enrichment.webp`, width: 1280, height: 800 },
	mathx: { image: `${G}programs/mathx-program.webp`, width: 1280, height: 800 },
	leadership: { image: `${G}programs/leadership-program.webp`, width: 1280, height: 800 },
	"public-speaking": { image: `${G}programs/public-speaking-program.webp`, width: 1280, height: 800 },
};

const programItems = PROGRAMS.map((p) => ({
	id: `program-${p.slug}`,
	title: p.title,
	description: p.short,
	category: "programs",
	section: "programs",
	type: "screenshot",
	...PROGRAM_SHOTS[p.slug],
	alt: `Screenshot of the ${p.title} program page on SharpStudy`,
	route: programHref(p.slug),
	linkLabel: "Explore program",
}));

const platformItems = [
	{
		id: "homepage",
		title: "The SharpStudy homepage",
		description: "The front page introduces SharpStudy and its four learning programs.",
		category: "inside",
		section: "platform",
		type: "screenshot",
		image: `${G}platform/homepage-hero.webp`,
		width: 1280,
		height: 800,
		alt: "Screenshot of the SharpStudy homepage hero with the headline Skills for life, made fun",
		moment: true,
		route: "/",
		linkLabel: "Visit the homepage",
	},
	{
		id: "homepage-programs",
		title: "Four programs at a glance",
		description: "Program cards on the homepage link to each program's own page.",
		category: "inside",
		section: "platform",
		type: "screenshot",
		image: `${G}platform/homepage-programs.webp`,
		width: 1280,
		height: 750,
		alt: "Screenshot of the four program cards on the SharpStudy homepage",
		route: "/programs/",
		linkLabel: "See all programs",
	},
	{
		id: "programs-menu",
		title: "The Programs menu",
		description: "The header's Programs menu goes straight to any of the four programs.",
		category: "inside",
		section: "platform",
		type: "screenshot",
		image: `${G}platform/programs-menu.webp`,
		width: 1280,
		height: 430,
		alt: "Screenshot of the SharpStudy header with the Programs menu open, listing the four programs",
	},
	{
		id: "programs-overview",
		title: "Programs overview",
		description: "One page that lists Personality Enrichment, MathX, Leadership and Public Speaking.",
		category: "inside",
		section: "platform",
		type: "screenshot",
		image: `${G}platform/programs-overview.webp`,
		width: 1280,
		height: 800,
		alt: "Screenshot of the SharpStudy programs overview page",
		route: "/programs/",
		linkLabel: "Open programs overview",
	},
	{
		id: "sign-in",
		title: "Sign in and create an account",
		description: "Learners, instructors and parents sign in or register here; parents and families have their own entry.",
		category: "inside",
		section: "platform",
		type: "screenshot",
		image: `${G}platform/sign-in-and-registration.webp`,
		width: 1280,
		height: 800,
		alt: "Screenshot of the SharpStudy sign-in and account creation page, with an empty form",
		moment: true,
		route: "/auth/",
		linkLabel: "Go to sign in",
	},
	{
		id: "careers",
		title: "Careers page",
		description: "Where teaching and non-teaching opportunities are shared, with ways to get in touch.",
		category: "inside",
		section: "platform",
		type: "screenshot",
		image: `${G}platform/careers.webp`,
		width: 1280,
		height: 800,
		alt: "Screenshot of the SharpStudy careers page",
		route: "/careers/",
		linkLabel: "View careers",
	},
	{
		id: "mobile",
		title: "On a phone",
		description: "The homepage adapts to a phone screen.",
		category: "inside",
		section: "platform",
		type: "screenshot",
		image: `${G}platform/homepage-mobile.webp`,
		width: 390,
		height: 844,
		alt: "Screenshot of the SharpStudy homepage on a 390 pixel wide phone screen",
		moment: true,
	},
];

// Real pieces of the program pages (curriculum outlines are a proposed outline, as the pages themselves say).
const experienceShots = [
	{ id: "exp-personality-modules", title: "Personality Enrichment modules", description: "Self-awareness, confidence, communication, emotional intelligence and more, as a proposed module outline.", image: `${G}programs/personality-enrichment-modules.webp`, width: 1280, height: 644, alt: "Screenshot of the Personality Enrichment module outline", route: programHref("personality-enrichment"), linkLabel: "Explore program" },
	{ id: "exp-mathx-modules", title: "MathX modules", description: "Number sense, mental mathematics, logical reasoning, puzzles and problem-solving, as a proposed module outline.", image: `${G}programs/mathx-modules.webp`, width: 1280, height: 621, alt: "Screenshot of the MathX module outline", route: programHref("mathx"), linkLabel: "Explore program" },
	{ id: "exp-leadership-outcomes", title: "Leadership outcomes and activities", description: "Expected outcomes, activities and assessments listed on the Leadership program page.", image: `${G}programs/leadership-outcomes.webp`, width: 1280, height: 572, alt: "Screenshot of the Leadership outcomes, activities and assessments section", route: programHref("leadership"), linkLabel: "Explore program" },
	{ id: "exp-speaking-outcomes", title: "Public Speaking outcomes and activities", description: "Expected outcomes, activities and assessments listed on the Public Speaking program page.", image: `${G}programs/public-speaking-outcomes.webp`, width: 1280, height: 572, alt: "Screenshot of the Public Speaking outcomes, activities and assessments section", route: programHref("public-speaking"), linkLabel: "Explore program" },
].map((e) => ({ ...e, category: "experiences", section: "experiences", type: "screenshot", moment: true }));

// Illustrated topics. These are artwork, not events: each carries an "Illustration" label on the page.
const experienceTopics = [
	{ id: "topic-interactive", title: "Interactive learning", description: "Video lessons, resources and live classes on the platform.", icon: "ri-slideshow-2-line", tone: "orange" },
	{ id: "topic-practice", title: "Practice and assessments", description: "Quizzes with results, and Mastery Ladder practice for signed-in learners.", icon: "ri-task-line", tone: "sky" },
	{ id: "topic-problem", title: "Problem-solving", description: "A core thread of MathX and Leadership in their proposed module outlines.", icon: "ri-lightbulb-flash-line", tone: "green" },
	{ id: "topic-instructor", title: "Instructor-led learning", description: "Instructors publish courses and run live classes.", icon: "ri-live-line", tone: "pink" },
	{ id: "topic-progress", title: "Learning progress", description: "Course progress is tracked so learners can resume where they stopped.", icon: "ri-line-chart-line", tone: "sky" },
	{ id: "topic-group", title: "Group learning", description: "Teamwork and collaboration is a Leadership module.", icon: "ri-group-line", tone: "green" },
	{ id: "topic-communication", title: "Communication skills", description: "Part of Personality Enrichment and Public Speaking.", icon: "ri-mic-line", tone: "orange" },
	{ id: "topic-creative", title: "Creative thinking", description: "Storytelling, puzzles and projects across the programs.", icon: "ri-palette-line", tone: "pink" },
].map((t) => ({ ...t, category: "experiences", section: "experiences", type: "illustration", alt: `${t.title} (illustration)` }));

// Consented photographs from lib/gallery/items.js (empty today) join the mosaic automatically.
const PHOTO_CATEGORY = { workshops: "activities", "classroom-activities": "activities", "learning-activities": "activities", events: "achievements", competitions: "achievements", "student-projects": "achievements" };
export const photoItems = (items = GALLERY_ITEMS) =>
	publishableItems(items).map((i) => ({
		id: `photo-${i.id}`,
		title: i.caption || i.alt,
		description: i.caption || i.alt,
		category: PHOTO_CATEGORY[i.category] || "activities",
		section: "photos",
		type: "photo",
		image: i.src,
		width: i.width || 1200,
		height: i.height || 800,
		alt: i.alt,
		moment: true,
	}));

export const SHOWCASE_ITEMS = [...programItems, ...platformItems, ...experienceShots, ...experienceTopics, ...photoItems()];

export const matchesCategory = (item, category) => !category || category === "all" || item.category === category;
export const itemsFor = (items, category, pick) => items.filter((i) => matchesCategory(i, category) && pick(i));
// Items that can open in the lightbox (they have a real image), without duplicates, in display order.
export const lightboxItems = (items) => items.filter((i, idx) => i.image && items.findIndex((j) => j.id === i.id) === idx);
