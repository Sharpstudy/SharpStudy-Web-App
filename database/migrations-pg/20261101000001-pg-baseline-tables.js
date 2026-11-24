'use strict';
// PostgreSQL baseline 1/3: all application tables, primary keys, defaults, NOT NULL and enum CHECK constraints.
// SQL is generated from the real MySQL schema by scripts/db/generate-pg-schema.mjs (database/migrations-pg/sql/001_tables).
const { runSqlFile, assertEmptyApplicationSchema } = require("../pg-migration-helpers");

module.exports = {
	async up(queryInterface) {
		await assertEmptyApplicationSchema(queryInterface);
		await runSqlFile(queryInterface, "001_tables.sql");
	},
	async down(queryInterface) {
		await runSqlFile(queryInterface, "001_tables.down.sql");
	},
};
