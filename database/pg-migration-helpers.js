// Helpers for the PostgreSQL migration path (database/migrations-pg). CommonJS because sequelize-cli
// loads migrations with require(). Lives outside the migrations folder so it is never treated as a migration.
const fs = require("fs");
const path = require("path");

const SQL_DIR = path.join(__dirname, "migrations-pg", "sql");

// Run a whole SQL file as ONE transaction: PostgreSQL DDL is transactional, so a failure leaves nothing behind.
async function runSqlFile(queryInterface, file) {
	const sql = fs.readFileSync(path.join(SQL_DIR, file), "utf8");
	if (!sql.trim()) throw new Error(`${file} is empty`);
	const sequelize = queryInterface.sequelize;
	if (sequelize.getDialect() !== "postgres") throw new Error(`${file}: this migration path is for PostgreSQL only (dialect is ${sequelize.getDialect()})`);
	await sequelize.transaction((transaction) => sequelize.query(sql, { transaction, raw: true }));
}

// The baseline must only ever run against an EMPTY database. Anything else is unexpected: stop, change nothing.
async function assertEmptyApplicationSchema(queryInterface) {
	const sequelize = queryInterface.sequelize;
	const [rows] = await sequelize.query(
		"SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_name <> 'sequelizemeta' ORDER BY 1, 2"
	);
	if (rows.length) {
		const list = rows.slice(0, 10).map((r) => `${r.table_schema}.${r.table_name}`).join(", ");
		throw new Error(`Refusing to create the baseline: the database already contains ${rows.length} object(s) (${list}). Nothing was changed.`);
	}
}

module.exports = { runSqlFile, assertEmptyApplicationSchema };
