// In-memory bookstore repository with the same semantics as lib/books/repo.js (including the unique
// access_key / stripe_charge_id constraints), plus a fake Stripe. No database, no network, no real charge.
import { randomUUID } from "node:crypto";

const clone = (x) => (x ? structuredClone(x) : null);
const dupe = (code) => Object.assign(new Error(code), { code });

export function createBookRepo() {
	const db = { books: [], orders: [], progress: [], users: [] };
	const repo = {
		_db: db,
		async listPublishedBooks() {
			return db.books.filter((b) => b.status === "published").map(clone);
		},
		async listAllBooks() {
			return db.books.map(clone);
		},
		async getBookBySlug(slug) {
			return clone(db.books.find((b) => b.slug === slug));
		},
		async getBookById(id) {
			return clone(db.books.find((b) => b.id === id));
		},
		async getBooksByIds(ids) {
			return db.books.filter((b) => ids.includes(b.id)).map(clone);
		},
		async insertBook(row) {
			const b = { id: randomUUID(), featured: false, status: "draft", created_at: new Date(), updated_at: new Date(), ...row };
			if (db.books.some((x) => x.slug === b.slug)) throw dupe("duplicate_slug");
			db.books.push(b);
			return clone(b);
		},
		async updateBook(id, patch) {
			Object.assign(db.books.find((b) => b.id === id), patch);
			return clone(db.books.find((b) => b.id === id));
		},
		async paidCounts() {
			const m = new Map();
			for (const o of db.orders) if (o.status === "paid") m.set(o.book_id, (m.get(o.book_id) || 0) + 1);
			return m;
		},
		async getOrder(id) {
			return clone(db.orders.find((o) => o.id === id));
		},
		async findPaidOrder(userId, bookId) {
			return clone(db.orders.find((o) => o.user_id === userId && o.book_id === bookId && o.status === "paid"));
		},
		async findPendingOrder(userId, bookId) {
			return clone(db.orders.filter((o) => o.user_id === userId && o.book_id === bookId && o.status === "pending").pop());
		},
		async insertOrder(row) {
			const o = { id: randomUUID(), stripe_charge_id: null, access_key: null, failure_reason: null, paid_at: null, refunded_at: null, ...row };
			db.orders.push(o);
			return clone(o);
		},
		async updateOrder(id, patch, { whereStatus } = {}) {
			const o = db.orders.find((x) => x.id === id);
			if (whereStatus && o.status !== whereStatus) return clone(o);
			if (patch.stripe_charge_id && db.orders.some((x) => x.id !== id && x.stripe_charge_id === patch.stripe_charge_id)) throw dupe("duplicate_charge");
			Object.assign(o, patch);
			return clone(o);
		},
		async markPaid(id, { chargeId, method, at, key }) {
			const o = db.orders.find((x) => x.id === id);
			if (!["pending", "failed"].includes(o.status)) return clone(o);
			if (db.orders.some((x) => x.id !== id && x.access_key === key)) throw dupe("duplicate_access");
			if (chargeId && db.orders.some((x) => x.id !== id && x.stripe_charge_id === chargeId)) throw dupe("duplicate_charge");
			Object.assign(o, { status: "paid", access_key: key, paid_at: at, failure_reason: null, payment_method: method || "card", ...(chargeId ? { stripe_charge_id: chargeId } : {}) });
			return clone(o);
		},
		async listOrdersByUser(userId) {
			return db.orders.filter((o) => o.user_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(clone);
		},
		async listPaidOrdersByUser(userId) {
			return db.orders.filter((o) => o.user_id === userId && o.status === "paid").map(clone);
		},
		async listOrders({ status } = {}) {
			return db.orders.filter((o) => !status || o.status === status).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(clone);
		},
		async getProgress(userId, bookId) {
			return clone(db.progress.find((p) => p.user_id === userId && p.book_id === bookId));
		},
		async upsertProgress(userId, bookId, patch) {
			let p = db.progress.find((x) => x.user_id === userId && x.book_id === bookId);
			if (!p) db.progress.push((p = { id: randomUUID(), user_id: userId, book_id: bookId }));
			Object.assign(p, patch);
			return clone(p);
		},
		async getUser(id) {
			return clone(db.users.find((u) => u.id === id));
		},
		async getUsersByIds(ids) {
			return db.users.filter((u) => ids.includes(u.id)).map(clone);
		},
	};
	return repo;
}

// A scriptable Stripe: `next` decides what the following charge does. chargeLog / refundLog record every call.
export function createFakeStripe() {
	const s = {
		chargeLog: [],
		refundLog: [],
		next: "succeed", // succeed | decline | pending | error | underpay
		charges: {
			async create(params, opts) {
				s.chargeLog.push({ params, opts });
				if (s.next === "decline") throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
				if (s.next === "error") throw new Error("network");
				const id = `ch_${s.chargeLog.length}_${opts.idempotencyKey.slice(0, 8)}`;
				const status = s.next === "pending" ? "pending" : "succeeded";
				return { id, status, paid: s.next !== "pending", amount: s.next === "underpay" ? params.amount - 1 : params.amount, currency: params.currency, metadata: params.metadata };
			},
		},
		refunds: {
			async create(params) {
				s.refundLog.push(params);
				return { id: `re_${s.refundLog.length}` };
			},
		},
	};
	return s;
}
