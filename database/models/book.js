// Digital bookstore tables (see migration 20261022000000-create-bookstore.js). Used through lib/books/repo.js.
import { Model, DataTypes } from "sequelize";
import connection from "../connection";

const opts = (modelName, tableName) => ({
	sequelize: connection,
	modelName,
	tableName,
	createdAt: "created_at",
	updatedAt: "updated_at",
});
const id = { type: DataTypes.CHAR(36).BINARY, primaryKey: true, defaultValue: DataTypes.UUIDV4 };
const uuidRef = (allowNull = true) => ({ type: DataTypes.CHAR(36).BINARY, allowNull });

export class Book extends Model {}
Book.init(
	{
		id,
		slug: { type: DataTypes.STRING(80), allowNull: false },
		title: { type: DataTypes.STRING(200), allowNull: false },
		author: { type: DataTypes.STRING(160), allowNull: false },
		description: DataTypes.TEXT,
		category: { type: DataTypes.STRING(40), allowNull: false },
		subject: DataTypes.STRING(40),
		language: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "en" },
		price_cents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
		publisher: DataTypes.STRING(160),
		published_year: DataTypes.INTEGER,
		isbn: DataTypes.STRING(20),
		status: { type: DataTypes.ENUM("draft", "published", "archived"), allowNull: false, defaultValue: "draft" },
		featured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
		published_at: DataTypes.DATE,
		file_path: DataTypes.STRING(120),
		file_mime: DataTypes.STRING(60),
		file_size: DataTypes.INTEGER,
		preview_path: DataTypes.STRING(120),
		cover_path: DataTypes.STRING(120),
		cover_mime: DataTypes.STRING(60),
		cover_url: DataTypes.STRING(500),
		external_url: DataTypes.STRING(500),
		age_group: DataTypes.STRING(30),
		min_age: DataTypes.INTEGER,
		max_age: DataTypes.INTEGER,
		grade_min: DataTypes.INTEGER,
		grade_max: DataTypes.INTEGER,
		reading_level: DataTypes.STRING(20),
		tags: DataTypes.JSON,
		is_demo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
		created_by: uuidRef(true),
	},
	opts("Book", "books")
);

export class BookOrder extends Model {}
BookOrder.init(
	{
		id,
		user_id: uuidRef(false),
		book_id: uuidRef(false),
		status: { type: DataTypes.ENUM("pending", "paid", "failed", "refunded"), allowNull: false, defaultValue: "pending" },
		amount_cents: { type: DataTypes.INTEGER, allowNull: false },
		currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "inr" },
		payment_method: { type: DataTypes.ENUM("card", "free", "grant"), allowNull: false, defaultValue: "card" },
		stripe_charge_id: DataTypes.STRING(80),
		access_key: DataTypes.STRING(80),
		failure_reason: DataTypes.STRING(80),
		paid_at: DataTypes.DATE,
		refunded_at: DataTypes.DATE,
	},
	opts("BookOrder", "book_orders")
);

export class BookProgress extends Model {}
BookProgress.init(
	{
		id,
		user_id: uuidRef(false),
		book_id: uuidRef(false),
		position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
		total_pages: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
	},
	opts("BookProgress", "book_progress")
);
