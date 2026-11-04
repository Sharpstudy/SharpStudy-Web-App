// The bookstore's business rules. Pure with respect to storage and Stripe: both are passed in
// (see lib/books/repo.js and lib/books/stripeEvents.js; tests use in-memory fakes, so no real
// charge is ever created in tests).
//
//  * Prices come from the book row in the database (integer cents). The browser sends WHICH book and
//    Stripe's payment token, nothing else is believed - not a price, not a "paid" flag.
//  * Access is a paid book_orders row. `access_key` ("user:book") is unique and only set while an order
//    is paid, so the database itself prevents two paid orders for the same user and book, and a refund
//    (which clears the key) revokes access.
//  * A charge is trusted only after the server read it back from Stripe (checkout) or verified a signed
//    Stripe event (webhook). Both paths end in settlePaid(), which is idempotent.
import { createHash } from "node:crypto";
import { BookError, fail, isUuid } from "./errors.js";
import { parseCatalogQuery, applyFilter, paginate, publicBook, recommend, relatedTo, ageWindow } from "./catalog.js";
import { validateBookInput, slugify, sniffUpload, decodeBase64, checkAgeGroupConsistency, LIMITS, UPLOAD_KINDS, RESERVED_SLUGS } from "./validate.js";
import { isStorageKey } from "./storage.js";
import { AGE_GROUPS, STATUSES, isCategory, languageName } from "./taxonomy.js";

export const PENDING_TTL_MS = 60 * 60 * 1000;
export const CURRENCY = "inr"; // amounts are paise (minor units)
const inFlight = new Set();

const iso = (d) => (d ? new Date(d).toISOString() : null);
const accessKey = (userId, bookId) => `${userId}:${bookId}`;
const isDuplicate = (e) => e && (e.code === "duplicate_access" || e.code === "duplicate_charge" || e.name === "SequelizeUniqueConstraintError" || e.code === "ER_DUP_ENTRY");

export const requireUser = (actor) => {
	if (!actor || !actor.userId) fail(401, "unauthorized", "Sign in first");
	return actor;
};
export const requireAdmin = (actor) => {
	requireUser(actor);
	if (actor.role !== "admin") fail(403, "forbidden", "Administrators only");
	return actor;
};

// ------------------------------------------------------------------------------- catalogue

export async function listCatalog(repo, query) {
	const f = parseCatalogQuery(query);
	const [books, popular] = await Promise.all([repo.listPublishedBooks(), repo.paidCounts()]);
	const matched = applyFilter(books, f, { popular });
	const page = paginate(matched, f.page, f.pageSize);
	// Languages that actually exist in the published catalogue (for the language filter), never a fixed guess.
	const languages = [...new Set(books.map((b) => b.language))].sort().map((code) => ({ code, name: languageName(code) }));
	return { books: page.items.map(publicBook), total: page.total, page: page.page, pages: page.pages, pageSize: page.pageSize, filters: f, facets: { languages } };
}

// Homepage / landing rows. `ageGroup` or `age` personalises "recommended" without any account data.
export async function homeSections(repo, query = {}) {
	const f = parseCatalogQuery({ ageGroup: query.ageGroup, age: query.age, grade: query.grade });
	const [books, popular] = await Promise.all([repo.listPublishedBooks(), repo.paidCounts()]);
	const take = (list) => list.slice(0, 8).map(publicBook);
	const newest = applyFilter(books, { sort: "newest" });
	// "Popular" is real: only books that have actually been bought, most bought first. With no sales it is empty.
	const byPopularity = applyFilter(books, { sort: "popular" }, { popular }).filter((b) => (popular.get(b.id) || 0) > 0);
	const window = ageWindow(f);
	// Recommendations need a signal (age or grade); without one the list is empty rather than pretending to be personal.
	const recommended = window || f.grade != null ? recommend(books, { window, grade: f.grade }, { limit: 8, popular }) : [];
	return {
		featured: take(books.filter((b) => b.featured).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))),
		popular: take(byPopularity),
		// Real number of published books per category (shown on the subject tiles only when above zero).
		categoryCounts: books.reduce((m, b) => ((m[b.category] = (m[b.category] || 0) + 1), m), {}),
		newArrivals: take(newest),
		recommended: recommended.slice(0, 8).map(publicBook),
		total: books.length,
	};
}

export async function ownership(repo, actor, bookId) {
	if (!actor || !actor.userId) return { owned: false, pending: false };
	const paid = await repo.findPaidOrder(actor.userId, bookId);
	if (paid) return { owned: true, pending: false, orderId: paid.id, purchasedAt: iso(paid.paid_at) };
	const pending = await repo.findPendingOrder(actor.userId, bookId);
	return { owned: false, pending: !!pending };
}

// Book page data. The reading link of an external book is only revealed to its owner.
export async function bookDetail(repo, actor, slug) {
	const book = await repo.getBookBySlug(String(slug || "").slice(0, 100));
	// Unpublished books do not exist for the public; an administrator may preview them.
	if (!book || (book.status !== "published" && !(actor && actor.role === "admin"))) fail(404, "not_found", "Book not found");
	const [books, popular, own] = await Promise.all([repo.listPublishedBooks(), repo.paidCounts(), ownership(repo, actor, book.id)]);
	const progress = own.owned ? await repo.getProgress(actor.userId, book.id) : null;
	const pb = publicBook(book);
	return {
		book: { ...pb, externalUrl: own.owned ? book.external_url || null : null, status: actor && actor.role === "admin" ? book.status : undefined },
		ownership: { owned: own.owned, pending: own.pending, purchasedAt: own.purchasedAt || null },
		progress: progress ? progressView(progress) : null,
		related: relatedTo(book, books, { limit: 6, popular }).map(publicBook),
	};
}

// ------------------------------------------------------------------------------- checkout

export const idempotencyKey = (orderId, token) => createHash("sha256").update(JSON.stringify(["book", orderId, token])).digest("hex");

async function findBook(repo, body) {
	const id = body && body.bookId;
	const slug = body && body.slug;
	if (id !== undefined && id !== null) {
		if (!isUuid(id)) fail(422, "invalid_book", "Choose a book");
		return repo.getBookById(id);
	}
	if (typeof slug === "string" && slug) return repo.getBookBySlug(slug.slice(0, 100));
	return fail(422, "invalid_book", "Choose a book");
}

// Marks an order paid exactly once. Safe to call any number of times, from checkout and from webhooks.
// Returns { order, granted, duplicate }.
export async function settlePaid({ repo, stripe, now = Date.now() }, order, charge) {
	if (order.status === "paid") return { order, granted: true, duplicate: true };
	if (order.status === "refunded") return { order, granted: false, duplicate: true };
	try {
		const paid = await repo.markPaid(order.id, { chargeId: charge && charge.id ? charge.id : null, method: charge ? "card" : order.payment_method, at: new Date(now), key: accessKey(order.user_id, order.book_id) });
		// markPaid returns the current row without changing it when a concurrent request already settled the order.
		return { order: paid, granted: paid.status === "paid", duplicate: false };
	} catch (e) {
		if (!isDuplicate(e)) throw e;
		// The student already owns this book through another order (or this charge was recorded already).
		const again = await repo.getOrder(order.id);
		if (again && again.status === "paid") return { order: again, granted: true, duplicate: true };
		if (charge && charge.id && stripe) await stripe.refunds.create({ charge: charge.id }).catch(() => {});
		const refunded = await repo.updateOrder(order.id, { status: "refunded", failure_reason: "duplicate_purchase", refunded_at: new Date(now) });
		return { order: refunded, granted: false, duplicate: true };
	}
}

export async function runBookCheckout({ repo, stripe, now = Date.now() }, actor, body) {
	requireUser(actor);
	body = body && typeof body === "object" ? body : {};
	const book = await findBook(repo, body);
	// Unpublished books cannot be bought; they look like missing books.
	if (!book || book.status !== "published") fail(404, "unavailable", "This book is not available");
	const lock = `${actor.userId}:${book.id}`;
	if (inFlight.has(lock)) fail(409, "in_progress", "Your payment is already being processed");
	inFlight.add(lock);
	try {
		const user = await repo.getUser(actor.userId);
		if (!user) fail(401, "unauthorized", "Sign in first");
		if (await repo.findPaidOrder(user.id, book.id)) fail(409, "already_owned", "You already own this book", { slug: book.slug });

		const price = book.price_cents;
		if (!Number.isInteger(price) || price < 0) fail(422, "invalid_price", "This book cannot be purchased right now");
		// The price the buyer saw must be the price the server holds.
		if (body.priceCents !== undefined && body.priceCents !== price) fail(422, "price_changed", "The price of this book has changed. Please refresh the page.");

		let pending = await repo.findPendingOrder(user.id, book.id);
		if (pending) {
			if (now - new Date(pending.created_at).getTime() < PENDING_TTL_MS) {
				return { status: 202, body: { status: "pending", message: "Your payment is still processing. The book will appear in My Books once it succeeds." } };
			}
			await repo.updateOrder(pending.id, { status: "failed", failure_reason: "expired" }, { whereStatus: "pending" });
		}

		const order = await repo.insertOrder({ user_id: user.id, book_id: book.id, status: "pending", amount_cents: price, currency: CURRENCY, payment_method: price === 0 ? "free" : "card", created_at: new Date(now) });

		if (price === 0) {
			const r = await settlePaid({ repo, stripe, now }, order, null);
			return { status: 200, body: { message: "Added to My Books.", slug: book.slug, orderId: r.order.id, charged: 0 } };
		}

		const token = body.stripeToken;
		if (typeof token !== "string" || !/^(tok|pm|src)_[A-Za-z0-9]+$/.test(token)) {
			await repo.updateOrder(order.id, { status: "failed", failure_reason: "no_payment_details" });
			fail(422, "payment_required", "Payment details are required");
		}
		if (!stripe) {
			await repo.updateOrder(order.id, { status: "failed", failure_reason: "payments_unavailable" });
			fail(503, "payments_unavailable", "Payments are not available right now");
		}
		let charge;
		try {
			charge = await stripe.charges.create(
				{
					amount: price,
					currency: CURRENCY,
					source: token,
					receipt_email: user.email,
					description: `Book | ${book.title}`.slice(0, 250),
					metadata: { kind: "book", orderId: order.id, userId: user.id, bookId: book.id },
				},
				{ idempotencyKey: idempotencyKey(order.id, token) }
			);
		} catch (e) {
			const declined = e && e.type === "StripeCardError";
			await repo.updateOrder(order.id, { status: "failed", failure_reason: declined ? "card_declined" : "payment_error" });
			if (declined) fail(402, "card_declined", e.message || "Your card was declined");
			fail(502, "payment_error", "We could not process the payment. You have not been charged.");
		}
		await repo.updateOrder(order.id, { stripe_charge_id: charge.id || null }).catch(() => {});
		if (charge.status === "pending") {
			// Nothing is granted until Stripe reports success (webhook -> settlePaid).
			return { status: 202, body: { status: "pending", message: "Your payment is still processing. The book will appear in My Books once it succeeds." } };
		}
		if (charge.status !== "succeeded" || charge.paid !== true || charge.amount !== price || charge.currency !== CURRENCY) {
			await repo.updateOrder(order.id, { status: "failed", failure_reason: "payment_failed" });
			fail(402, "payment_failed", "The payment did not complete. You have not been charged for this book.");
		}
		let r;
		try {
			r = await settlePaid({ repo, stripe, now }, order, charge);
		} catch (e) {
			if (stripe) await stripe.refunds.create({ charge: charge.id }).catch(() => {});
			await repo.updateOrder(order.id, { status: "refunded", failure_reason: "grant_failed", refunded_at: new Date(now) }).catch(() => {});
			fail(500, "grant_failed", "We could not complete your purchase. Any payment has been refunded.");
		}
		if (!r.granted) fail(409, "already_owned", "You already own this book. The duplicate payment was refunded.", { slug: book.slug });
		return { status: 200, body: { message: "Purchase complete. The book is in My Books.", slug: book.slug, orderId: r.order.id, charged: price / 100 } };
	} finally {
		inFlight.delete(lock);
	}
}

// ------------------------------------------------------------------------------- webhooks

// `event` MUST already have been signature-verified (stripe.webhooks.constructEvent). Idempotent:
// replaying an event changes nothing.
export async function handleStripeEvent({ repo, stripe, now = Date.now() }, event) {
	const charge = event && event.data && event.data.object;
	const meta = (charge && charge.metadata) || {};
	// Course purchases and anything else on the same Stripe account are not ours.
	if (!charge || meta.kind !== "book" || !isUuid(meta.orderId)) return { handled: false };
	const order = await repo.getOrder(meta.orderId);
	if (!order) return { handled: false };

	switch (event.type) {
		case "charge.succeeded": {
			const valid = charge.paid === true && charge.status === "succeeded" && charge.amount === order.amount_cents && charge.currency === order.currency && meta.userId === order.user_id && meta.bookId === order.book_id;
			if (!valid) return { handled: true, ignored: "mismatch" };
			if (order.stripe_charge_id && order.stripe_charge_id !== charge.id) return { handled: true, ignored: "other_charge" };
			const r = await settlePaid({ repo, stripe, now }, order, charge);
			return { handled: true, granted: r.granted, duplicate: r.duplicate };
		}
		case "charge.failed": {
			if (order.status === "pending") await repo.updateOrder(order.id, { status: "failed", failure_reason: String(charge.failure_code || "payment_failed").slice(0, 60) }, { whereStatus: "pending" });
			return { handled: true };
		}
		case "charge.refunded": {
			if (charge.refunded !== true) return { handled: true, ignored: "partial" };
			if (order.status !== "refunded") await repo.updateOrder(order.id, { status: "refunded", access_key: null, refunded_at: new Date(now) });
			return { handled: true };
		}
		default:
			return { handled: false };
	}
}

// ------------------------------------------------------------------------------- reading

// Who may read a book's protected content: an account with a PAID order for it, or an administrator.
// Every protected request calls this; a changed id or order id can only ever fail it.
export async function authorizeContent(repo, actor, bookId) {
	requireUser(actor);
	if (!isUuid(bookId)) fail(404, "not_found", "Book not found");
	const book = await repo.getBookById(bookId);
	if (!book) fail(404, "not_found", "Book not found");
	if (actor.role !== "admin") {
		if (book.status === "draft") fail(404, "not_found", "Book not found");
		if (!(await repo.findPaidOrder(actor.userId, book.id))) fail(403, "not_purchased", "Buy this book to read it");
	}
	if (!book.file_path) fail(404, "no_file", "This book has no downloadable file");
	return book;
}

// How the browser should fetch the protected file: through our authenticated endpoint, or - when the
// storage provider supports it - from a short-lived signed URL (needed on serverless hosts, whose
// responses are capped at a few MB). The purchase is checked here, on every call.
export async function readAccess({ repo, storage }, actor, bookId) {
	const book = await authorizeContent(repo, actor, bookId);
	if (storage && storage.presignGet) {
		const ttl = 120;
		return { mode: "signed", url: await storage.presignGet(book.file_path, { ttl, contentType: book.file_mime || "application/pdf" }), expiresIn: ttl };
	}
	return { mode: "stream", url: `/api/books/${book.id}/content` };
}

// Public assets of a PUBLISHED book: its cover and its limited preview.
export async function publicAsset(repo, bookId, kind, actor = null) {
	if (!isUuid(bookId)) fail(404, "not_found", "Not found");
	const book = await repo.getBookById(bookId);
	// Unpublished covers are visible only to administrators (previews while editing).
	if (!book || (book.status !== "published" && !(actor && actor.role === "admin"))) fail(404, "not_found", "Not found");
	const path = kind === "cover" ? book.cover_path : kind === "preview" ? book.preview_path : null;
	if (!path) fail(404, "not_found", "Not found");
	return { path, mime: kind === "cover" ? book.cover_mime || "image/jpeg" : "application/pdf" };
}

const progressView = (p) => ({ position: p.position, total: p.total_pages, percent: p.total_pages ? Math.min(100, Math.round((p.position / p.total_pages) * 100)) : 0, updatedAt: iso(p.updated_at) });

export async function saveProgress(repo, actor, bookId, input, now = new Date()) {
	requireUser(actor);
	if (!isUuid(bookId)) fail(404, "not_found", "Book not found");
	if (!(await repo.findPaidOrder(actor.userId, bookId))) fail(403, "not_purchased", "Buy this book to read it");
	const position = Number(input && input.position);
	const total = Number(input && input.total);
	if (!Number.isInteger(position) || !Number.isInteger(total) || total < 1 || total > 100000 || position < 1 || position > total) fail(422, "invalid", "That reading position is not valid");
	const row = await repo.upsertProgress(actor.userId, bookId, { position, total_pages: total, updated_at: now });
	return progressView(row);
}

export async function getProgress(repo, actor, bookId) {
	requireUser(actor);
	if (!isUuid(bookId)) fail(404, "not_found", "Book not found");
	if (!(await repo.findPaidOrder(actor.userId, bookId))) fail(403, "not_purchased", "Buy this book to read it");
	const p = await repo.getProgress(actor.userId, bookId);
	return { progress: p ? progressView(p) : null };
}

// ------------------------------------------------------------------------------- my books

export async function myBooks(repo, actor, { q = "", status = "all" } = {}) {
	requireUser(actor);
	if (!["all", "not_started", "reading", "finished"].includes(status)) fail(400, "bad_query", "Unknown filter");
	const needle = String(q || "").trim().toLowerCase().slice(0, 80);
	const orders = await repo.listPaidOrdersByUser(actor.userId);
	const books = new Map((await repo.getBooksByIds(orders.map((o) => o.book_id))).map((b) => [b.id, b]));
	const items = [];
	for (const o of orders) {
		const b = books.get(o.book_id);
		if (!b) continue;
		const p = await repo.getProgress(actor.userId, b.id);
		const prog = p ? progressView(p) : null;
		const state = !prog ? "not_started" : prog.percent >= 100 ? "finished" : "reading";
		if (needle && !`${b.title} ${b.author}`.toLowerCase().includes(needle)) continue;
		if (status !== "all" && state !== status) continue;
		items.push({
			orderId: o.id,
			book: publicBook(b),
			purchasedAt: iso(o.paid_at),
			// "archived" books stay readable by whoever bought them.
			access: b.status === "draft" ? "unavailable" : "active",
			canRead: !!(b.file_path || b.external_url),
			state,
			progress: prog,
		});
	}
	return { items, total: items.length };
}

export async function myOrders(repo, actor) {
	requireUser(actor);
	const orders = await repo.listOrdersByUser(actor.userId);
	const books = new Map((await repo.getBooksByIds(orders.map((o) => o.book_id))).map((b) => [b.id, b]));
	return {
		orders: orders.map((o) => ({
			id: o.id,
			status: o.status,
			amountCents: o.amount_cents,
			currency: o.currency,
			method: o.payment_method,
			createdAt: iso(o.created_at),
			paidAt: iso(o.paid_at),
			refundedAt: iso(o.refunded_at),
			book: books.get(o.book_id) ? { id: o.book_id, slug: books.get(o.book_id).slug, title: books.get(o.book_id).title } : null,
		})),
	};
}

// ------------------------------------------------------------------------------- admin

const adminView = (b) => ({ ...publicBook(b), status: b.status, tags: Array.isArray(b.tags) ? b.tags : [], hasFile: !!b.file_path, hasCover: !!(b.cover_path || b.cover_url), externalUrl: b.external_url || null, isbn: b.isbn || null, createdAt: iso(b.created_at), updatedAt: iso(b.updated_at), publishedAt: iso(b.published_at) });

const ADMIN_SORTS = ["newest", "title", "price_asc", "price_desc", "sold"];
const ADMIN_PAGE = 20;

export async function adminStats(repo, actor) {
	requireAdmin(actor);
	const books = await repo.listAllBooks();
	const orders = await repo.listOrders({});
	const count = (list, f) => list.filter(f).length;
	return {
		books: { total: books.length, published: count(books, (b) => b.status === "published"), draft: count(books, (b) => b.status === "draft"), archived: count(books, (b) => b.status === "archived"), demo: count(books, (b) => b.is_demo) },
		orders: { total: orders.length, paid: count(orders, (o) => o.status === "paid"), failed: count(orders, (o) => o.status === "failed"), pending: count(orders, (o) => o.status === "pending"), refunded: count(orders, (o) => o.status === "refunded") },
	};
}

export async function adminListBooks(repo, actor, { status, q, demo, category, sort = "newest", page = 1, pageSize = ADMIN_PAGE } = {}) {
	requireAdmin(actor);
	if (status && !STATUSES.includes(status)) fail(400, "bad_query", "Unknown status");
	if (category && !isCategory(category)) fail(400, "bad_query", "Unknown category");
	if (demo && !["yes", "no"].includes(demo)) fail(400, "bad_query", "Unknown demo filter");
	if (!ADMIN_SORTS.includes(sort)) fail(400, "bad_query", "Unknown sort order");
	const p = /^\d{1,5}$/.test(String(page)) && Number(page) >= 1 ? Number(page) : 1;
	const size = /^\d{1,3}$/.test(String(pageSize)) && Number(pageSize) >= 1 && Number(pageSize) <= 100 ? Number(pageSize) : ADMIN_PAGE;
	const needle = String(q || "").trim().toLowerCase().slice(0, 80);
	let books = await repo.listAllBooks();
	if (status) books = books.filter((b) => b.status === status);
	if (category) books = books.filter((b) => b.category === category);
	if (demo) books = books.filter((b) => !!b.is_demo === (demo === "yes"));
	if (needle) books = books.filter((b) => `${b.title} ${b.author} ${b.slug}`.toLowerCase().includes(needle));
	const sold = await repo.paidCounts();
	const time = (b) => new Date(b.created_at || 0).getTime();
	const by = { newest: (a, b) => time(b) - time(a), title: (a, b) => a.title.localeCompare(b.title), price_asc: (a, b) => a.price_cents - b.price_cents, price_desc: (a, b) => b.price_cents - a.price_cents, sold: (a, b) => (sold.get(b.id) || 0) - (sold.get(a.id) || 0) };
	books.sort((a, b) => by[sort](a, b) || String(a.id).localeCompare(String(b.id)));
	const total = books.length;
	const pages = Math.max(1, Math.ceil(total / size));
	const cur = Math.min(p, pages);
	return { books: books.slice((cur - 1) * size, cur * size).map((b) => ({ ...adminView(b), sold: sold.get(b.id) || 0 })), total, page: cur, pages, pageSize: size, stats: await adminStats(repo, actor) };
}

export async function adminGetBook(repo, actor, id) {
	requireAdmin(actor);
	const b = isUuid(id) ? await repo.getBookById(id) : null;
	if (!b) fail(404, "not_found", "Book not found");
	return { book: adminView(b) };
}

async function uniqueSlug(repo, base, exceptId) {
	let root = slugify(base) || "book";
	if (RESERVED_SLUGS.includes(root)) root = `${root}-book`;
	for (let i = 0; i < 50; i++) {
		const candidate = i === 0 ? root : `${root}-${i + 1}`;
		const hit = await repo.getBookBySlug(candidate);
		if (!hit || hit.id === exceptId) return candidate;
	}
	return `${root}-${Date.now().toString(36)}`;
}

function checkPublishable(b) {
	if (!(b.file_path || b.external_url)) fail(422, "not_ready", "Upload the book file or add a reading link before publishing");
	if (!b.cover_path && !b.cover_url) fail(422, "not_ready", "Add a cover image before publishing");
}

export async function adminCreateBook(repo, actor, input, now = new Date()) {
	requireAdmin(actor);
	const v = validateBookInput(input, { partial: false });
	if ((v.status || "draft") === "published") fail(422, "not_ready", "Create the book first, add its file and cover, then publish it");
	const slug = v.slug ? ((await repo.getBookBySlug(v.slug)) ? fail(409, "slug_taken", "That web address is already used") : v.slug) : await uniqueSlug(repo, v.title);
	const book = await repo.insertBook({ ...v, slug, status: "draft", featured: !!v.featured, created_by: actor.userId, created_at: now });
	return { book: adminView(book) };
}

export async function adminUpdateBook(repo, actor, id, input, now = new Date()) {
	requireAdmin(actor);
	const book = isUuid(id) ? await repo.getBookById(id) : null;
	if (!book) fail(404, "not_found", "Book not found");
	const v = validateBookInput(input, { partial: true });
	if (v.slug && v.slug !== book.slug && (await repo.getBookBySlug(v.slug))) fail(409, "slug_taken", "That web address is already used");
	const next = { ...book, ...v };
	checkAgeGroupConsistency(next.age_group, next.min_age, next.max_age);
	if (v.status === "published" && book.status !== "published") {
		checkPublishable(next);
		v.published_at = book.published_at || now;
	}
	if (v.external_url === null && !next.file_path && (v.status || book.status) === "published") fail(422, "not_ready", "A published book needs a file or a reading link");
	const updated = await repo.updateBook(book.id, { ...v, updated_at: now });
	return { book: adminView(updated) };
}

// kind: cover | file | preview. The bytes are validated here and stored through `storage`
// under a server-generated key; the admin never chooses a path.
const FOLDER = { cover: "covers", file: "files", preview: "files" };
const CONTENT_TYPES = { cover: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }, file: { "application/pdf": "pdf" }, preview: { "application/pdf": "pdf" } };

async function attachUpload({ repo, storage }, book, kind, key, mime, size) {
	const patch = kind === "cover" ? { cover_path: key, cover_mime: mime } : kind === "preview" ? { preview_path: key } : { file_path: key, file_mime: mime, file_size: size };
	const old = kind === "cover" ? book.cover_path : kind === "preview" ? book.preview_path : book.file_path;
	const updated = await repo.updateBook(book.id, patch);
	if (old && old !== key) await storage.remove(old).catch(() => {});
	return { book: adminView(updated) };
}

// Three steps, one endpoint:
//   { kind }                         -> "server": { data: <base64> } is sent through the API (local disk storage)
//   { kind, mode: "init", size, contentType }  -> "direct": a short-lived signed PUT URL for object storage
//   { kind, mode: "complete", key }  -> the server inspects what was stored and only then attaches it
// In every path the type is decided from the bytes, the size is checked, and the key is generated by the
// server; an invalid object is deleted from storage. Serverless hosts cap request bodies at a few MB, which
// is why large files go straight to object storage.
export async function adminUpload({ repo, storage }, actor, id, input) {
	requireAdmin(actor);
	const book = isUuid(id) ? await repo.getBookById(id) : null;
	if (!book) fail(404, "not_found", "Book not found");
	input = input && typeof input === "object" ? input : {};
	const kind = input.kind;
	if (!UPLOAD_KINDS.includes(kind)) fail(422, "invalid", "Unknown upload type");
	const max = kind === "cover" ? LIMITS.coverBytes : LIMITS.fileBytes;
	const direct = !!(storage.presignPut && storage.head);

	if (input.mode === "init") {
		if (!direct) return { mode: "server" };
		const size = Number(input.size);
		const ext = CONTENT_TYPES[kind][input.contentType];
		if (!ext) fail(422, "invalid", kind === "cover" ? "Covers must be PNG, JPEG or WebP images" : "Only PDF books are supported");
		if (!Number.isInteger(size) || size < 1 || size > max) fail(422, "invalid", `The file must be between 1 byte and ${max / 1024 / 1024} MB`);
		const key = storage.newKey(FOLDER[kind], ext);
		return { mode: "direct", key, url: await storage.presignPut(key, { contentType: input.contentType, ttl: 300 }), headers: { "Content-Type": input.contentType }, expiresIn: 300 };
	}

	if (input.mode === "complete") {
		if (!direct) fail(422, "invalid", "Direct uploads are not enabled");
		const key = input.key;
		if (!isStorageKey(key) || !key.startsWith(`${FOLDER[kind]}/`)) fail(422, "invalid", "Unknown upload");
		const meta = await storage.head(key);
		if (!meta) fail(422, "invalid", "The upload was not found. Please try again.");
		try {
			const head = await storage.getRange(key, 0, 1023);
			const { mime } = sniffUpload(kind, head, meta.size);
			return await attachUpload({ repo, storage }, book, kind, key, mime, meta.size);
		} catch (e) {
			await storage.remove(key).catch(() => {});
			throw e;
		}
	}

	if (direct) fail(422, "invalid", "Use a direct upload for this storage");
	const buf = decodeBase64(input.data, max);
	const { mime, ext } = sniffUpload(kind, buf);
	const key = await storage.put(FOLDER[kind], ext, buf);
	return attachUpload({ repo, storage }, book, kind, key, mime, buf.length);
}

export async function adminListOrders(repo, actor, { status, page = 1, bookId } = {}) {
	requireAdmin(actor);
	if (status && !["pending", "paid", "failed", "refunded"].includes(status)) fail(400, "bad_query", "Unknown status");
	const p = /^\d{1,5}$/.test(String(page)) && Number(page) >= 1 ? Number(page) : 1;
	const size = 25;
	if (bookId && !isUuid(bookId)) fail(400, "bad_query", "Unknown book");
	const rows = (await repo.listOrders({ status })).filter((o) => !bookId || o.book_id === bookId);
	const total = rows.length;
	const slice = rows.slice((p - 1) * size, p * size);
	const books = new Map((await repo.getBooksByIds(slice.map((o) => o.book_id))).map((b) => [b.id, b]));
	const users = new Map((await repo.getUsersByIds(slice.map((o) => o.user_id))).map((u) => [u.id, u]));
	return {
		orders: slice.map((o) => ({
			id: o.id,
			status: o.status,
			amountCents: o.amount_cents,
			currency: o.currency,
			method: o.payment_method,
			failureReason: o.failure_reason || null,
			chargeId: o.stripe_charge_id || null,
			createdAt: iso(o.created_at),
			paidAt: iso(o.paid_at),
			refundedAt: iso(o.refunded_at),
			book: books.get(o.book_id) ? { id: o.book_id, title: books.get(o.book_id).title, slug: books.get(o.book_id).slug } : null,
			buyer: users.get(o.user_id) ? { id: o.user_id, name: `${users.get(o.user_id).first_name || ""} ${users.get(o.user_id).last_name || ""}`.trim(), email: users.get(o.user_id).email } : null,
		})),
		total,
		page: p,
		pages: Math.max(1, Math.ceil(total / size)),
	};
}

// Refund a card order through Stripe, then revoke access. Free/grant orders are revoked without a refund.
export async function adminRefund({ repo, stripe, now = Date.now() }, actor, orderId) {
	requireAdmin(actor);
	const order = isUuid(orderId) ? await repo.getOrder(orderId) : null;
	if (!order) fail(404, "not_found", "Order not found");
	if (order.status === "refunded") return { order: { id: order.id, status: "refunded" } };
	if (order.status !== "paid") fail(409, "not_refundable", "Only paid orders can be refunded");
	if (order.payment_method === "card") {
		if (!stripe) fail(503, "payments_unavailable", "Payments are not available right now");
		if (!order.stripe_charge_id) fail(409, "not_refundable", "This order has no card charge to refund");
		try {
			await stripe.refunds.create({ charge: order.stripe_charge_id }, { idempotencyKey: `book-refund-${order.id}` });
		} catch (e) {
			// An already-refunded charge is the state we want; anything else is reported.
			if (!(e && e.code === "charge_already_refunded")) fail(502, "refund_failed", "Stripe could not refund this payment");
		}
	}
	const updated = await repo.updateOrder(order.id, { status: "refunded", access_key: null, refunded_at: new Date(now) });
	return { order: { id: updated.id, status: updated.status } };
}

export { BookError, AGE_GROUPS };
