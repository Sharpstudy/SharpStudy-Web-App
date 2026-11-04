// Bookstore: catalogue, age/grade discovery, purchase + webhook idempotency, access control, admin.
// In-memory repositories and a fake Stripe only: no database, no network, no real charge.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createBookRepo, createFakeStripe } from "./memoryRepo.mjs";
import { memoryStorage } from "../../lib/books/storage.js";
import * as svc from "../../lib/books/service.js";
import { parseCatalogQuery, applyFilter, matchesAge, recommend, relatedTo } from "../../lib/books/catalog.js";
import { parsePriceCents, validateBookInput, sniffUpload } from "../../lib/books/validate.js";
import { AGE_GROUPS } from "../../lib/books/taxonomy.js";
import { safeNextPath, authUrlFor, bookCheckoutPath } from "../../lib/books/redirect.js";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const actor = (userId, role = "student") => ({ userId, role, name: userId });
const student = actor("stu-1");
const other = actor("stu-2");
const instructor = actor("inst-1", "instructor");
const admin = actor("adm-1", "admin");
const TOKEN = "tok_visa123";

const book = (o) => ({ status: "published", featured: false, language: "en", price_cents: 999, category: "general", cover_url: "https://img.example/c.png", file_path: "files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf", file_mime: "application/pdf", created_at: "2026-09-01T00:00:00Z", ...o });

// Clearly fictional sample titles - not real products or real prices.
function seed() {
	const repo = createBookRepo();
	repo._db.users.push(
		{ id: "stu-1", email: "one@example.com", first_name: "One", role: "student" },
		{ id: "stu-2", email: "two@example.com", first_name: "Two", role: "student" }
	);
	const add = async (o) => repo.insertBook(book(o));
	return {
		repo,
		add,
		async all() {
			return {
				toddler: await add({ slug: "sample-bedtime-shapes", title: "Sample Bedtime Shapes", author: "A. Writer", category: "childrens-books", subject: "general", age_group: "baby-toddler", min_age: 0, max_age: 3, grade_min: -1, grade_max: -1, reading_level: "pre-reader", price_cents: 499, created_at: "2026-09-02T00:00:00Z" }),
				preschool: await add({ slug: "sample-counting-farm", title: "Sample Counting Farm", author: "B. Author", category: "mathematics", subject: "math", age_group: "preschool", min_age: 4, max_age: 6, grade_min: -1, grade_max: 0, reading_level: "beginner", featured: true, price_cents: 599, created_at: "2026-09-03T00:00:00Z" }),
				// spans two groups on purpose
				span: await add({ slug: "sample-number-quest", title: "Sample Number Quest", author: "C. Author", category: "mathematics", subject: "math", age_group: "young-readers", min_age: 6, max_age: 10, grade_min: 1, grade_max: 5, reading_level: "beginner", price_cents: 899, created_at: "2026-09-04T00:00:00Z" }),
				science: await add({ slug: "sample-rocket-lab", title: "Sample Rocket Lab", author: "D. Scientist", category: "science", subject: "science", age_group: "independent-readers", min_age: 10, max_age: 12, grade_min: 5, grade_max: 7, reading_level: "intermediate", price_cents: 1299, created_at: "2026-09-05T00:00:00Z" }),
				code: await add({ slug: "sample-python-start", title: "Sample Python Start", author: "E. Coder", category: "computer-science", subject: "computer-science", age_group: "middle-secondary", min_age: 13, max_age: 18, grade_min: 8, grade_max: 12, reading_level: "intermediate", price_cents: 1999, created_at: "2026-09-06T00:00:00Z" }),
				adult: await add({ slug: "sample-exam-guide", title: "Sample Exam Guide", author: "F. Tutor", category: "competitive-exams", subject: "test-prep", age_group: "adult", min_age: 18, max_age: 120, grade_min: 13, grade_max: 13, reading_level: "advanced", price_cents: 2999, created_at: "2026-09-07T00:00:00Z" }),
				allAges: await add({ slug: "sample-all-ages", title: "Sample All Ages Almanac", author: "G. Editor", category: "general", price_cents: 0, created_at: "2026-09-08T00:00:00Z" }),
				draft: await add({ slug: "sample-draft", title: "Sample Draft", author: "H. Hidden", status: "draft", min_age: 0, max_age: 120 }),
				archived: await add({ slug: "sample-archived", title: "Sample Archived", author: "I. Old", status: "archived", min_age: 0, max_age: 120 }),
			};
		},
	};
}
const slugs = (r) => r.books.map((b) => b.slug);
const checkout = (ctx, who, body, now = NOW) => svc.runBookCheckout({ repo: ctx.repo, stripe: ctx.stripe, now }, who, body);

// ============================================================================ catalogue

test("public catalogue lists only published books, paginated, without private fields", async () => {
	const { repo, all } = seed();
	await all();
	const r = await svc.listCatalog(repo, {});
	assert.equal(r.total, 7);
	assert.ok(!slugs(r).includes("sample-draft") && !slugs(r).includes("sample-archived"));
	const json = JSON.stringify(r);
	assert.ok(!json.includes("file_path") && !json.includes("files/aaaa") && !json.includes("external_url"), "no storage keys or reading links");
	const p1 = await svc.listCatalog(repo, { pageSize: "3" });
	assert.equal(p1.books.length, 3);
	assert.equal(p1.pages, 3);
	assert.equal((await svc.listCatalog(repo, { pageSize: "3", page: "3" })).books.length, 1);
	assert.equal((await svc.listCatalog(repo, { pageSize: "3", page: "99" })).page, 3, "out-of-range pages clamp");
});

test("search by title, author, subject or category; every word must match", async () => {
	const { repo, all } = seed();
	await all();
	assert.deepEqual(slugs(await svc.listCatalog(repo, { q: "rocket" })), ["sample-rocket-lab"]);
	assert.deepEqual(slugs(await svc.listCatalog(repo, { q: "coder" })), ["sample-python-start"]);
	assert.deepEqual(slugs(await svc.listCatalog(repo, { q: "test preparation" })), ["sample-exam-guide"], "subject label");
	assert.deepEqual((await svc.listCatalog(repo, { q: "Computer Science" })).books.map((b) => b.slug), ["sample-python-start"], "category label");
	assert.deepEqual(slugs(await svc.listCatalog(repo, { q: "rocket python" })), [], "all words must match");
	assert.equal((await svc.listCatalog(repo, { q: "zzzz" })).total, 0, "empty results are a normal answer");
	assert.equal((await svc.listCatalog(repo, { q: "ROCKET" })).total, 1, "case-insensitive");
});

test("category, subject, language, reading level and sort filters", async () => {
	const { repo, all } = seed();
	await all();
	assert.deepEqual(slugs(await svc.listCatalog(repo, { category: "mathematics", sort: "title" })), ["sample-counting-farm", "sample-number-quest"]);
	assert.deepEqual(slugs(await svc.listCatalog(repo, { subject: "science" })), ["sample-rocket-lab"]);
	assert.equal((await svc.listCatalog(repo, { language: "hi" })).total, 0);
	assert.deepEqual(slugs(await svc.listCatalog(repo, { level: "advanced" })), ["sample-exam-guide"]);
	assert.equal((await svc.listCatalog(repo, { sort: "price_asc" })).books[0].slug, "sample-all-ages");
	assert.equal((await svc.listCatalog(repo, { sort: "price_desc" })).books[0].slug, "sample-exam-guide");
	assert.equal((await svc.listCatalog(repo, { sort: "newest" })).books[0].slug, "sample-all-ages");
});

test("manipulated or malformed query parameters are rejected, never silently widened", async () => {
	const { repo } = seed();
	const bad = [{ category: "nope" }, { subject: "x" }, { ageGroup: "toddlers" }, { age: "-1" }, { age: "999" }, { age: "7.5" }, { grade: "14" }, { grade: "abc" }, { level: "x" }, { language: "english" }, { sort: "price; DROP TABLE books" }, { page: "0" }, { page: "-2" }, { pageSize: "1000" }, { pageSize: "0" }, { q: "x".repeat(81) }];
	for (const q of bad) await assert.rejects(svc.listCatalog(repo, q), (e) => e.status === 400, JSON.stringify(q));
	// array / object injection takes the first plain value or is refused
	assert.doesNotThrow(() => parseCatalogQuery({ category: ["science", "mathematics"] }));
	assert.equal(parseCatalogQuery({ category: ["science", "mathematics"] }).category, "science");
});

// ============================================================================ age + grade discovery

test("age groups: each group returns the books whose age range overlaps it (books can span groups)", async () => {
	const { repo, all } = seed();
	await all();
	const g = async (id) => slugs(await svc.listCatalog(repo, { ageGroup: id, sort: "title" }));
	// the all-ages book (no range) is never hidden by an age filter
	assert.deepEqual(await g("baby-toddler"), ["sample-all-ages", "sample-bedtime-shapes"]);
	assert.deepEqual(await g("preschool"), ["sample-all-ages", "sample-counting-farm", "sample-number-quest"], "6-10 overlaps 4-6 at age 6");
	assert.deepEqual(await g("young-readers"), ["sample-all-ages", "sample-number-quest"]);
	assert.deepEqual(await g("independent-readers"), ["sample-all-ages", "sample-number-quest", "sample-rocket-lab"], "6-10 overlaps 10-12 at 10");
	assert.deepEqual(await g("middle-secondary"), ["sample-all-ages", "sample-python-start"]);
	assert.deepEqual(await g("senior-secondary"), ["sample-all-ages", "sample-exam-guide", "sample-python-start"], "18 belongs to both senior secondary and 18+");
	assert.deepEqual(await g("adult"), ["sample-all-ages", "sample-exam-guide", "sample-python-start"]);
});

test("age boundaries are inclusive and exact ages overlap ranges", () => {
	const b = { min_age: 7, max_age: 9 };
	for (const [age, want] of [[6, false], [7, true], [8, true], [9, true], [10, false]]) assert.equal(matchesAge(b, [age, age]), want, String(age));
	assert.equal(matchesAge({ min_age: null, max_age: null }, [3, 3]), true);
	assert.equal(matchesAge(b, null), true);
	assert.equal(AGE_GROUPS.length, 7);
});

test("exact age and grade filters; grade requires a stated grade range", async () => {
	const { repo, all } = seed();
	await all();
	assert.deepEqual(slugs(await svc.listCatalog(repo, { age: "8", sort: "title" })), ["sample-all-ages", "sample-number-quest"]);
	assert.deepEqual(slugs(await svc.listCatalog(repo, { grade: "6", sort: "title" })), ["sample-rocket-lab"]);
	assert.deepEqual(slugs(await svc.listCatalog(repo, { grade: "5", sort: "title" })), ["sample-number-quest", "sample-rocket-lab"], "grade ranges overlap at 5");
	assert.deepEqual(slugs(await svc.listCatalog(repo, { grade: "-1" })).sort(), ["sample-bedtime-shapes", "sample-counting-farm"].sort(), "Pre-K");
	assert.deepEqual(slugs(await svc.listCatalog(repo, { ageGroup: "preschool", grade: "0", sort: "title" })), ["sample-counting-farm"], "filters combine");
	const none = await svc.listCatalog(repo, { ageGroup: "baby-toddler", subject: "science" });
	assert.equal(none.total, 0);
	assert.deepEqual(none.books, [], "empty result keeps the shape");
});

test("recommendations use age and grade but also subject and category, and never include the book itself", async () => {
	const { repo, all } = seed();
	const b = await all();
	const published = await repo.listPublishedBooks();
	const rec = recommend(published, { window: [4, 6], grade: 0, subject: "math" }, { limit: 3 });
	assert.equal(rec[0].slug, "sample-counting-farm", "best fit first");
	assert.ok(rec.every((x) => x.status === "published"));
	const rel = relatedTo(published.find((x) => x.id === b.span.id), published);
	assert.ok(!rel.some((x) => x.id === b.span.id), "never itself");
	assert.ok(rel.map((x) => x.slug).includes("sample-counting-farm"), "same subject and overlapping ages");
	assert.ok(!rel.map((x) => x.slug).includes("sample-draft"));
	// a book outside the exact age band can still be related by subject
	const farm = relatedTo(published.find((x) => x.id === b.preschool.id), published);
	assert.ok(farm.map((x) => x.slug).includes("sample-number-quest"));
	const home = await svc.homeSections(repo, { ageGroup: "preschool" });
	assert.equal(home.recommended[0].slug, "sample-counting-farm");
	assert.deepEqual(home.featured.map((x) => x.slug), ["sample-counting-farm"]);
	assert.ok(home.newArrivals.length > 0);
	assert.deepEqual(home.popular, [], "popular is real: with no purchases there is nothing to call popular");
	await assert.rejects(svc.homeSections(repo, { ageGroup: "bogus" }), { status: 400 });
});

test("book details expose age group, range, grade, subject and reading level", async () => {
	const { repo, all } = seed();
	await all();
	const d = await svc.bookDetail(repo, null, "sample-number-quest");
	assert.equal(d.book.ageRange, "Ages 6–10");
	assert.equal(d.book.ageGroupLabel, "Young Readers");
	assert.equal(d.book.gradeRange, "Grade 1 – Grade 5");
	assert.equal(d.book.subjectLabel, "Mathematics");
	assert.equal(d.book.readingLevelLabel, "Beginner");
	assert.equal((await svc.bookDetail(repo, null, "sample-all-ages")).book.ageRange, "All ages");
	assert.ok(d.related.length > 0 && !d.related.some((x) => x.slug === "sample-number-quest"));
	assert.deepEqual(d.ownership, { owned: false, pending: false, purchasedAt: null });
});

test("unpublished books do not exist for the public (an admin may preview)", async () => {
	const { repo, all } = seed();
	await all();
	for (const slug of ["sample-draft", "sample-archived", "missing"]) await assert.rejects(svc.bookDetail(repo, student, slug), { status: 404 });
	assert.equal((await svc.bookDetail(repo, admin, "sample-draft")).book.status, "draft");
});

// ============================================================================ purchase

function shop() {
	const ctx = seed();
	ctx.stripe = createFakeStripe();
	return ctx;
}

test("signed-out buyers are refused; the book id must be valid and published", async () => {
	const ctx = shop();
	const b = await ctx.all();
	await assert.rejects(checkout(ctx, null, { bookId: b.span.id, stripeToken: TOKEN }), { status: 401 });
	await assert.rejects(checkout(ctx, student, { bookId: "not-a-uuid", stripeToken: TOKEN }), { status: 422 });
	await assert.rejects(checkout(ctx, student, { bookId: b.draft.id, stripeToken: TOKEN }), { status: 404 });
	await assert.rejects(checkout(ctx, student, {}), { status: 422 });
	assert.equal(ctx.stripe.chargeLog.length, 0);
});

test("a successful payment is verified, recorded once, and grants access", async () => {
	const ctx = shop();
	const b = await ctx.all();
	const r = await checkout(ctx, student, { slug: b.span.slug, stripeToken: TOKEN });
	assert.equal(r.status, 200);
	assert.equal(ctx.stripe.chargeLog.length, 1);
	assert.equal(ctx.stripe.chargeLog[0].params.amount, 899, "charged the server price in cents");
	assert.equal(ctx.stripe.chargeLog[0].params.metadata.userId, "stu-1");
	assert.equal(ctx.repo._db.orders.filter((o) => o.status === "paid").length, 1);
	const content = await svc.authorizeContent(ctx.repo, student, b.span.id);
	assert.equal(content.id, b.span.id);
	const mine = await svc.myBooks(ctx.repo, student);
	assert.deepEqual(mine.items.map((i) => i.book.slug), ["sample-number-quest"]);
	assert.equal((await svc.bookDetail(ctx.repo, student, b.span.slug)).ownership.owned, true);
});

test("client-supplied prices and payment flags are never trusted", async () => {
	const ctx = shop();
	const b = await ctx.all();
	await assert.rejects(checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN, priceCents: 1 }), { status: 422, code: "price_changed" });
	assert.equal(ctx.stripe.chargeLog.length, 0);
	// extra fields such as price / paid / status / amount are ignored
	const r = await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN, price: 0, paid: true, status: "paid", amount: 1, user_id: "stu-2", userId: "stu-2" });
	assert.equal(r.status, 200);
	assert.equal(ctx.stripe.chargeLog[0].params.amount, 899);
	assert.equal(ctx.repo._db.orders[0].user_id, "stu-1");
	assert.equal(ctx.repo._db.orders[0].amount_cents, 899);
	// no token and a malformed token never charge
	await assert.rejects(checkout(ctx, other, { bookId: b.science.id }), { status: 422, code: "payment_required" });
	await assert.rejects(checkout(ctx, other, { bookId: b.science.id, stripeToken: "' OR 1=1 --" }), { status: 422 });
	assert.equal(ctx.stripe.chargeLog.length, 1);
	assert.equal(await svc.authorizeContent(ctx.repo, other, b.science.id).catch((e) => e.status), 403);
});

test("declined, errored and under-paid charges grant nothing", async () => {
	const ctx = shop();
	const b = await ctx.all();
	for (const [mode, status, code] of [["decline", 402, "card_declined"], ["error", 502, "payment_error"], ["underpay", 402, "payment_failed"]]) {
		ctx.stripe.next = mode;
		await assert.rejects(checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN }), { status, code }, mode);
	}
	assert.equal(ctx.repo._db.orders.filter((o) => o.status === "paid").length, 0);
	assert.deepEqual(ctx.repo._db.orders.map((o) => o.status), ["failed", "failed", "failed"]);
	await assert.rejects(svc.authorizeContent(ctx.repo, student, b.span.id), { status: 403 });
	assert.equal((await svc.myBooks(ctx.repo, student)).total, 0);
	// the failures are visible in the buyer history and for admins
	assert.equal((await svc.myOrders(ctx.repo, student)).orders.length, 3);
	assert.equal((await svc.adminListOrders(ctx.repo, admin, { status: "failed" })).total, 3);
	// a later successful attempt works
	ctx.stripe.next = "succeed";
	assert.equal((await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN })).status, 200);
});

test("without Stripe configured nothing is granted for a priced book; free books need no payment", async () => {
	const ctx = shop();
	const b = await ctx.all();
	ctx.stripe = null;
	await assert.rejects(checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN }), { status: 503 });
	assert.equal((await svc.myBooks(ctx.repo, student)).total, 0);
	const free = await checkout(ctx, student, { bookId: b.allAges.id });
	assert.equal(free.status, 200);
	assert.equal(free.body.charged, 0);
	assert.equal((await svc.myBooks(ctx.repo, student)).total, 1);
});

test("a pending charge grants nothing until the webhook confirms it, and a second attempt does not charge again", async () => {
	const ctx = shop();
	const b = await ctx.all();
	ctx.stripe.next = "pending";
	const r = await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN });
	assert.equal(r.status, 202);
	await assert.rejects(svc.authorizeContent(ctx.repo, student, b.span.id), { status: 403 });
	ctx.stripe.next = "succeed";
	const again = await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN });
	assert.equal(again.status, 202, "still processing: no second charge");
	assert.equal(ctx.stripe.chargeLog.length, 1);
	assert.equal((await svc.bookDetail(ctx.repo, student, b.span.slug)).ownership.pending, true);

	const order = ctx.repo._db.orders[0];
	const event = (type, over = {}) => ({ type, data: { object: { id: order.stripe_charge_id, status: "succeeded", paid: true, amount: order.amount_cents, currency: "inr", refunded: false, metadata: { kind: "book", orderId: order.id, userId: "stu-1", bookId: b.span.id }, ...over } } });
	const h = (e) => svc.handleStripeEvent({ repo: ctx.repo, stripe: ctx.stripe, now: NOW }, e);
	// a forged amount or a different buyer in the event is ignored
	assert.equal((await h(event("charge.succeeded", { amount: 1 }))).ignored, "mismatch");
	assert.equal((await h(event("charge.succeeded", { metadata: { kind: "book", orderId: order.id, userId: "stu-2", bookId: b.span.id } }))).ignored, "mismatch");
	await assert.rejects(svc.authorizeContent(ctx.repo, student, b.span.id), { status: 403 });
	// the genuine event grants access - and replaying it any number of times changes nothing
	assert.equal((await h(event("charge.succeeded"))).granted, true);
	for (let i = 0; i < 4; i++) assert.equal((await h(event("charge.succeeded"))).duplicate, true);
	assert.equal(ctx.repo._db.orders.filter((o) => o.status === "paid").length, 1);
	assert.equal(ctx.repo._db.orders.length, 1);
	assert.equal(ctx.stripe.refundLog.length, 0);
	assert.equal((await svc.authorizeContent(ctx.repo, student, b.span.id)).id, b.span.id);
});

test("duplicate webhook after a synchronous success, and other accounts' events, are harmless", async () => {
	const ctx = shop();
	const b = await ctx.all();
	await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN });
	const order = ctx.repo._db.orders[0];
	const ev = { type: "charge.succeeded", data: { object: { id: order.stripe_charge_id, status: "succeeded", paid: true, amount: 899, currency: "usd", metadata: { kind: "book", orderId: order.id, userId: "stu-1", bookId: b.span.id } } } };
	for (let i = 0; i < 3; i++) await svc.handleStripeEvent({ repo: ctx.repo, stripe: ctx.stripe }, ev);
	assert.equal(ctx.repo._db.orders.filter((o) => o.status === "paid").length, 1);
	// course payments on the same Stripe account are not ours
	assert.deepEqual(await svc.handleStripeEvent({ repo: ctx.repo, stripe: ctx.stripe }, { type: "charge.succeeded", data: { object: { id: "ch_x", metadata: { courseIds: "a,b" } } } }), { handled: false });
	assert.deepEqual(await svc.handleStripeEvent({ repo: ctx.repo, stripe: ctx.stripe }, { type: "charge.succeeded", data: { object: { id: "ch_x", metadata: { kind: "book", orderId: "5c9b8b8e-0000-4000-8000-000000000000" } } } }), { handled: false });
});

test("failed and refunded events: failure keeps access off, a refund revokes it", async () => {
	const ctx = shop();
	const b = await ctx.all();
	ctx.stripe.next = "pending";
	await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN });
	const order = ctx.repo._db.orders[0];
	const meta = { kind: "book", orderId: order.id, userId: "stu-1", bookId: b.span.id };
	await svc.handleStripeEvent({ repo: ctx.repo, stripe: ctx.stripe }, { type: "charge.failed", data: { object: { id: order.stripe_charge_id, failure_code: "card_declined", metadata: meta } } });
	assert.equal(ctx.repo._db.orders[0].status, "failed");
	await assert.rejects(svc.authorizeContent(ctx.repo, student, b.span.id), { status: 403 });
	// the student retries and pays; later Stripe refunds it
	ctx.stripe.next = "succeed";
	await checkout(ctx, student, { bookId: b.span.id, stripeToken: "tok_second" });
	assert.equal((await svc.authorizeContent(ctx.repo, student, b.span.id)).id, b.span.id);
	const paid = ctx.repo._db.orders.find((o) => o.status === "paid");
	const refunded = { type: "charge.refunded", data: { object: { id: paid.stripe_charge_id, refunded: true, metadata: { ...meta, orderId: paid.id } } } };
	await svc.handleStripeEvent({ repo: ctx.repo, stripe: ctx.stripe }, refunded);
	await svc.handleStripeEvent({ repo: ctx.repo, stripe: ctx.stripe }, refunded);
	await assert.rejects(svc.authorizeContent(ctx.repo, student, b.span.id), { status: 403 }, "refund revokes access");
	assert.equal((await svc.myBooks(ctx.repo, student)).total, 0);
	assert.equal((await svc.myOrders(ctx.repo, student)).orders.some((o) => o.status === "refunded"), true);
});

test("already purchased: no second charge, and a concurrent duplicate payment is refunded", async () => {
	const ctx = shop();
	const b = await ctx.all();
	await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN });
	await assert.rejects(checkout(ctx, student, { bookId: b.span.id, stripeToken: "tok_again" }), { status: 409, code: "already_owned" });
	assert.equal(ctx.stripe.chargeLog.length, 1);
	// Simulate a second tab that created its pending order BEFORE the first finished: settling it must not double-grant.
	const o2 = await ctx.repo.insertOrder({ user_id: "stu-1", book_id: b.span.id, status: "pending", amount_cents: 899, currency: "usd", payment_method: "card", created_at: new Date(NOW) });
	const r = await svc.settlePaid({ repo: ctx.repo, stripe: ctx.stripe, now: NOW }, o2, { id: "ch_dup" });
	assert.equal(r.granted, false);
	assert.deepEqual(ctx.stripe.refundLog, [{ charge: "ch_dup" }], "the duplicate charge is refunded");
	assert.equal(ctx.repo._db.orders.filter((o) => o.status === "paid").length, 1);
});

test("simultaneous checkouts by the same student create one charge", async () => {
	const ctx = shop();
	const b = await ctx.all();
	const results = await Promise.allSettled([1, 2, 3].map((i) => checkout(ctx, student, { bookId: b.span.id, stripeToken: `tok_${i}` })));
	assert.equal(ctx.stripe.chargeLog.length, 1);
	assert.equal(ctx.repo._db.orders.filter((o) => o.status === "paid").length, 1);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

// ============================================================================ access + isolation

test("protected content: signed-out, unpurchased, other students and unknown ids are refused", async () => {
	const ctx = shop();
	const b = await ctx.all();
	await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN });
	await assert.rejects(svc.authorizeContent(ctx.repo, null, b.span.id), { status: 401 });
	await assert.rejects(svc.authorizeContent(ctx.repo, other, b.span.id), { status: 403 });
	await assert.rejects(svc.authorizeContent(ctx.repo, instructor, b.span.id), { status: 403 });
	await assert.rejects(svc.authorizeContent(ctx.repo, student, "00000000-0000-4000-8000-000000000000"), { status: 404 });
	await assert.rejects(svc.authorizeContent(ctx.repo, student, "../../etc/passwd"), { status: 404 });
	await assert.rejects(svc.authorizeContent(ctx.repo, student, b.science.id), { status: 403 }, "owning one book does not open another");
	assert.equal((await svc.authorizeContent(ctx.repo, admin, b.span.id)).id, b.span.id, "admins can review any book");
});

test("student isolation: libraries, history, progress and ownership are per account", async () => {
	const ctx = shop();
	const b = await ctx.all();
	await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN });
	await checkout(ctx, other, { bookId: b.science.id, stripeToken: TOKEN });
	assert.deepEqual((await svc.myBooks(ctx.repo, student)).items.map((i) => i.book.slug), ["sample-number-quest"]);
	assert.deepEqual((await svc.myBooks(ctx.repo, other)).items.map((i) => i.book.slug), ["sample-rocket-lab"]);
	assert.deepEqual((await svc.myOrders(ctx.repo, other)).orders.map((o) => o.book.slug), ["sample-rocket-lab"]);
	// progress: owner only, and never writable for a book the account does not own
	await svc.saveProgress(ctx.repo, student, b.span.id, { position: 3, total: 10 });
	assert.equal((await svc.getProgress(ctx.repo, student, b.span.id)).progress.percent, 30);
	await assert.rejects(svc.getProgress(ctx.repo, other, b.span.id), { status: 403 });
	await assert.rejects(svc.saveProgress(ctx.repo, other, b.span.id, { position: 1, total: 10 }), { status: 403 });
	for (const bad of [{ position: 0, total: 10 }, { position: 11, total: 10 }, { position: 1.5, total: 10 }, { position: "x", total: 10 }, { position: 1, total: 0 }, {}, null]) {
		await assert.rejects(svc.saveProgress(ctx.repo, student, b.span.id, bad), { status: 422 }, JSON.stringify(bad));
	}
	await svc.saveProgress(ctx.repo, student, b.span.id, { position: 10, total: 10 });
	assert.equal((await svc.myBooks(ctx.repo, student, { status: "finished" })).total, 1);
	assert.equal((await svc.myBooks(ctx.repo, student, { status: "reading" })).total, 0);
	assert.equal((await svc.myBooks(ctx.repo, student, { q: "quest" })).total, 1);
	assert.equal((await svc.myBooks(ctx.repo, student, { q: "rocket" })).total, 0, "search is within my own books only");
	await assert.rejects(svc.myBooks(ctx.repo, student, { status: "bogus" }), { status: 400 });
	await assert.rejects(svc.myBooks(ctx.repo, null), { status: 401 });
});

test("archived books stay readable by owners but cannot be bought; refunds end access", async () => {
	const ctx = shop();
	const b = await ctx.all();
	await checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN });
	await svc.adminUpdateBook(ctx.repo, admin, b.span.id, { status: "archived" });
	assert.equal((await svc.authorizeContent(ctx.repo, student, b.span.id)).id, b.span.id);
	await assert.rejects(checkout(ctx, other, { bookId: b.span.id, stripeToken: TOKEN }), { status: 404 });
	assert.equal((await svc.listCatalog(ctx.repo, {})).books.some((x) => x.id === b.span.id), false);
	const order = ctx.repo._db.orders[0];
	await svc.adminRefund({ repo: ctx.repo, stripe: ctx.stripe, now: NOW }, admin, order.id);
	assert.deepEqual(ctx.stripe.refundLog, [{ charge: order.stripe_charge_id }]);
	await assert.rejects(svc.authorizeContent(ctx.repo, student, b.span.id), { status: 403 });
	await svc.adminRefund({ repo: ctx.repo, stripe: ctx.stripe, now: NOW }, admin, order.id); // repeat is a no-op
	assert.equal(ctx.stripe.refundLog.length, 1);
	// and the student can buy it again only if it is purchasable - here it is archived
	await assert.rejects(checkout(ctx, student, { bookId: b.span.id, stripeToken: TOKEN }), { status: 404 });
});

// ============================================================================ admin

test("only administrators can manage books, orders and refunds", async () => {
	const ctx = shop();
	const b = await ctx.all();
	for (const who of [student, instructor, null]) {
		const status = who ? 403 : 401;
		await assert.rejects(svc.adminListBooks(ctx.repo, who), { status });
		await assert.rejects(svc.adminGetBook(ctx.repo, who, b.span.id), { status });
		await assert.rejects(svc.adminCreateBook(ctx.repo, who, { title: "Sample X", author: "Y", category: "general", price: "100" }), { status });
		await assert.rejects(svc.adminUpdateBook(ctx.repo, who, b.span.id, { price: "0" }), { status });
		await assert.rejects(svc.adminUpload({ repo: ctx.repo, storage: memoryStorage() }, who, b.span.id, { kind: "cover", data: "AAAA" }), { status });
		await assert.rejects(svc.adminListOrders(ctx.repo, who), { status });
		await assert.rejects(svc.adminRefund({ repo: ctx.repo, stripe: ctx.stripe }, who, "00000000-0000-4000-8000-000000000000"), { status });
	}
	assert.equal(ctx.repo._db.books.find((x) => x.id === b.span.id).price_cents, 899, "unchanged");
	// every admin route resolves the actor on the server and never reads a role from the request
	for (const f of ["index.js", "[id].js", "upload/[id].js", "orders/index.js", "orders/[orderId]/refund.js"]) {
		const src = fs.readFileSync(new URL(`../../pages/api/admin/books/${f}`, import.meta.url), "utf8");
		assert.match(src, /actorFor\(req\)/, f);
		assert.ok(!/req\.(body|query)\.role/.test(src), f);
	}
});

test("admin creates a draft, validates every field, uploads files, then publishes", async () => {
	const ctx = shop();
	const storage = memoryStorage();
	const created = await svc.adminCreateBook(ctx.repo, admin, { title: "Sample New Book", author: "J. Author", category: "science", subject: "science", language: "en", price: "125.50", ageGroup: "independent-readers", gradeMin: 4, gradeMax: 7, readingLevel: "intermediate", publisher: "Sample Press", publishedYear: 2024, isbn: "978-1-4028-9462-6" });
	const id = created.book.id;
	assert.equal(created.book.status, "draft");
	assert.equal(created.book.slug, "sample-new-book");
	assert.equal(ctx.repo._db.books[0].price_cents, 12550);
	assert.equal(ctx.repo._db.books[0].min_age, 10, "age group supplies default bounds");
	assert.equal(created.book.ageRange, "Ages 10–12");
	// cannot publish without a file and a cover
	await assert.rejects(svc.adminUpdateBook(ctx.repo, admin, id, { status: "published" }), { status: 422, code: "not_ready" });
	const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
	const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
	await svc.adminUpload({ repo: ctx.repo, storage }, admin, id, { kind: "cover", data: png.toString("base64") });
	await svc.adminUpload({ repo: ctx.repo, storage }, admin, id, { kind: "file", data: pdf.toString("base64") });
	await svc.adminUpload({ repo: ctx.repo, storage }, admin, id, { kind: "preview", data: pdf.toString("base64") });
	const stored = ctx.repo._db.books[0];
	assert.match(stored.file_path, /^files\/[0-9a-f]{32}\.pdf$/);
	assert.match(stored.cover_path, /^covers\/[0-9a-f]{32}\.png$/);
	assert.equal(storage.files.size, 3);
	const published = await svc.adminUpdateBook(ctx.repo, admin, id, { status: "published" });
	assert.equal(published.book.status, "published");
	// replacing a file removes the old one
	const old = stored.file_path;
	await svc.adminUpload({ repo: ctx.repo, storage }, admin, id, { kind: "file", data: pdf.toString("base64") });
	assert.equal(await storage.exists(old), false);
	// storage keys never reach public responses
	const pub = JSON.stringify(await svc.bookDetail(ctx.repo, null, "sample-new-book"));
	assert.ok(!pub.includes(stored.cover_path) && !pub.includes("files/"));
	assert.equal((await svc.publicAsset(ctx.repo, id, "cover")).mime, "image/png");
	assert.equal((await svc.publicAsset(ctx.repo, id, "preview")).mime, "application/pdf");
	await svc.adminUpdateBook(ctx.repo, admin, id, { status: "draft" });
	await assert.rejects(svc.publicAsset(ctx.repo, id, "cover"), { status: 404 }, "unpublished covers are not public");
});

test("input validation: prices, ranges, enums, links and slugs", async () => {
	for (const [v, cents] of [["0", 0], ["50", 5000], ["125.5", 12550], ["299.99", 29999], [700, 70000], [7.25 * 10, 7250], ["50000", 5000000]]) assert.equal(parsePriceCents(v), cents, String(v));
	for (const v of ["", "-1", "1e3", "12.345", "abc", "1,000", "50001", "49.99", "0.50", "NaN", "Infinity", -5, NaN, Infinity, null, undefined, "0x10", " ", "5.", ".5", "100000"]) assert.throws(() => parsePriceCents(v), (e) => e.status === 422, String(v));
	const ok = { title: "Sample Title", author: "A", category: "science", price: "500" };
	const bad = [
		{ title: "x" }, { title: "" }, { author: "" }, { category: "weapons" }, { subject: "nope" }, { language: "english" }, { price: "-1" },
		{ ageGroup: "kids" }, { minAge: 9, maxAge: 3 }, { minAge: 5 }, { minAge: -1, maxAge: 5 }, { minAge: 5, maxAge: 500 }, { minAge: "five", maxAge: 6 },
		{ gradeMin: 5 }, { gradeMin: 8, gradeMax: 2 }, { gradeMin: -2, gradeMax: 3 }, { gradeMin: 1, gradeMax: 14 },
		{ readingLevel: "genius" }, { externalUrl: "http://insecure.example/x" }, { externalUrl: "javascript:alert(1)" }, { coverUrl: "http://x" },
		{ status: "deleted" }, { slug: "Bad Slug" }, { slug: "checkout" }, { isbn: "12" }, { publishedYear: 1200 }, { publishedYear: 3000 },
		{ description: "x".repeat(5001) },
	];
	for (const extra of bad) assert.throws(() => validateBookInput({ ...ok, ...extra }), (e) => e.status === 422, JSON.stringify(extra));
	const v = validateBookInput({ ...ok, minAge: 0, maxAge: 120, gradeMin: -1, gradeMax: 13, externalUrl: "https://read.example/book", isbn: "0-306-40615-2" });
	assert.equal(v.min_age, 0);
	assert.equal(v.isbn, "0306406152");
	// fields the client must never set are dropped
	const dropped = validateBookInput({ ...ok, id: "x", file_path: "../../etc/passwd", filePath: "x", cover_path: "x", created_by: "x", price_cents: 1, paid: true });
	for (const k of ["id", "file_path", "cover_path", "created_by"]) assert.ok(!(k in dropped), k);
	assert.equal(dropped.price_cents, 50000, "price_cents from the body is ignored; price is parsed");
	// partial updates must change paired fields together
	assert.throws(() => validateBookInput({ minAge: 3 }, { partial: true }), (e) => e.status === 422);
	assert.equal(validateBookInput({ price: "90" }, { partial: true }).price_cents, 9000);
	assert.deepEqual(Object.keys(validateBookInput({ title: "New title" }, { partial: true })), ["title"]);
});

test("uploads: content is sniffed, oversize and disguised files are refused", async () => {
	const ctx = shop();
	const b = await ctx.all();
	const storage = memoryStorage();
	const up = (kind, buf) => svc.adminUpload({ repo: ctx.repo, storage }, admin, b.span.id, { kind, data: Buffer.isBuffer(buf) ? buf.toString("base64") : buf });
	const exe = Buffer.from("MZ\x90\x00 this is not a pdf");
	await assert.rejects(up("file", exe), { status: 422 });
	await assert.rejects(up("cover", exe), { status: 422 });
	await assert.rejects(up("cover", Buffer.from("<svg onload=alert(1)></svg>")), { status: 422 }, "SVG is not an accepted cover type");
	await assert.rejects(up("file", Buffer.from("%PDF-1.4").toString("base64") + "!!!"), { status: 422 }, "not valid base64");
	await assert.rejects(up("file", Buffer.alloc(0)), { status: 422 });
	await assert.rejects(up("file", ""), { status: 422 });
	await assert.rejects(up("cover", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2 * 1024 * 1024)])), { status: 422 }, "cover over 2 MB");
	await assert.rejects(up("file", Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(21 * 1024 * 1024)])), { status: 422 }, "book over 20 MB");
	await assert.rejects(up("script", Buffer.from("%PDF-1.4")), { status: 422 });
	await assert.rejects(svc.adminUpload({ repo: ctx.repo, storage }, admin, "not-a-uuid", { kind: "file", data: "AAAA" }), { status: 404 });
	assert.equal(storage.files.size, 0, "nothing stored for refused uploads");
	assert.deepEqual(sniffUpload("cover", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])), { mime: "image/webp", ext: "webp" });
	assert.equal(sniffUpload("cover", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])).ext, "jpg");
});

test("storage keys are server-generated and traversal-proof", async () => {
	const { createLocalStorage, isStorageKey } = await import("../../lib/books/storage.js");
	for (const k of ["../secret.pdf", "files/../../x.pdf", "files/abc.pdf", "/etc/passwd", "files/0123456789abcdef0123456789abcdef.exe", "", null]) assert.equal(isStorageKey(k), false, String(k));
	assert.equal(isStorageKey("files/0123456789abcdef0123456789abcdef.pdf"), true);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "book-test-"));
	try {
		const s = createLocalStorage(dir);
		const key = await s.put("files", "pdf", Buffer.from("%PDF-1.4 x"));
		assert.equal((await s.get(key)).toString(), "%PDF-1.4 x");
		await assert.rejects(s.get("../../package.json"));
		await s.remove(key);
		assert.equal(await s.exists(key), false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// ============================================================================ journey: auth redirect

test("the book id/slug survives the sign-in redirect, and ?next= cannot leave the site", () => {
	const path = bookCheckoutPath("sample-number-quest");
	assert.equal(path, "/books/sample-number-quest/checkout/");
	assert.equal(authUrlFor(path), "/auth/?next=%2Fbooks%2Fsample-number-quest%2Fcheckout%2F");
	assert.equal(safeNextPath("/books/sample-number-quest/checkout/"), "/books/sample-number-quest/checkout/");
	assert.equal(safeNextPath(decodeURIComponent("%2Fbooks%2Fa%2Fcheckout%2F")), "/books/a/checkout/");
	for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/javascript:alert(1)", "evil", "", null, undefined, 5, "/a\nb", "/" + "a".repeat(400), "/\\\\x"]) assert.equal(safeNextPath(evil), null, String(evil));
	assert.equal(authUrlFor("//evil.example"), "/auth/");
	// login + registration both end in handleLogin, which only follows safe paths; no role is chosen by the client
	const auth = fs.readFileSync(new URL("../../utils/auth.js", import.meta.url), "utf8");
	assert.match(auth, /safeNextPath\(routeNext\.query\.next\)/);
	const signup = fs.readFileSync(new URL("../../pages/api/users/signup.js", import.meta.url), "utf8");
	assert.ok(!/role/.test(signup.split("User.create(")[1].split(")")[0]), "signup never sets a role from the request");
	const register = fs.readFileSync(new URL("../../components/Authentication/RegisterForm.js", import.meta.url), "utf8");
	assert.match(register, /handleLogin\(/);
});

test("the public pages send signed-out buyers to /auth with the checkout path, and the checkout page requires a login", () => {
	const detail = fs.readFileSync(new URL("../../components/Books/BuyBox.js", import.meta.url), "utf8");
	assert.match(detail, /authUrlFor\(bookCheckoutPath\(/);
	const page = fs.readFileSync(new URL("../../pages/books/[slug]/checkout.js", import.meta.url), "utf8");
	assert.match(page, /authUrlFor\(bookCheckoutPath\(/);
	assert.match(page, /already_owned|owned/);
});

// ============================================================================ regression: nothing outside books changed

test("course checkout is untouched: it still has no book code and the course tables are not referenced by the bookstore migration", () => {
	const checkout_ = fs.readFileSync(new URL("../../lib/payments/checkout.js", import.meta.url), "utf8");
	assert.ok(!/book/i.test(checkout_));
	const mig = fs.readFileSync(new URL("../../database/migrations/20261022000000-create-bookstore.js", import.meta.url), "utf8");
	assert.ok(!/dropTable\("(users|courses|enrolments)"/.test(mig));
	assert.ok(!/(removeColumn|changeColumn|addColumn)/.test(mig.split("async down")[0]), "no existing table is altered");
	assert.match(mig, /dropTable\("book_progress"\)[\s\S]*dropTable\("book_orders"\)[\s\S]*dropTable\("books"\)/, "down() removes only the new tables, children first");
});
