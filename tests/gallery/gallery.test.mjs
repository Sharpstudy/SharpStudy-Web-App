import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHOWCASE_CATEGORIES, SHOWCASE_ITEMS, itemsFor, lightboxItems, matchesCategory, photoItems } from "../../lib/gallery/showcase.js";
import { PROGRAMS } from "../../lib/programs/catalog.js";
import { HERO_VIDEO } from "../../lib/site/heroMedia.js";

const root = new URL("../../", import.meta.url);
const file = (p) => path.join(fileURLToPath(root), decodeURIComponent(p));
const read = (p) => fs.readFileSync(file(p), "utf8");
const pageExists = (route) => {
	const parts = route.split("#")[0].split("/").filter(Boolean);
	if (parts.length === 0) return true;
	const dir = file(`pages/${parts.join("/")}`);
	return fs.existsSync(`${dir}/index.js`) || fs.existsSync(`${dir}.js`) || (parts[0] === "programs" && parts.length === 2 && fs.existsSync(file("pages/programs/[slug].js")));
};
// width/height of a lossy or extended WebP from its header
const webpSize = (p) => {
	const b = fs.readFileSync(file(`public${p}`));
	assert.equal(b.toString("ascii", 0, 4), "RIFF");
	assert.equal(b.toString("ascii", 8, 12), "WEBP");
	const k = b.toString("ascii", 12, 16);
	if (k === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
	if (k === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
	throw new Error(`unsupported webp ${k}`);
};

test("the six categories from the brief, in order", () => {
	assert.deepEqual(SHOWCASE_CATEGORIES.map((c) => c.label), ["All", "Our Programs", "Inside SharpStudy", "Learning Experiences", "Activities", "Achievements"]);
});

test("every entry has the required fields, a unique id and a known category", () => {
	const ids = new Set();
	for (const i of SHOWCASE_ITEMS) {
		assert.ok(i.id && i.title && i.description && i.alt, i.id);
		assert.ok(!ids.has(i.id), `duplicate id ${i.id}`);
		ids.add(i.id);
		assert.ok(SHOWCASE_CATEGORIES.some((c) => c.slug === i.category && c.slug !== "all"), `${i.id} category`);
		assert.ok(["screenshot", "illustration", "photo"].includes(i.type), i.id);
	}
});

test("every screenshot is a real file with the dimensions the data states, and is light enough to load quickly", () => {
	const shots = SHOWCASE_ITEMS.filter((i) => i.type === "screenshot");
	assert.ok(shots.length >= 15);
	for (const s of shots) {
		assert.match(s.image, /^\/images\/gallery\/(platform|programs)\/[a-z0-9-]+\.webp$/, s.id);
		assert.ok(fs.existsSync(file(`public${s.image}`)), `${s.image} exists`);
		const { w, h } = webpSize(s.image);
		assert.deepEqual([s.width, s.height], [w, h], `${s.image} dimensions`);
		assert.ok(fs.statSync(file(`public${s.image}`)).size < 150 * 1024, `${s.image} under 150 KB`);
		assert.ok(s.alt.length > 15, `${s.id} alt text is descriptive`);
	}
});

test("illustrations are labelled as such and carry no image, so they can never pass as photographs", () => {
	const art = SHOWCASE_ITEMS.filter((i) => i.type === "illustration");
	assert.equal(art.length, 8);
	for (const a of art) {
		assert.ok(!a.image && a.icon && a.tone, a.id);
		assert.match(a.alt, /\(illustration\)$/);
	}
	assert.match(read("components/Gallery/Sections.js"), /Illustration/);
	assert.ok(!lightboxItems(art).length, "illustrations do not open in the lightbox");
});

test("every route on a card is a real page, and the four programs use the existing program routes", () => {
	for (const i of SHOWCASE_ITEMS.filter((x) => x.route)) assert.ok(pageExists(i.route), `${i.id} -> ${i.route}`);
	const programs = SHOWCASE_ITEMS.filter((i) => i.section === "programs");
	assert.deepEqual(programs.map((p) => p.route), PROGRAMS.map((p) => `/programs/${p.slug}/`));
	assert.deepEqual(programs.map((p) => p.title), ["Personality Enrichment", "MathX", "Leadership", "Public Speaking"]);
});

test("category filtering: each category returns only its items; Activities and Achievements are empty until genuine content exists", () => {
	for (const c of SHOWCASE_CATEGORIES.filter((x) => x.slug !== "all")) {
		const got = itemsFor(SHOWCASE_ITEMS, c.slug, () => true);
		assert.ok(got.every((i) => i.category === c.slug), c.slug);
	}
	assert.equal(itemsFor(SHOWCASE_ITEMS, "all", () => true).length, SHOWCASE_ITEMS.length);
	assert.equal(itemsFor(SHOWCASE_ITEMS, "activities", () => true).length, 0);
	assert.equal(itemsFor(SHOWCASE_ITEMS, "achievements", () => true).length, 0);
	assert.ok(matchesCategory({ category: "inside" }, "all") && !matchesCategory({ category: "inside" }, "programs"));
});

test("consented photographs join the page under Activities/Achievements, unconsented ones never do", () => {
	assert.deepEqual(photoItems(), [], "none shipped");
	const ok = { id: "a", src: "/gallery/a.jpg", alt: "Learners at a workshop", category: "workshops", consent: true };
	const got = photoItems([ok, { ...ok, id: "b", consent: false }, { ...ok, id: "c", category: "competitions" }]);
	assert.deepEqual(got.map((p) => [p.id, p.category]), [["photo-a", "activities"], ["photo-c", "achievements"]]);
});

test("lightbox list: images only, no duplicates, in order", () => {
	const dup = [SHOWCASE_ITEMS[0], SHOWCASE_ITEMS[0], SHOWCASE_ITEMS[1]];
	assert.deepEqual(lightboxItems(dup).map((i) => i.id), [SHOWCASE_ITEMS[0].id, SHOWCASE_ITEMS[1].id]);
});

test("the featured video is the existing landing page video, left where it is", () => {
	assert.equal(HERO_VIDEO.mp4, "/images/team/landingpage%20video.mp4");
	assert.ok(fs.existsSync(file("public/images/team/landingpage video.mp4")));
	assert.ok(fs.existsSync(file(`public${HERO_VIDEO.poster}`)));
	const s = read("components/Gallery/Sections.js");
	assert.match(s, /preload="auto"/);
	assert.match(s, /controls/);
	assert.match(s, /Play the SharpStudy landing page video/);
});

test("the page is built from the data file, has the required sections, and adds no API or database surface", () => {
	const page = read("pages/gallery/index.js");
	for (const t of ["GalleryHero", "GalleryExplorer", "Your Learning Journey Starts Here", "Explore Programs", "<Footer />"]) assert.ok(page.includes(t), t);
	const hero = read("components/Gallery/GalleryHero.js");
	for (const t of ["SharpStudy Gallery", "Every Learning Journey", "Has a Story", "Explore Our Gallery", "Discover Our Programs"]) assert.ok(hero.includes(t), t);
	const sections = read("components/Gallery/Sections.js");
	for (const t of ["Explore our programs", "A look inside the platform", "How learning happens", "Activities and learning moments", "SharpStudy in motion", "Student Achievements Coming Soon"]) assert.ok(sections.includes(t), t);
	assert.doesNotMatch(page + hero + sections + read("components/Gallery/GalleryExplorer.js"), /axios|fetch\(|\/api\//, "no network calls");
	assert.ok(!fs.existsSync(file("pages/api/gallery")));
});

test("lightbox is an accessible dialog: Escape, arrows, focus trap, close button, scroll lock, alt text", () => {
	const l = read("components/Gallery/Lightbox.js");
	for (const t of ['role="dialog"', 'aria-modal="true"', '"Escape"', '"ArrowRight"', '"ArrowLeft"', '"Tab"', 'aria-label="Close"', 'aria-label="Previous image"', 'aria-label="Next image"', "document.body.style.overflow", "alt={item.alt}", "item.title", "item.description"]) assert.ok(l.includes(t), t);
	assert.match(read("components/Gallery/GalleryExplorer.js"), /el\.focus\(\)/, "focus returns to the opener");
});

test("filters are real buttons with aria-pressed, in a labelled list", () => {
	const g = read("components/Gallery/GalleryExplorer.js");
	assert.match(g, /aria-pressed=\{category === c\.slug\}/);
	assert.match(g, /aria-label="Gallery categories"/);
	assert.match(g, /role="status"/);
});

test("reveal animations are skipped with reduced motion", () => {
	assert.match(read("components/Gallery/GalleryExplorer.js"), /prefers-reduced-motion: reduce/);
});

test("Gallery is in the public navigation between Programs and Blog (and nothing was removed)", async () => {
	const { primaryNav } = await import("../../components/_App/accountLinks.js");
	assert.deepEqual(primaryNav.map((l) => l.label), ["Home", "About", "Programs", "Gallery", "Blog", "Careers"]);
	assert.equal(primaryNav.find((l) => l.label === "Gallery").href, "/gallery/");
});
