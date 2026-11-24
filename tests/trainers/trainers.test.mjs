import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PORTRAITS_AVAILABLE, TRAINERS, trainerImagesShown } from "../../lib/trainers/data.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const file = (p) => path.join(root, p);
const read = (p) => fs.readFileSync(file(p), "utf8");

test("ten trainer profiles with neutral labels, ids and file names in order", () => {
	assert.equal(TRAINERS.length, 10);
	TRAINERS.forEach((t, i) => {
		const n = String(i + 1).padStart(2, "0");
		assert.equal(t.id, `trainer-${n}`);
		assert.equal(t.label, `Trainer ${n}`);
		assert.equal(t.image, `/images/team/trainers/trainer-${n}.webp`);
		assert.equal(t.fictional, true);
		assert.deepEqual([t.width, t.height], [800, 1000], "4:5 portrait");
		assert.match(t.alt, /AI-generated.*fictional/i);
	});
	assert.equal(new Set(TRAINERS.map((t) => t.area)).size, 10, "ten different illustrative areas");
});

test("no invented names, qualifications, certifications, years of experience or employment history", () => {
	const text = JSON.stringify(TRAINERS) + read("components/AboutUs/Trainers.js");
	assert.doesNotMatch(text, /\b(Dr\.?|Prof\.?|PhD|M\.?Ed|B\.?Ed|MBA|certified|certification|award|years? of experience|\d+\+? years|formerly|ex-|worked at|graduate of)\b/i);
	assert.ok(TRAINERS.every((t) => /^Trainer \d\d$/.test(t.label)));
});

test("while the portraits do not exist, no request is made for them and the page says the profiles are placeholders", () => {
	const dir = file("public/images/team/trainers");
	const present = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^trainer-\d\d\.webp$/.test(f)) : [];
	assert.equal(PORTRAITS_AVAILABLE, present.length === 10, "the switch is on exactly when all ten files exist");
	const c = read("components/AboutUs/Trainers.js");
	assert.match(c, /PORTRAITS_AVAILABLE \?/);
	assert.match(c, /placeholder profiles/);
	assert.match(c, /AI-generated illustrations of fictional people/);
	assert.equal(trainerImagesShown(), PORTRAITS_AVAILABLE);
});

test("when the portraits are switched on: all ten files exist, are WebP at 800x1000, light, and all different", { skip: PORTRAITS_AVAILABLE ? false : "portraits not added yet (PORTRAITS_AVAILABLE is false)" }, () => {
	const hashes = new Set();
	for (const t of TRAINERS) {
		const f = file("public" + t.image);
		assert.ok(fs.existsSync(f), t.image);
		const b = fs.readFileSync(f);
		assert.equal(b.toString("ascii", 0, 4), "RIFF");
		assert.equal(b.toString("ascii", 8, 12), "WEBP");
		const k = b.toString("ascii", 12, 16);
		const [w, h] = k === "VP8X" ? [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)] : [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
		assert.deepEqual([w, h], [800, 1000], t.image);
		assert.ok(b.length < 200 * 1024, `${t.image} is ${b.length} bytes`);
		hashes.add(crypto.createHash("sha256").update(b).digest("hex"));
	}
	assert.equal(hashes.size, 10, "no duplicate portraits");
});

test("the section sits after the co-founders on the About page and nothing else on that page was removed", () => {
	const page = read("pages/about-us.js");
	const order = ["<Benefits", "<HowItWorks", "<Leadership", "<Trainers", "<Testimonials", "<Partners", "<Audiences", "<DemoBand", "<FinalCta"].map((t) => page.indexOf(t));
	assert.ok(order.every((i) => i > 0), "every existing section is still there");
	assert.deepEqual([...order].sort((a, b) => a - b), order, "order preserved, Trainers right after Leadership");
	for (const t of ["About SharpStudy", "A project-based learning platform", "Explore programs", "Contact us"]) assert.ok(page.includes(t), t);
});

test("co-founder profiles and the existing team assets are unchanged", () => {
	const l = read("components/AboutUs/Leadership.js");
	for (const t of ["MD. Najeeb Uddin", "Mike Qureshi", "/images/team/md-najeeb-uddin.png", "/images/team/mike-qureshi.png", "Co-Founder, SharpStudy", "Co-Founder | Business Strategy, Innovation & Growth", "Meet Our Leadership"]) assert.ok(l.includes(t), t);
	for (const f of ["md-najeeb-uddin.png", "mike-qureshi.png", "landingpage video.mp4"]) assert.ok(fs.existsSync(file(`public/images/team/${f}`)), f);
});

test("the generation prompts for all ten portraits are documented", () => {
	const d = read("docs/trainers/PORTRAIT-PROMPTS.md");
	assert.match(d, /NOT been generated/);
	for (const t of ["Senior male education mentor", "Female communication trainer", "Male mathematics educator", "Female personality development coach", "Male leadership trainer", "Female public speaking coach", "Male learning and technology mentor", "Female creative learning educator", "Male student development mentor", "Female senior education mentor"]) assert.ok(d.includes(t), t);
});
