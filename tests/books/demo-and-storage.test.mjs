// Demo catalogue + seeder, age-group boundaries, INR pricing, object storage (SigV4 + direct uploads) and the
// extended admin dashboard. In-memory repos, a fake Stripe and a fake S3 server: no database, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { createBookRepo, createFakeStripe } from "./memoryRepo.mjs";
import { memoryStorage, storageFromEnv, isStorageKey, createLocalStorage } from "../../lib/books/storage.js";
import { createS3Storage, signHeaders, EMPTY_SHA256 } from "../../lib/books/s3.js";
import * as svc from "../../lib/books/service.js";
import { DEMO_BOOKS } from "../../lib/books/demoData.js";
import { seedDemo } from "../../lib/books/demoSeed.js";
import { buildPdf, demoBookPdf, demoPreviewPdf, demoCoverSvg } from "../../lib/books/demoPdf.js";
import { sniffUpload, validateBookInput, parseTags } from "../../lib/books/validate.js";
import { matchingAgeGroups, AGE_GROUPS, isCategory, isSubject, isReadingLevel } from "../../lib/books/taxonomy.js";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const actor = (userId, role = "student") => ({ userId, role, name: userId });
const admin = actor("adm-1", "admin");
const student = actor("stu-1");
const other = actor("stu-2");

async function seeded() {
	const repo = createBookRepo();
	repo._db.users.push({ id: "stu-1", email: "one@example.com", first_name: "One" }, { id: "stu-2", email: "two@example.com", first_name: "Two" });
	const storage = memoryStorage();
	const result = await seedDemo({ repo, storage, now: new Date(NOW) });
	return { repo, storage, result, stripe: createFakeStripe() };
}
const slugs = (r) => r.books.map((b) => b.slug);
const titles = (r) => r.books.map((b) => b.title);

// ============================================================================ the 21 demo books

const EXPECTED = {
	"baby-toddler": ["My First Colors and Shapes", "Little Animals Around Me", "Tiny Hands, Big Discoveries"],
	preschool: ["ABC Adventures", "Counting with Friendly Animals", "My First Science Activity Book"],
	"young-readers": ["The Curious Math Explorer", "Amazing Science for Young Minds", "English Stories and Word Adventures"],
	"independent-readers": ["The Young Inventor's Handbook", "Mysteries of Space and Earth", "Coding Adventures for Beginners"],
	"middle-secondary": ["Mathematics Made Clear", "Foundations of Physics and Chemistry", "English Grammar and Creative Writing"],
	"senior-secondary": ["Advanced Mathematics Practice", "Biology: Life and Systems", "Computer Science and Programming Fundamentals"],
	adult: ["Practical Web Development", "Data Structures and Algorithms: A Beginner's Guide", "Engineering Mathematics Essentials"],
};

test("exactly 21 fictional demo books: three per age group, with the requested titles and stable unique slugs", () => {
	assert.equal(DEMO_BOOKS.length, 21);
	assert.equal(new Set(DEMO_BOOKS.map((b) => b.slug)).size, 21);
	for (const [group, want] of Object.entries(EXPECTED)) {
		assert.deepEqual(DEMO_BOOKS.filter((b) => b.ageGroup === group).map((b) => b.title), want, group);
	}
	for (const b of DEMO_BOOKS) assert.match(b.slug, /^demo-[a-z0-9-]+$/, "demo slugs are prefixed so they can never collide with real products by accident");
});

test("every demo record passes the same validation as an admin-entered book", () => {
	for (const b of DEMO_BOOKS) {
		const v = validateBookInput({ title: b.title, author: b.author, description: b.description, category: b.category, subject: b.subject, language: b.language, price: String(b.priceRupees), ageGroup: b.ageGroup, minAge: b.minAge, maxAge: b.maxAge, openEnded: b.maxAge >= 120, gradeMin: b.gradeMin ?? "", gradeMax: b.gradeMax ?? "", readingLevel: b.readingLevel, tags: b.tags, slug: b.slug });
		assert.ok(isCategory(v.category) && isSubject(v.subject) && isReadingLevel(v.reading_level), b.title);
		assert.ok(v.price_cents >= 5000, `${b.title}: demo price is a real, chargeable INR amount`);
		assert.ok(b.description.length > 40 && b.sample.length >= 3, b.title);
		// the primary group is consistent with the range (validated above) and the range stays in its neighbourhood
		assert.ok(matchingAgeGroups(b.minAge, b.maxAge).some((g) => g.id === b.ageGroup), b.title);
	}
	// the three oldest books have an open-ended maximum
	assert.deepEqual(DEMO_BOOKS.filter((b) => b.maxAge >= 120).map((b) => b.ageGroup), ["adult", "adult", "adult"]);
});

test("seeder creates the 21 books once, is idempotent, and never overwrites or deletes anything", async () => {
	const { repo, storage, result } = await seeded();
	assert.equal(result.created.length, 21);
	assert.equal(repo._db.books.length, 21);
	assert.ok(repo._db.books.every((b) => b.is_demo && b.status === "published" && b.file_path && b.preview_path && b.cover_url.startsWith("/images/books/demo/")));
	assert.equal(storage.files.size, 42, "one full sample and one preview per book");
	// an admin edits a demo book and unpublishes another; a REAL product occupies a demo slug
	await svc.adminUpdateBook(repo, admin, repo._db.books[0].id, { price: "777" });
	await svc.adminUpdateBook(repo, admin, repo._db.books[1].id, { status: "draft" });
	const real = repo._db.books.find((b) => b.slug === "demo-abc-adventures");
	real.is_demo = false;
	real.title = "A Real Product";
	const before = JSON.stringify(repo._db.books);
	const files = storage.files.size;
	const again = await seedDemo({ repo, storage, now: new Date(NOW + 1000) });
	assert.equal(again.created.length, 0);
	assert.equal(again.skipped.length, 20);
	assert.deepEqual(again.conflicts, ["demo-abc-adventures"]);
	assert.equal(JSON.stringify(repo._db.books), before, "no row changed");
	assert.equal(storage.files.size, files, "no file was written");
	assert.equal(repo._db.books[0].price_cents, 77700);
	assert.equal(repo._db.books[1].status, "draft");
});

test("a failed insert leaves no orphaned files", async () => {
	const repo = createBookRepo();
	const storage = memoryStorage();
	repo.insertBook = async () => {
		throw new Error("database down");
	};
	await assert.rejects(seedDemo({ repo, storage }), /database down/);
	assert.equal(storage.files.size, 0);
});

test("seeded demo books are browsable, purchasable in INR, and readable only by the buyer", async () => {
	const ctx = await seeded();
	const pub = await svc.listCatalog(ctx.repo, { pageSize: "48" });
	assert.equal(pub.total, 21);
	assert.ok(pub.books.every((b) => b.isDemo && b.currency === "inr"));
	const json = JSON.stringify(pub);
	assert.ok(!json.includes("files/") && !json.includes("file_path"));
	const book = ctx.repo._db.books.find((b) => b.slug === "demo-the-curious-math-explorer");
	const r = await svc.runBookCheckout({ repo: ctx.repo, stripe: ctx.stripe, now: NOW }, student, { bookId: book.id, stripeToken: "tok_visa", priceCents: 34900 });
	assert.equal(r.status, 200);
	assert.equal(ctx.stripe.chargeLog[0].params.currency, "inr");
	assert.equal(ctx.stripe.chargeLog[0].params.amount, 34900, "paise, from the database record");
	const access = await svc.readAccess({ repo: ctx.repo, storage: ctx.storage }, student, book.id);
	assert.deepEqual(access, { mode: "stream", url: `/api/books/${book.id}/content` });
	const bytes = await ctx.storage.get((await svc.authorizeContent(ctx.repo, student, book.id)).file_path);
	assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
	await assert.rejects(svc.readAccess({ repo: ctx.repo, storage: ctx.storage }, other, book.id), { status: 403 });
	await assert.rejects(svc.readAccess({ repo: ctx.repo, storage: ctx.storage }, null, book.id), { status: 401 });
	// the preview is public but is a different, shorter file
	const prev = await svc.publicAsset(ctx.repo, book.id, "preview");
	assert.notEqual(prev.path, book.file_path);
});

test("generated sample PDFs and covers are valid, original and small", () => {
	for (const b of DEMO_BOOKS) {
		const full = demoBookPdf(b);
		const prev = demoPreviewPdf(b);
		assert.equal(sniffUpload("file", full).mime, "application/pdf");
		assert.equal(sniffUpload("preview", prev).mime, "application/pdf");
		assert.ok(full.length < 20000 && prev.length < full.length, b.slug);
		const svg = demoCoverSvg(b);
		assert.match(svg, /^<svg /);
		assert.ok(!/<script|onload|javascript:/i.test(svg), "covers carry no script");
		// the committed cover file exists, so a fresh checkout shows covers without running anything
		assert.ok(fs.existsSync(path.resolve("public/images/books/demo", `${b.slug}.svg`)), `${b.slug}.svg`);
	}
});

test("PDF structure: every cross-reference offset points at its object and startxref points at the table", () => {
	const buf = demoBookPdf(DEMO_BOOKS[0]);
	const text = buf.toString("latin1");
	const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);
	assert.equal(text.slice(startxref, startxref + 4), "xref");
	const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
	assert.ok(entries.length >= 8);
	entries.forEach((off, i) => assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
	assert.match(text, /\/Count 4/);
	assert.ok(text.includes("(My First Colors and Shapes)"));
	// text in titles with parentheses and non-ASCII is escaped, not injected
	const odd = buildPdf("T", [{ heading: "A (b) \\ c ’ ₹", lines: ["x"] }]).toString("latin1");
	assert.ok(odd.includes("(A \\(b\\) \\\\ c ' Rs ) Tj"));
});

// ============================================================================ seven age groups

test("age-group boundaries are inclusive and consistent at 3, 6, 9, 12, 15, 18 and above", async () => {
	const { repo } = await seeded();
	const at = async (age) => svc.listCatalog(repo, { age: String(age), pageSize: "48", sort: "title" });
	const groupsOf = (age) => matchingAgeGroups(age, age).map((g) => g.id);
	assert.deepEqual(groupsOf(3), ["baby-toddler"]);
	assert.deepEqual(groupsOf(4), ["preschool"]);
	assert.deepEqual(groupsOf(6), ["preschool"]);
	assert.deepEqual(groupsOf(7), ["young-readers"]);
	assert.deepEqual(groupsOf(9), ["young-readers"]);
	assert.deepEqual(groupsOf(12), ["independent-readers"]);
	assert.deepEqual(groupsOf(15), ["middle-secondary"]);
	assert.deepEqual(groupsOf(16), ["senior-secondary"]);
	assert.deepEqual(groupsOf(18), ["senior-secondary", "adult"], "18 is in both neighbours");
	assert.deepEqual(groupsOf(19), ["adult"]);
	assert.deepEqual(groupsOf(120), ["adult"]);

	const t3 = titles(await at(3));
	for (const t of EXPECTED["baby-toddler"]) assert.ok(t3.includes(t), `age 3 shows ${t}`);
	assert.ok(t3.includes("Counting with Friendly Animals"), "3-6 spans two groups and shows at 3");
	assert.ok(!t3.includes("ABC Adventures") && !t3.includes("The Curious Math Explorer"));
	const t6 = titles(await at(6));
	assert.ok(["ABC Adventures", "Counting with Friendly Animals", "My First Science Activity Book"].every((t) => t6.includes(t)));
	assert.ok(!t6.includes("Little Animals Around Me"), "0-3 stops at 3");
	const t9 = titles(await at(9));
	assert.ok(t9.includes("Amazing Science for Young Minds") && !t9.includes("The Young Inventor's Handbook"));
	const t12 = titles(await at(12));
	assert.ok(EXPECTED["independent-readers"].every((t) => t12.includes(t)) && t12.includes("Foundations of Physics and Chemistry") === false);
	const t15 = titles(await at(15));
	assert.ok(EXPECTED["middle-secondary"].every((t) => t15.includes(t)) && t15.includes("Coding Adventures for Beginners") === false);
	const t18 = titles(await at(18));
	assert.ok([...EXPECTED["senior-secondary"], ...EXPECTED.adult].every((t) => t18.includes(t)));
	const t30 = titles(await at(30));
	assert.deepEqual(t30.sort(), [...EXPECTED.adult].sort(), "open-ended books keep matching every adult age");
	assert.deepEqual(titles(await at(120)).sort(), [...EXPECTED.adult].sort());
});

test("each age-group filter returns its three books plus books whose ranges overlap it; groups never leak into distant ones", async () => {
	const { repo } = await seeded();
	for (const g of AGE_GROUPS) {
		const r = await svc.listCatalog(repo, { ageGroup: g.id, pageSize: "48" });
		const t = titles(r);
		for (const own of EXPECTED[g.id]) assert.ok(t.includes(own), `${g.id} includes ${own}`);
		assert.ok(r.total >= 3);
	}
	assert.equal((await svc.listCatalog(repo, { ageGroup: "baby-toddler", pageSize: "48" })).total, 4, "three 0-3 books + the 3-6 counting book");
	const empty = await svc.listCatalog(repo, { ageGroup: "baby-toddler", category: "computer-science" });
	assert.equal(empty.total, 0);
	assert.deepEqual(empty.books, []);
	// grade + age + subject together
	const combo = await svc.listCatalog(repo, { ageGroup: "independent-readers", subject: "computer-science", level: "intermediate" });
	assert.deepEqual(titles(combo), ["Coding Adventures for Beginners"]);
	// tags are searchable
	assert.ok(slugs(await svc.listCatalog(repo, { q: "puzzles" })).includes("demo-the-curious-math-explorer"));
});

test("recommendations combine age, grade, subject and reading level, not age alone", async () => {
	const { repo } = await seeded();
	const home = await svc.homeSections(repo, { ageGroup: "independent-readers", grade: "6" });
	assert.ok(home.recommended.length > 0 && home.recommended.length <= 8);
	assert.ok(["The Young Inventor's Handbook", "Mysteries of Space and Earth", "Coding Adventures for Beginners"].includes(home.recommended[0].title));
	const detail = await svc.bookDetail(repo, null, "demo-coding-adventures-for-beginners");
	assert.ok(detail.related.length > 0 && !detail.related.some((b) => b.slug === "demo-coding-adventures-for-beginners"));
	assert.deepEqual(detail.book.ageGroups.map((g) => g.id), ["independent-readers", "middle-secondary"], "10-14 overlaps two groups");
	assert.equal(detail.book.isDemo, true);
	assert.deepEqual((await svc.bookDetail(repo, null, "demo-practical-web-development")).book.ageRange, "Ages 18+");
	assert.equal((await svc.homeSections(repo, {})).featured.length, 7);
});

// ============================================================================ validation: tags, open-ended, INR

test("tags, open-ended maximum age and age-group consistency are validated on the server", () => {
	assert.deepEqual(parseTags("Math, fun ,math"), ["math", "fun"]);
	assert.equal(parseTags(""), null);
	for (const bad of ["a", "x".repeat(31), "<script>", Array.from({ length: 11 }, (_, i) => `tag${i}`).join(",")]) assert.throws(() => parseTags(bad), (e) => e.status === 422, bad.slice(0, 20));
	const ok = { title: "Sample Title", author: "A", category: "science", price: "500" };
	const open = validateBookInput({ ...ok, minAge: 18, openEnded: true });
	assert.equal(open.max_age, 120);
	assert.throws(() => validateBookInput({ ...ok, openEnded: true }), (e) => e.status === 422, "an open-ended range still needs a minimum");
	assert.throws(() => validateBookInput({ ...ok, ageGroup: "baby-toddler", minAge: 10, maxAge: 12 }), (e) => e.status === 422, "group must match the range");
	assert.equal(validateBookInput({ ...ok, ageGroup: "independent-readers", minAge: 9, maxAge: 11 }).age_group, "independent-readers", "overlap is enough");
	assert.throws(() => validateBookInput({ ...ok, price: "49" }), (e) => /at least/.test(e.message));
	assert.equal(validateBookInput({ ...ok, price: "0" }).price_cents, 0);
	// is_demo / isDemo can never be set through the admin API
	assert.ok(!("is_demo" in validateBookInput({ ...ok, isDemo: true, is_demo: true })));
});

// ============================================================================ admin dashboard

test("admin overview, filters, sorting, pagination, demo labels and per-book orders", async () => {
	const ctx = await seeded();
	const real = await svc.adminCreateBook(ctx.repo, admin, { title: "Sample Real Title", author: "R. Author", category: "science", price: "250" });
	const s0 = await svc.adminListBooks(ctx.repo, admin, {});
	assert.deepEqual(s0.stats.books, { total: 22, published: 21, draft: 1, archived: 0, demo: 21 });
	assert.deepEqual(s0.stats.orders, { total: 0, paid: 0, failed: 0, pending: 0, refunded: 0 });
	assert.equal(s0.total, 22);
	assert.equal(s0.books.length, 20, "20 per page");
	assert.equal((await svc.adminListBooks(ctx.repo, admin, { page: "2" })).books.length, 2);
	assert.equal((await svc.adminListBooks(ctx.repo, admin, { demo: "no" })).books[0].id, real.book.id);
	assert.equal((await svc.adminListBooks(ctx.repo, admin, { demo: "yes", pageSize: "100" })).total, 21);
	assert.equal((await svc.adminListBooks(ctx.repo, admin, { status: "draft" })).total, 1);
	assert.equal((await svc.adminListBooks(ctx.repo, admin, { category: "computer-science", pageSize: "100" })).total, 4);
	assert.equal((await svc.adminListBooks(ctx.repo, admin, { q: "calculus-nothing" })).total, 0);
	assert.equal((await svc.adminListBooks(ctx.repo, admin, { sort: "price_desc" })).books[0].title, "Engineering Mathematics Essentials");
	const row = (await svc.adminListBooks(ctx.repo, admin, { q: "abc" })).books[0];
	for (const k of ["title", "author", "ageRange", "gradeRange", "subjectLabel", "categoryLabel", "priceCents", "format", "status", "isDemo", "sold", "coverUrl"]) assert.ok(k in row, k);
	for (const bad of [{ status: "x" }, { sort: "x" }, { demo: "maybe" }, { category: "nope" }]) await assert.rejects(svc.adminListBooks(ctx.repo, admin, bad), { status: 400 });
	for (const who of [student, actor("i", "instructor"), null]) await assert.rejects(svc.adminStats(ctx.repo, who), { status: who ? 403 : 401 });

	// orders: a paid one, a failed one; stats and the per-book filter
	const book = ctx.repo._db.books.find((b) => b.slug === "demo-abc-adventures");
	await svc.runBookCheckout({ repo: ctx.repo, stripe: ctx.stripe, now: NOW }, student, { bookId: book.id, stripeToken: "tok_a" });
	ctx.stripe.next = "decline";
	const other_ = ctx.repo._db.books.find((b) => b.slug === "demo-little-animals-around-me");
	await assert.rejects(svc.runBookCheckout({ repo: ctx.repo, stripe: ctx.stripe, now: NOW }, other, { bookId: other_.id, stripeToken: "tok_b" }), { status: 402 });
	const s1 = await svc.adminStats(ctx.repo, admin);
	assert.deepEqual(s1.orders, { total: 2, paid: 1, failed: 1, pending: 0, refunded: 0 });
	assert.equal((await svc.adminListBooks(ctx.repo, admin, { q: "abc" })).books[0].sold, 1);
	const mine = await svc.adminListOrders(ctx.repo, admin, { bookId: book.id });
	assert.equal(mine.total, 1);
	assert.equal(mine.orders[0].buyer.email, "one@example.com");
	assert.equal(mine.orders[0].book.slug, "demo-abc-adventures");
	await assert.rejects(svc.adminListOrders(ctx.repo, admin, { bookId: "x" }), { status: 400 });
	// archiving keeps purchase history and the buyer's access
	await svc.adminUpdateBook(ctx.repo, admin, book.id, { status: "archived" });
	assert.equal((await svc.authorizeContent(ctx.repo, student, book.id)).id, book.id);
	assert.equal((await svc.myBooks(ctx.repo, student)).items[0].book.slug, "demo-abc-adventures");
	assert.equal((await svc.adminListOrders(ctx.repo, admin, { bookId: book.id })).total, 1);
	// the demo flag survives edits and cannot be changed
	await svc.adminUpdateBook(ctx.repo, admin, book.id, { title: "ABC Adventures Revised", price: "300", tags: "letters, phonics", isDemo: false });
	const edited = ctx.repo._db.books.find((b) => b.id === book.id);
	assert.equal(edited.is_demo, true);
	assert.deepEqual(edited.tags, ["letters", "phonics"]);
	assert.equal(edited.price_cents, 30000);
	await assert.rejects(svc.adminUpdateBook(ctx.repo, admin, book.id, { ageGroup: "adult" }), { status: 422 }, "group no longer matches the stored 4-6 range");
	assert.equal((await svc.adminUpdateBook(ctx.repo, admin, book.id, { minAge: 4, maxAge: 8, ageGroup: "young-readers" })).book.ageGroup, "young-readers");
});

// ============================================================================ object storage

test("AWS Signature V4: matches the published AWS test vector (GET object with Range)", () => {
	const s = signHeaders({
		method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", headers: { range: "bytes=0-9" }, payloadHash: EMPTY_SHA256,
		region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", now: new Date("2013-05-24T00:00:00Z"),
	});
	assert.equal(s.signedHeaders, "host;range;x-amz-content-sha256;x-amz-date");
	assert.equal(s.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

// A tiny S3: path-style, PUT/GET(Range)/HEAD/DELETE, requires an Authorization header.
function fakeS3() {
	const objects = new Map();
	const calls = [];
	const res = (status, body = Buffer.alloc(0), headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) });
	const fetchImpl = async (url, init = {}) => {
		const u = new URL(url);
		calls.push({ method: init.method, url, headers: init.headers });
		if (!/^AWS4-HMAC-SHA256 /.test((init.headers || {}).Authorization || "")) return res(403);
		const key = decodeURIComponent(u.pathname);
		if (init.method === "PUT") return objects.set(key, Buffer.from(init.body)) && res(200);
		if (!objects.has(key)) return res(404);
		const buf = objects.get(key);
		if (init.method === "DELETE") return objects.delete(key) && res(204);
		if (init.method === "HEAD") return res(200, Buffer.alloc(0), { "content-length": String(buf.length) });
		const range = /bytes=(\d+)-(\d+)/.exec((init.headers || {}).range || "");
		return range ? res(206, buf.subarray(Number(range[1]), Number(range[2]) + 1)) : res(200, buf);
	};
	return { objects, calls, fetchImpl };
}
const s3cfg = { endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "books", region: "auto", accessKeyId: "AKID", secretAccessKey: "SECRET" };

test("S3 driver: put/get/range/head/remove sign every request, and presigned URLs are short-lived and bound to the content type", async () => {
	const fake = fakeS3();
	const t = new Date("2026-10-20T10:00:00Z");
	const s3 = createS3Storage({ ...s3cfg, fetchImpl: fake.fetchImpl, now: () => t });
	const key = await s3.put("files", "pdf", Buffer.from("%PDF-1.4 hello world"));
	assert.ok(isStorageKey(key));
	assert.ok(fake.objects.has(`/books/${key}`), "path-style bucket/key");
	assert.equal((await s3.get(key)).toString(), "%PDF-1.4 hello world");
	assert.equal((await s3.getRange(key, 0, 4)).toString(), "%PDF-");
	assert.deepEqual(await s3.head(key), { size: 20 });
	assert.equal(await s3.head("files/ffffffffffffffffffffffffffffffff.pdf"), null);
	await assert.rejects(s3.get("files/ffffffffffffffffffffffffffffffff.pdf"), { code: "ENOENT" });
	assert.ok(fake.calls.every((c) => /Credential=AKID\/20261020\/auto\/s3\/aws4_request/.test(c.headers.Authorization)));
	const get = new URL(await s3.presignGet(key, { ttl: 120 }));
	assert.equal(get.searchParams.get("X-Amz-Expires"), "120");
	assert.equal(get.searchParams.get("X-Amz-SignedHeaders"), "host");
	assert.match(get.searchParams.get("X-Amz-Signature"), /^[0-9a-f]{64}$/);
	assert.ok(!get.toString().includes("SECRET"));
	const put = new URL(await s3.presignPut(key, { contentType: "application/pdf", ttl: 300 }));
	assert.equal(put.searchParams.get("X-Amz-SignedHeaders"), "content-type;host", "the upload type is part of the signature");
	const other = new URL(await s3.presignPut(key, { contentType: "image/png", ttl: 300 }));
	assert.notEqual(put.searchParams.get("X-Amz-Signature"), other.searchParams.get("X-Amz-Signature"));
	await s3.remove(key);
	assert.equal(fake.objects.size, 0);
	assert.throws(() => createS3Storage({ endpoint: "x" }), /not fully configured/);
});

test("storage selection: S3 when configured, local on a server, and a clear refusal on Vercel without a bucket", async () => {
	const full = { BOOK_S3_ENDPOINT: "https://x.example.com", BOOK_S3_BUCKET: "b", BOOK_S3_ACCESS_KEY_ID: "a", BOOK_S3_SECRET_ACCESS_KEY: "s" };
	assert.equal(storageFromEnv(full).kind, "s3");
	assert.equal(storageFromEnv({ ...full, VERCEL: "1" }).kind, "s3");
	assert.equal(storageFromEnv({}).kind, "local");
	assert.equal(storageFromEnv({ VERCEL: "1" }).kind, "none");
	assert.equal(storageFromEnv({ VERCEL: "1", BOOK_S3_BUCKET: "b" }).kind, "none", "a partial configuration is not used");
	const none = storageFromEnv({ VERCEL: "1" });
	for (const op of [() => none.put("files", "pdf", Buffer.from("x")), () => none.get("files/00000000000000000000000000000000.pdf")]) await assert.rejects(op(), { status: 503, code: "storage_not_configured" });
	// uploading on Vercel without storage fails clearly instead of writing to an ephemeral disk
	const repo = createBookRepo();
	const b = await repo.insertBook({ slug: "x", title: "X", author: "A", category: "general", price_cents: 0, language: "en" });
	await assert.rejects(svc.adminUpload({ repo, storage: none }, admin, b.id, { kind: "cover", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64") }), { status: 503 });
	// no credentials ever appear in the public key shape
	assert.ok(!isStorageKey("https://bucket.s3.amazonaws.com/files/x.pdf"));
});

test("direct-to-storage uploads: init -> signed PUT -> server inspects the object -> attach; invalid objects are deleted", async () => {
	const fake = fakeS3();
	const storage = createS3Storage({ ...s3cfg, fetchImpl: fake.fetchImpl });
	const repo = createBookRepo();
	const book = await repo.insertBook({ slug: "x", title: "X", author: "A", category: "general", price_cents: 0, language: "en" });
	const up = (input, who = admin) => svc.adminUpload({ repo, storage }, who, book.id, input);

	// who and what may start an upload
	for (const who of [student, actor("i", "instructor"), null]) await assert.rejects(up({ kind: "file", mode: "init", size: 10, contentType: "application/pdf" }, who), { status: who ? 403 : 401 });
	await assert.rejects(up({ kind: "file", mode: "init", size: 10, contentType: "text/html" }), { status: 422 });
	await assert.rejects(up({ kind: "file", mode: "init", size: 21 * 1024 * 1024, contentType: "application/pdf" }), { status: 422 });
	await assert.rejects(up({ kind: "cover", mode: "init", size: 3 * 1024 * 1024, contentType: "image/png" }), { status: 422 });
	await assert.rejects(up({ kind: "cover", mode: "init", size: 100, contentType: "application/pdf" }), { status: 422 });
	await assert.rejects(up({ kind: "file", data: "AAAA" }), { status: 422 }, "the base64 path is closed when direct uploads are on");

	const plan = await up({ kind: "file", mode: "init", size: 40, contentType: "application/pdf" });
	assert.equal(plan.mode, "direct");
	assert.match(plan.key, /^files\/[0-9a-f]{32}\.pdf$/);
	assert.deepEqual(plan.headers, { "Content-Type": "application/pdf" });
	assert.match(plan.url, /X-Amz-Signature=/);
	// nothing is attached until the object exists AND passes inspection
	await assert.rejects(up({ kind: "file", mode: "complete", key: plan.key }), { status: 422 });
	fake.objects.set(`/books/${plan.key}`, Buffer.from("%PDF-1.4\nsample\n%%EOF"));
	const done = await up({ kind: "file", mode: "complete", key: plan.key });
	assert.equal(done.book.hasFile, true);
	assert.equal(repo._db.books[0].file_path, plan.key);
	assert.equal(repo._db.books[0].file_size, 21);

	// a disguised file is deleted and refused
	const evil = await up({ kind: "file", mode: "init", size: 30, contentType: "application/pdf" });
	fake.objects.set(`/books/${evil.key}`, Buffer.from("MZ\x90 this is an executable"));
	await assert.rejects(up({ kind: "file", mode: "complete", key: evil.key }), { status: 422 });
	assert.equal(fake.objects.has(`/books/${evil.key}`), false, "invalid object removed");
	assert.equal(repo._db.books[0].file_path, plan.key, "book unchanged");
	// an oversize object (the signed PUT cannot cap size) is deleted
	const big = await up({ kind: "file", mode: "init", size: 100, contentType: "application/pdf" });
	fake.objects.set(`/books/${big.key}`, Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(21 * 1024 * 1024)]));
	await assert.rejects(up({ kind: "file", mode: "complete", key: big.key }), { status: 422 });
	assert.equal(fake.objects.has(`/books/${big.key}`), false);
	// keys must be well-formed and belong to the right folder
	for (const key of ["../x", "covers/00000000000000000000000000000000.png", "files/zz.pdf", null]) await assert.rejects(up({ kind: "file", mode: "complete", key }), { status: 422 }, String(key));
	// replacing the file removes the old object
	const second = await up({ kind: "file", mode: "init", size: 30, contentType: "application/pdf" });
	fake.objects.set(`/books/${second.key}`, Buffer.from("%PDF-1.7\nnew"));
	await up({ kind: "file", mode: "complete", key: second.key });
	assert.equal(fake.objects.has(`/books/${plan.key}`), false);
	assert.equal(repo._db.books[0].file_path, second.key);
	// covers go through the same checks
	const c = await up({ kind: "cover", mode: "init", size: 20, contentType: "image/png" });
	fake.objects.set(`/books/${c.key}`, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(12)]));
	assert.equal((await up({ kind: "cover", mode: "complete", key: c.key })).book.hasCover, true);
	assert.equal(repo._db.books[0].cover_mime, "image/png");
});

test("local storage keeps the base64 upload path; init reports it", async () => {
	const repo = createBookRepo();
	const book = await repo.insertBook({ slug: "x", title: "X", author: "A", category: "general", price_cents: 0, language: "en" });
	const storage = memoryStorage();
	assert.deepEqual(await svc.adminUpload({ repo, storage }, admin, book.id, { kind: "file", mode: "init", size: 5, contentType: "application/pdf" }), { mode: "server" });
	await assert.rejects(svc.adminUpload({ repo, storage }, admin, book.id, { kind: "file", mode: "complete", key: "files/00000000000000000000000000000000.pdf" }), { status: 422 });
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "book-local-"));
	try {
		const local = createLocalStorage(dir);
		assert.equal(local.kind, "local");
		assert.equal(local.presignGet, undefined);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("signed read access: only an owner (or admin) gets a signed URL, which expires in two minutes", async () => {
	const fake = fakeS3();
	const storage = createS3Storage({ ...s3cfg, fetchImpl: fake.fetchImpl });
	const repo = createBookRepo();
	repo._db.users.push({ id: "stu-1", email: "one@example.com" });
	const key = await storage.put("files", "pdf", Buffer.from("%PDF-1.4 secret"));
	const book = await repo.insertBook({ slug: "x", title: "X", author: "A", category: "general", price_cents: 10000, language: "en", status: "published", file_path: key, file_mime: "application/pdf" });
	const stripe = createFakeStripe();
	await assert.rejects(svc.readAccess({ repo, storage }, student, book.id), { status: 403 });
	await svc.runBookCheckout({ repo, stripe, now: NOW }, student, { bookId: book.id, stripeToken: "tok_x" });
	const a = await svc.readAccess({ repo, storage }, student, book.id);
	assert.equal(a.mode, "signed");
	assert.equal(a.expiresIn, 120);
	assert.equal(new URL(a.url).searchParams.get("X-Amz-Expires"), "120");
	assert.ok(a.url.includes(`/books/${key}`));
	await assert.rejects(svc.readAccess({ repo, storage }, other, book.id), { status: 403 });
	assert.equal((await svc.readAccess({ repo, storage }, admin, book.id)).mode, "signed");
	// the public book payload never contains the key or a storage URL
	const pub = JSON.stringify(await svc.bookDetail(repo, null, "x"));
	assert.ok(!pub.includes(key) && !pub.includes("r2.cloudflarestorage"));
});

// ============================================================================ deployment safety

test("the demo seeder refuses to run in production and is not part of any automatic script", () => {
	const script = path.resolve("scripts/books/seed-demo.mjs");
	for (const env of [{ NODE_ENV: "production" }, { VERCEL: "1" }]) {
		let out = "";
		let code = 0;
		try {
			execFileSync(process.execPath, [script], { env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe" });
		} catch (e) {
			code = e.status;
			out = String(e.stderr);
		}
		assert.equal(code, 1);
		assert.match(out, /production environment/);
	}
	const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
	assert.equal(pkg.scripts["seed:books-demo"], "env-cmd node scripts/books/seed-demo.mjs");
	for (const name of ["build", "start", "dev", "migrate", "seed", "test"]) assert.ok(!/seed-demo/.test(pkg.scripts[name]), name);
	const src = fs.readFileSync(script, "utf8");
	assert.match(src, /same as the production database/);
	assert.ok(!/DELETE|DROP|TRUNCATE|UPDATE /.test(src.replace(/\/\/.*$/gm, "")), "the script only inserts");
	// no seeder file for sequelize-cli db:seed:all would run it automatically
	assert.ok(!fs.readdirSync("database/seeders").some((f) => /book/i.test(f)));
});

test("INR is the only currency used by the bookstore service and course checkout is unchanged", () => {
	const svcSrc = fs.readFileSync("lib/books/service.js", "utf8");
	assert.match(svcSrc, /CURRENCY = "inr"/);
	assert.ok(!/"usd"/.test(svcSrc));
	assert.match(fs.readFileSync("lib/payments/checkout.js", "utf8"), /currency: "usd"/, "course purchases still charge in USD, untouched");
	assert.equal(createHash("sha256").update("").digest("hex"), EMPTY_SHA256);
});
