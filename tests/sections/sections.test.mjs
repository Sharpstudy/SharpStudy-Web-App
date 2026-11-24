import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GALLERY_ITEMS, GALLERY_CATEGORIES, publishableItems, filterByCategory, usedCategories } from "../../lib/gallery/items.js";
import { JOBS, openJobs } from "../../lib/careers/jobs.js";
import { parseBlogDate, sortNewest, featuredPost, latestPosts, relatedPosts, blogCategories } from "../../lib/blog/helpers.js";
import { HERO_VIDEO, HERO_VIDEO_MIN_WIDTH } from "../../lib/site/heroMedia.js";
import { STATS, STATS_NOTE } from "../../lib/site/stats.js";
import { primaryNav, navModel } from "../../components/_App/accountLinks.js";

const exists = (f) => fs.existsSync(new URL(`../../${f}`, import.meta.url));
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("public navigation: Home, About, Programs (dropdown), Gallery, Blog, Careers; the blog link is the existing route; no Courses or Cart", () => {
	assert.deepEqual(primaryNav.map((l) => l.label), ["Home", "About", "Programs", "Gallery", "Blog", "Careers"]);
	assert.equal(primaryNav.find((l) => l.label === "Blog").href, "/blog/blogs/");
	assert.equal(primaryNav.find((l) => l.label === "Programs").children.length, 4);
	assert.deepEqual(navModel(null, "/gallery").primary, primaryNav);
	assert.ok(!primaryNav.some((l) => /courses|cart/i.test(l.label)));
});

test("new routes exist and the existing blog routes are kept (no duplicate blog)", () => {
	for (const f of ["pages/careers/index.js", "pages/gallery/index.js", "pages/success-stories/index.js", "pages/blog/blogs.js", "pages/blog/[id].js"]) assert.ok(exists(f), f);
	assert.ok(!exists("pages/blog/index.js") && !exists("pages/blogs"), "no second blog");
});

test("gallery ships empty (no genuine consented photos in the repo) and shows only fully-qualified items", () => {
	assert.deepEqual(GALLERY_ITEMS, []);
	assert.equal(GALLERY_CATEGORIES.length, 6);
	const ok = { id: "a", src: "/gallery/a.jpg", alt: "Learners at a workshop", category: "workshops", consent: true };
	const items = [
		ok,
		{ ...ok, id: "no-consent", consent: false },
		{ ...ok, id: "consent-missing", consent: undefined },
		{ ...ok, id: "no-alt", alt: "  " },
		{ ...ok, id: "bad-category", category: "memes" },
		{ ...ok, id: "stock", src: "https://images.example.com/x.jpg" },
		{ ...ok, id: "b", category: "events" },
	];
	assert.deepEqual(publishableItems(items).map((i) => i.id), ["a", "b"]);
	assert.deepEqual(filterByCategory(publishableItems(items), "events").map((i) => i.id), ["b"]);
	assert.deepEqual(usedCategories(publishableItems(items)).map((c) => c.slug), ["workshops", "events"]);
});

test("careers ships with no vacancies and only shows complete, well-formed listings", () => {
	assert.deepEqual(JOBS, []);
	const job = { id: "j1", title: "Maths instructor", type: "teaching", summary: "Teach MathX", applyHref: "/contact-us/" };
	assert.deepEqual(openJobs([job, { ...job, id: "j2", type: "other" }, { ...job, id: "j3", applyHref: "https://evil.example" }, { ...job, id: "j4", title: "" }]).map((j) => j.id), ["j1"]);
	const page = read("pages/careers/index.js");
	assert.match(page, /There are no openings right now/);
	assert.match(page, /\/become-an-instructor\//);
	assert.match(page, /\/become-a-telecaller\//);
	assert.doesNotMatch(page, /salary|\bbenefits?\b/i, "no invented salary or benefits");
});

test("blog helpers: dates, newest-first, featured, latest and related", () => {
	assert.equal(parseBlogDate("03 Mar 2018"), Date.UTC(2018, 2, 3));
	assert.ok(Number.isNaN(parseBlogDate("someday")));
	const posts = [
		{ id: "1", date: "03 Mar 2018", category: "A" },
		{ id: "2", date: "05 Mar 2018", category: "B" },
		{ id: "3", date: "04 Mar 2018", category: "A" },
		{ id: "4", date: "unknown", category: "B" },
	];
	assert.deepEqual(sortNewest(posts).map((p) => p.id), ["2", "3", "1", "4"]);
	assert.equal(featuredPost(posts).id, "2");
	assert.deepEqual(latestPosts(posts, 2).map((p) => p.id), ["2", "3"]);
	assert.deepEqual(relatedPosts(posts, posts[0], 3).map((p) => p.id), ["3", "2", "4"]);
	assert.ok(!relatedPosts(posts, posts[0]).some((p) => p.id === "1"));
	assert.deepEqual(blogCategories(posts), ["A", "B"]);
	assert.equal(featuredPost([]), null);
});

test("existing blog content is untouched, and a blog article is not invented", () => {
	const data = read("utils/sampleData.js");
	assert.equal((data.match(/\bid: "/g) || []).length, 8);
	for (const f of ["pages/blog/blogs.js", "pages/blog/[id].js", "components/Sections/HomePreviews.js"]) assert.doesNotMatch(read(f), /author:\s*["']/);
});

test("success stories reuse the existing testimonials API and write nothing; the admin API is unchanged", () => {
	assert.match(read("components/Sections/useTestimonials.js"), /\/api\/testimonials`/);
	assert.doesNotMatch(read("components/Sections/useTestimonials.js"), /axios\.(post|put|patch|delete)/);
	assert.ok(exists("pages/api/testimonials/index.js") && exists("pages/api/testimonials/create.js") && exists("pages/admin/testimonials/index.js"));
	assert.ok(!exists("pages/api/gallery") && !exists("pages/api/careers") && !exists("pages/api/jobs"), "no new API surface");
});

test("homepage previews in the requested order, after the existing sections", () => {
	const home = read("pages/index.js");
	const order = ["<ProgramsHero", "<Stats", "<Intro", "<FeaturedPrograms", "<Approach", "<Platform", "<SuccessPreview", "<GalleryPreview", "<BlogPreview", "<CareersCta", "<ProgramsCta"].map((t) => home.indexOf(t));
	assert.ok(order.every((i) => i > 0), "all sections present");
	assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("the gallery lightbox is an accessible dialog with Escape and focus return", () => {
	const g = read("components/Sections/GalleryView.js");
	for (const piece of ['role="dialog"', 'aria-modal="true"', '"Escape"', "opener.current.focus()", "aria-label={`Open photo:"]) assert.ok(g.includes(piece), piece);
});

test("the four supplied statistics are exactly as given and are marked as supplied, not verified", () => {
	assert.deepEqual(STATS.map((s) => [s.value, s.label]), [
		["50K+", "Learners Trained Successfully"],
		["98%", "Confidence Boost – Average Improvement"],
		["3000+", "Expert Mentors"],
		["4.9★", "Parent Rating"],
	]);
	assert.match(STATS_NOTE, /provided by SharpStudy/);
	assert.doesNotMatch(JSON.stringify(STATS) + STATS_NOTE, /verified|certified|audited/i);
	assert.match(read("lib/site/stats.js"), /not computed from the database/);
});

test("hero video: the existing landing page video and a poster from it are configured and exist; playback is muted, looping, inline, skips phones and reduced motion", () => {
	assert.equal(HERO_VIDEO.mp4, "/images/team/landingpage%20video.mp4");
	assert.ok(fs.existsSync(new URL("../../public/images/team/landingpage video.mp4", import.meta.url)), "the original video file is in place");
	assert.ok(fs.existsSync(new URL(`../../public${HERO_VIDEO.poster}`, import.meta.url)), "poster exists");
	assert.ok(HERO_VIDEO_MIN_WIDTH >= 768);
	const c = read("components/Home/HeroStats.js");
	for (const piece of ["autoPlay", "muted", "loop", "playsInline", 'preload="metadata"', "poster={media.poster}", "prefers-reduced-motion: reduce", "saveData", "onError={() => setMode(\"off\")}", "Pause background video"]) assert.ok(c.includes(piece), piece);
	assert.doesNotMatch(c, /<video[^>]*controls/, "no visible video controls");
	assert.match(c, /HERO_VIDEO && <HeroVideo/);
});

test("the hero keeps its headline, text and both CTA buttons", () => {
	const c = read("components/Home/HeroStats.js");
	for (const t of ["Skills for life,", "made fun.", "Discover the programs", "About SharpStudy", "Personality Enrichment, MathX,"]) assert.ok(c.includes(t), t);
});
