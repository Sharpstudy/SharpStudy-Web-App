// Redesign guarantees that can be checked without a browser: palette contrast computed from the real design
// tokens, every visible navigation link resolving to an existing page, honest catalogue data on the homepage,
// the new filters, and structural accessibility rules. (Visual layout still needs a browser check.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createBookRepo, createFakeStripe } from "./memoryRepo.mjs";
import { memoryStorage } from "../../lib/books/storage.js";
import { seedDemo } from "../../lib/books/demoSeed.js";
import * as svc from "../../lib/books/service.js";
import { primaryNav, accountLinks, dashboardNav } from "../../components/_App/accountLinks.js";
import { designMode } from "../../components/_App/designMode.js";

const read = (p) => fs.readFileSync(p, "utf8");

// ------------------------------------------------------------------ contrast from the real tokens

const tokens = read("styles/sharpstudy/_tokens.scss");
const hex = (name) => {
	const m = new RegExp(`--ss-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
	assert.ok(m, `token --ss-${name} exists`);
	return m[1];
};
const lum = (h) => {
	const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

test("colour contrast: text on every pastel surface and the main actions meet WCAG AA (>= 4.5:1)", () => {
	const ink = hex("ink");
	for (const bg of ["peach", "sky", "sun", "mint", "lav", "page", "surface"]) {
		assert.ok(contrast(ink, hex(bg)) >= 7, `body ink on ${bg}`);
	}
	for (const tone of ["peach", "sky", "sun", "mint", "lav"]) {
		assert.ok(contrast(hex(`${tone}-ink`), hex(tone)) >= 7, `${tone}-ink on ${tone}`);
		assert.ok(contrast(hex(`${tone}-ink`), "#ffffff") >= 4.5, `${tone}-ink on white`);
	}
	assert.ok(contrast("#ffffff", hex("primary")) >= 4.5, "white on the primary button");
	assert.ok(contrast(hex("muted"), hex("page")) >= 4.5, "muted text on the page");
	assert.ok(contrast(hex("text"), hex("page")) >= 7, "body text on the page");
	assert.ok(contrast(hex("primary"), hex("page")) >= 4.5, "links on the page");
	assert.ok(contrast(hex("lav-ink"), hex("lav")) >= 7, "filter chips");
	// the palette requested for the redesign is present as surfaces
	for (const [name, want] of [["peach", "#fff0e8"], ["sky", "#ddf3ff"], ["sun", "#fff1a8"], ["mint", "#ddf7e5"], ["lav", "#eee5ff"], ["ink", "#25304a"]]) assert.equal(hex(name).toLowerCase(), want);
});

// ------------------------------------------------------------------ navigation

function routeExists(href) {
	const clean = href.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";
	if (clean === "/") return true;
	const parts = clean.split("/").filter(Boolean);
	const walk = (dir, i) => {
		if (i === parts.length) return fs.existsSync(path.join(dir, "index.js"));
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const e of entries) {
			const name = e.name.replace(/\.js$/, "");
			const dynamic = /^\[.+\]$/.test(name);
			if (e.isFile() && e.name.endsWith(".js") && i === parts.length - 1 && (name === parts[i] || dynamic)) return true;
			if (e.isDirectory() && (name === parts[i] || dynamic) && walk(path.join(dir, e.name), i + 1)) return true;
		}
		return false;
	};
	return walk("pages", 0);
}

test("every visible navigation link (header, account menu, footer, hero, home sections) resolves to an existing page", () => {
	const hrefs = new Set();
	for (const l of primaryNav) hrefs.add(l.href);
	for (const role of ["student", "instructor", "admin"]) {
		for (const l of accountLinks(role, "pending")) hrefs.add(l.href);
		if (role !== "admin") for (const l of dashboardNav(role)) hrefs.add(l.href);
	}
	for (const f of ["components/_App/Footer.js", "components/Home/Hero.js", "components/Books/HomeBooks.js", "components/Home/Sections.js", "pages/404.js", "pages/500.js", "pages/about-us.js", "pages/index.js"]) {
		const src = read(f);
		for (const m of src.matchAll(/(?:href|destination)=["'{`]*\s*["'`]?(\/[A-Za-z0-9\-_/\[\]?=&.,%]*)/g)) {
			// a link built from a variable (for example `/category/${slug}`) is checked as a route pattern instead
			if (src.slice(m.index + m[0].length, m.index + m[0].length + 2) === "${") continue;
			hrefs.add(m[1]);
		}
	}
	const external = (h) => /^(https?:|mailto:|tel:)/.test(h);
	const missing = [...hrefs].filter((h) => !external(h) && !routeExists(h));
	assert.deepEqual(missing, []);
	assert.ok(hrefs.size > 20, "the check covered the real navigation");
	assert.ok(routeExists("/category/anything") && routeExists("/course/anything") && routeExists("/blog/1"), "dynamic routes resolve");
	// public navigation contains the requested destinations
	assert.deepEqual(primaryNav.map((l) => l.label), ["Home", "Courses", "Books", "Blog", "About", "Contact"]);
	// no placeholder links in the redesigned public pages
	for (const f of ["components/_App/Footer.js", "components/Home/Hero.js", "components/Books/HomeBooks.js", "pages/blog/blogs.js", "pages/blog/[id].js", "pages/about-us.js"]) assert.ok(!/href=["']#["']/.test(read(f)), `${f} has no href="#"`);
});

test("design modes: instructor and admin are restrained, everything a reader or visitor sees is playful", () => {
	for (const p of ["/admin", "/admin/books", "/admin/books/123", "/instructor/dashboard", "/instructor/live/5"]) assert.equal(designMode(p), "pro", p);
	for (const p of ["/", "/books", "/books/x/checkout", "/courses", "/blog/blogs", "/about-us", "/contact-us", "/auth", "/learning/my-books", "/study", "/family", "/adminx", "/instructors-guide"]) assert.equal(designMode(p), "play", p);
	const layout = read("components/_App/Layout.js");
	assert.match(layout, /ss-mode--\$\{mode\}/);
	assert.match(read("styles/sharpstudy/_tokens.scss"), /\.ss-mode--pro\s*{[^}]*--ss-radius: 10px/s);
});

// ------------------------------------------------------------------ icons (found by the browser audit)

test("every Remix icon class used by the app exists in the bundled icon font (no blank icons)", () => {
	const css = read("styles/remixicon.css");
	const defined = new Set([...css.matchAll(/\.(ri-[a-z0-9-]+)::?before/g)].map((m) => m[1]));
	const missing = {};
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			if (["node_modules", ".next", ".git", ".claude", ".book-storage", "tests"].includes(e.name)) continue;
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (/\.(js|scss)$/.test(e.name)) for (const m of read(p).matchAll(/["'` ](ri-[a-z0-9-]+)(?![a-z0-9-])/g)) if (!defined.has(m[1])) (missing[m[1]] ||= []).push(p);
		}
	};
	for (const d of ["components", "pages", "lib", "styles/sharpstudy"]) walk(d);
	assert.deepEqual(missing, {});
});

// ------------------------------------------------------------------ accessibility structure

test("accessibility rules are present: focus, reduced motion, skip link, labelled search, dialog semantics", () => {
	const base = read("styles/sharpstudy/_base.scss");
	assert.match(base, /:focus-visible/);
	assert.match(base, /prefers-reduced-motion: reduce/);
	assert.match(read("styles/sharpstudy/_play.scss"), /prefers-reduced-motion: reduce[\s\S]*animation: none/);
	assert.match(read("components/_App/Navbar.js"), /Skip to content/);
	assert.match(read("components/Home/Hero.js"), /<label htmlFor="hero-book-search" className="visually-hidden">/);
	const dialog = read("components/ui/ConfirmDialog.js");
	for (const needle of ["role=\"alertdialog\"", "aria-modal=\"true\"", "aria-labelledby", "Escape", "Tab"]) assert.ok(dialog.includes(needle), needle);
	// illustrations are decorative
	assert.equal([...read("components/ui/Illustration.js").matchAll(/<svg /g)].length, [...read("components/ui/Illustration.js").matchAll(/aria-hidden="true" focusable="false"/g)].length);
	// every destructive admin action goes through the dialog (no window.confirm)
	for (const f of ["pages/admin/books/index.js", "pages/admin/books/[id].js"]) assert.ok(!/window\.confirm/.test(read(f)), f);
	// the reader exposes its progress to assistive technology
	assert.match(read("components/Books/PdfReader.js"), /role="progressbar"/);
});

test("no external scripts were added by the redesign; fonts come from the same provider as before", () => {
	const doc = read("pages/_document.js");
	assert.ok(!/<script/.test(doc));
	assert.match(doc, /fonts\.googleapis\.com\/css2\?family=Fredoka/);
	for (const f of ["components/Home/Hero.js", "components/Books/HomeBooks.js", "components/ui/Illustration.js", "pages/404.js"]) assert.ok(!/<script|src=["']https?:/.test(read(f)), f);
});

// ------------------------------------------------------------------ honest data on the home page and /books

async function world() {
	const repo = createBookRepo();
	repo._db.users.push({ id: "stu-1", email: "one@example.com", first_name: "One" });
	await seedDemo({ repo, storage: memoryStorage(), now: new Date("2026-10-20T10:00:00Z") });
	return { repo, stripe: createFakeStripe() };
}
const student = { userId: "stu-1", role: "student", name: "One" };

test("home sections only report real data: popular needs real purchases, counts match, no personal guess", async () => {
	const { repo, stripe } = await world();
	const empty = await svc.homeSections(repo, {});
	assert.deepEqual(empty.popular, [], "no sales means no popular shelf");
	assert.deepEqual(empty.recommended, [], "no age or grade means no recommendations");
	assert.equal(empty.total, 21);
	assert.equal(Object.values(empty.categoryCounts).reduce((a, b) => a + b, 0), 21);
	assert.equal(empty.categoryCounts["childrens-books"], 3);
	assert.equal(empty.categoryCounts.general, undefined, "a category with no books has no count");
	assert.equal(empty.newArrivals.length, 8);
	assert.equal(empty.featured.length, 7, "only books an administrator flagged");
	const book = repo._db.books.find((b) => b.slug === "demo-abc-adventures");
	await svc.runBookCheckout({ repo, stripe, now: Date.now() }, student, { bookId: book.id, stripeToken: "tok_a" });
	const after = await svc.homeSections(repo, {});
	assert.deepEqual(after.popular.map((b) => b.slug), ["demo-abc-adventures"], "exactly the book that was bought");
	assert.equal((await svc.homeSections(repo, { ageGroup: "preschool" })).recommended.length > 0, true);
});

test("price and language filters, language facets, and chips-friendly validation", async () => {
	const { repo } = await world();
	await repo.insertBook({ slug: "free-one", title: "A Free Story", author: "F. Writer", category: "childrens-books", subject: "english", language: "hi", price_cents: 0, status: "published", file_path: "files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf", min_age: 4, max_age: 7, created_at: new Date() });
	const free = await svc.listCatalog(repo, { price: "free" });
	assert.deepEqual(free.books.map((b) => b.slug), ["free-one"]);
	assert.equal(free.books[0].free, true);
	assert.equal((await svc.listCatalog(repo, { price: "paid", pageSize: "48" })).total, 21);
	assert.deepEqual((await svc.listCatalog(repo, { language: "hi" })).books.map((b) => b.slug), ["free-one"]);
	const r = await svc.listCatalog(repo, {});
	assert.deepEqual(r.facets.languages.map((l) => l.code), ["en", "hi"]);
	assert.equal(r.facets.languages[0].name, "English");
	// combined with age: overlap boundaries still hold (the free book is 4-7)
	assert.deepEqual((await svc.listCatalog(repo, { price: "free", age: "3" })).books, []);
	assert.equal((await svc.listCatalog(repo, { price: "free", age: "4" })).total, 1);
	assert.equal((await svc.listCatalog(repo, { price: "free", age: "7" })).total, 1);
	assert.equal((await svc.listCatalog(repo, { price: "free", age: "8" })).total, 0);
	for (const bad of [{ price: "cheap" }, { price: "FREE" }, { price: ["x"] }]) await assert.rejects(svc.listCatalog(repo, bad), (e) => e.status === 400 || bad.price[0] === "x" ? e.status === 400 : false);
});

test("administrators can preview an unpublished cover; the public cannot", async () => {
	const { repo } = await world();
	const draft = await repo.insertBook({ slug: "draft-x", title: "Draft X", author: "A", category: "general", price_cents: 0, language: "en", status: "draft", cover_path: "covers/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", cover_mime: "image/png" });
	await assert.rejects(svc.publicAsset(repo, draft.id, "cover"), { status: 404 });
	await assert.rejects(svc.publicAsset(repo, draft.id, "cover", { userId: "u", role: "student" }), { status: 404 });
	await assert.rejects(svc.publicAsset(repo, draft.id, "cover", { userId: "i", role: "instructor" }), { status: 404 });
	assert.equal((await svc.publicAsset(repo, draft.id, "cover", { userId: "a", role: "admin" })).mime, "image/png");
	const route = read("pages/api/books/[id]/cover.js");
	assert.match(route, /private, no-store/, "admin previews are never cached by shared caches");
});

// ------------------------------------------------------------------ pages keep their behaviour

test("existing behaviour is preserved by the redesign: routes, APIs and security hooks are still wired", () => {
	// books routes and server-side access
	for (const f of ["pages/books/index.js", "pages/books/[slug]/index.js", "pages/books/[slug]/checkout.js", "pages/learning/my-books/index.js", "pages/learning/my-books/read/[slug].js", "pages/admin/books/index.js", "pages/admin/books/[id].js"]) assert.ok(fs.existsSync(f), f);
	assert.match(read("pages/books/[slug]/checkout.js"), /authUrlFor\(bookCheckoutPath\(params\.slug\)\)/);
	assert.match(read("pages/learning/my-books/read/[slug].js"), /ownership\.owned/);
	assert.match(read("components/Books/PayButton.js"), /\/api\/books\/checkout/);
	assert.match(read("components/Books/PdfReader.js"), /\/api\/books\/\$\{book\.id\}\/access/);
	assert.match(read("components/Books/PdfReader.js"), /progress/);
	// the contact form still posts to the same endpoint
	assert.match(read("components/ContactUs/ContactForm.js"), /\/api\/contact/);
	// blog data and routes are unchanged
	assert.match(read("pages/blog/blogs.js"), /from "@\/utils\/sampleData"/);
	// auth redirect hardening and the login/registration forms are unchanged
	assert.match(read("utils/auth.js"), /safeNextPath/);
	for (const f of ["components/Authentication/LoginForm.js", "components/Authentication/RegisterForm.js"]) assert.match(read(f), /handleLogin/);
	// course catalogue and checkout code were not touched by the redesign
	assert.match(read("pages/courses/index.js"), /\/api\/all-courses/);
	assert.match(read("lib/payments/checkout.js"), /runCheckout/);
});
