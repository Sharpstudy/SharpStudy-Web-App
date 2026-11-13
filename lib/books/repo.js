// Sequelize implementation of the bookstore repository used by lib/books/service.js.
// Must keep the same semantics as tests/books/memoryRepo.mjs, which the service tests run against.
import { Op } from "sequelize";
import connection from "@/database/connection";
import User from "@/database/models/user";
import { Book, BookOrder, BookProgress } from "@/database/models/book";

const plain = (r) => (r ? r.get({ plain: true }) : null);
const plainAll = (rows) => rows.map(plain);
const SAFE_USER = ["id", "first_name", "last_name", "email", "profile_photo"];

// Rows the public catalogue and recommendations need (no storage keys beyond what publicBook checks).
const CATALOG_ATTRS = ["id", "slug", "title", "author", "description", "category", "subject", "language", "price_cents", "publisher", "published_year", "isbn", "status", "featured", "published_at", "file_path", "preview_path", "cover_path", "cover_url", "external_url", "age_group", "min_age", "max_age", "grade_min", "grade_max", "reading_level", "tags", "is_demo", "created_at"];

const repo = {
	// ---- books ----
	async listPublishedBooks() {
		return plainAll(await Book.findAll({ where: { status: "published" }, attributes: CATALOG_ATTRS, order: [["created_at", "DESC"]] }));
	},
	async listAllBooks() {
		return plainAll(await Book.findAll({ order: [["created_at", "DESC"]] }));
	},
	async getBookBySlug(slug) {
		return plain(await Book.findOne({ where: { slug } }));
	},
	async getBookById(id) {
		return plain(await Book.findByPk(id));
	},
	async getBooksByIds(ids) {
		if (!ids.length) return [];
		return plainAll(await Book.findAll({ where: { id: { [Op.in]: [...new Set(ids)] } } }));
	},
	async insertBook(row) {
		return plain(await Book.create(row));
	},
	async updateBook(id, patch) {
		await Book.update(patch, { where: { id } });
		return plain(await Book.findByPk(id));
	},
	// Map<bookId, number of PAID orders>
	async paidCounts() {
		const rows = await BookOrder.findAll({ where: { status: "paid" }, attributes: ["book_id", [connection.fn("COUNT", connection.col("id")), "n"]], group: ["book_id"], raw: true });
		return new Map(rows.map((r) => [r.book_id, Number(r.n)]));
	},

	// ---- orders ----
	async getOrder(id) {
		return plain(await BookOrder.findByPk(id));
	},
	async findPaidOrder(userId, bookId) {
		return plain(await BookOrder.findOne({ where: { user_id: userId, book_id: bookId, status: "paid" } }));
	},
	async findPendingOrder(userId, bookId) {
		return plain(await BookOrder.findOne({ where: { user_id: userId, book_id: bookId, status: "pending" }, order: [["created_at", "DESC"]] }));
	},
	async insertOrder(row) {
		return plain(await BookOrder.create(row));
	},
	async updateOrder(id, patch, { whereStatus } = {}) {
		const where = { id };
		if (whereStatus) where.status = whereStatus;
		await BookOrder.update(patch, { where });
		return plain(await BookOrder.findByPk(id));
	},
	// Atomic pending|failed -> paid. When the order was already settled the current row is returned unchanged.
	// The unique indexes on access_key and stripe_charge_id turn a duplicate purchase into a duplicate error.
	async markPaid(id, { chargeId, method, at, key }) {
		const patch = { status: "paid", access_key: key, paid_at: at, failure_reason: null, payment_method: method || "card" };
		if (chargeId) patch.stripe_charge_id = chargeId;
		await BookOrder.update(patch, { where: { id, status: { [Op.in]: ["pending", "failed"] } } });
		return plain(await BookOrder.findByPk(id));
	},
	async listOrdersByUser(userId) {
		return plainAll(await BookOrder.findAll({ where: { user_id: userId }, order: [["created_at", "DESC"]], limit: 200 }));
	},
	async listPaidOrdersByUser(userId) {
		return plainAll(await BookOrder.findAll({ where: { user_id: userId, status: "paid" }, order: [["paid_at", "DESC"]] }));
	},
	async listOrders({ status } = {}) {
		return plainAll(await BookOrder.findAll({ where: status ? { status } : {}, order: [["created_at", "DESC"]], limit: 1000 }));
	},

	// ---- progress ----
	async getProgress(userId, bookId) {
		return plain(await BookProgress.findOne({ where: { user_id: userId, book_id: bookId } }));
	},
	async upsertProgress(userId, bookId, patch) {
		const row = await BookProgress.findOne({ where: { user_id: userId, book_id: bookId } });
		if (row) await row.update(patch);
		else await BookProgress.create({ user_id: userId, book_id: bookId, ...patch });
		return plain(await BookProgress.findOne({ where: { user_id: userId, book_id: bookId } }));
	},

	// ---- users ----
	async getUser(id) {
		return plain(await User.findOne({ where: { id }, attributes: [...SAFE_USER, "role"] }));
	},
	async getUsersByIds(ids) {
		if (!ids.length) return [];
		return plainAll(await User.findAll({ where: { id: { [Op.in]: [...new Set(ids)] } }, attributes: SAFE_USER }));
	},
};

export default repo;
