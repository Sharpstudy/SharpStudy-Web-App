'use strict';
// Digital bookstore. Additive only: three new tables (books, book_orders, book_progress).
// No existing table, row or constraint is touched, and down() drops only what up() created.
//
// Money is stored as integer minor units (paise for INR): price_cents / amount_cents. The column names are historical.
// book_orders.access_key is "<user id>:<book id>" while an order is PAID and NULL otherwise. Its unique
// index is what makes "one paid purchase per student and book" a database guarantee (MySQL ignores NULLs
// in unique indexes), and clearing it on refund revokes access.
// File columns hold server-generated storage keys, never URLs: private books are only served by an
// authenticated API route.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { UUID, UUIDV4, STRING, INTEGER, BOOLEAN, DATE, TEXT, ENUM, CHAR } = Sequelize;
		const timestamps = {
			created_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			updated_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
		};

		await queryInterface.createTable("books", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			slug: { type: STRING(80), allowNull: false, unique: true },
			title: { type: STRING(200), allowNull: false },
			author: { type: STRING(160), allowNull: false },
			description: { type: TEXT },
			category: { type: STRING(40), allowNull: false },
			subject: { type: STRING(40) },
			language: { type: STRING(3), allowNull: false, defaultValue: "en" },
			price_cents: { type: INTEGER, allowNull: false, defaultValue: 0 },
			publisher: { type: STRING(160) },
			published_year: { type: INTEGER },
			isbn: { type: STRING(20) },
			status: { type: ENUM("draft", "published", "archived"), allowNull: false, defaultValue: "draft" },
			featured: { type: BOOLEAN, allowNull: false, defaultValue: false },
			published_at: { type: DATE },
			// private storage keys (see lib/books/storage.js) and optional external resources
			file_path: { type: STRING(120) },
			file_mime: { type: STRING(60) },
			file_size: { type: INTEGER },
			preview_path: { type: STRING(120) },
			cover_path: { type: STRING(120) },
			cover_mime: { type: STRING(60) },
			cover_url: { type: STRING(500) },
			external_url: { type: STRING(500) },
			// discovery metadata: ranges, because one book can suit several ages and grades
			age_group: { type: STRING(30) },
			min_age: { type: INTEGER },
			max_age: { type: INTEGER },
			grade_min: { type: INTEGER },
			grade_max: { type: INTEGER },
			reading_level: { type: STRING(20) },
			tags: { type: Sequelize.JSON },
			// Fictional development products created by scripts/books/seed-demo.mjs; never set from the admin form.
			is_demo: { type: BOOLEAN, allowNull: false, defaultValue: false },
			created_by: { type: UUID, onDelete: "SET NULL", references: { model: "users", key: "id" } },
			...timestamps,
		});
		await queryInterface.addIndex("books", ["status", "category"]);
		await queryInterface.addIndex("books", ["status", "min_age", "max_age"]);
		await queryInterface.addIndex("books", ["status", "subject"]);
		await queryInterface.addIndex("books", ["status", "featured"]);
		await queryInterface.addIndex("books", ["is_demo"]);

		await queryInterface.createTable("book_orders", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			// RESTRICT: removing a user or a book must never silently erase a payment record.
			user_id: { type: UUID, allowNull: false, onDelete: "RESTRICT", references: { model: "users", key: "id" } },
			book_id: { type: UUID, allowNull: false, onDelete: "RESTRICT", references: { model: "books", key: "id" } },
			status: { type: ENUM("pending", "paid", "failed", "refunded"), allowNull: false, defaultValue: "pending" },
			amount_cents: { type: INTEGER, allowNull: false },
			currency: { type: CHAR(3), allowNull: false, defaultValue: "inr" },
			payment_method: { type: ENUM("card", "free", "grant"), allowNull: false, defaultValue: "card" },
			stripe_charge_id: { type: STRING(80), unique: true },
			access_key: { type: STRING(80), unique: true },
			failure_reason: { type: STRING(80) },
			paid_at: { type: DATE },
			refunded_at: { type: DATE },
			...timestamps,
		});
		await queryInterface.addIndex("book_orders", ["user_id", "status"]);
		await queryInterface.addIndex("book_orders", ["book_id", "status"]);
		await queryInterface.addIndex("book_orders", ["status", "created_at"]);

		await queryInterface.createTable("book_progress", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			user_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "users", key: "id" } },
			book_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "books", key: "id" } },
			position: { type: INTEGER, allowNull: false, defaultValue: 1 },
			total_pages: { type: INTEGER, allowNull: false, defaultValue: 1 },
			...timestamps,
		});
		await queryInterface.addIndex("book_progress", ["user_id", "book_id"], { unique: true, name: "uq_book_progress_user_book" });
	},

	async down(queryInterface) {
		await queryInterface.dropTable("book_progress");
		await queryInterface.dropTable("book_orders");
		await queryInterface.dropTable("books");
	},
};
