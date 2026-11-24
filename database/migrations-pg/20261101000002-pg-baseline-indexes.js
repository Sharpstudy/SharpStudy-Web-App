'use strict';
// PostgreSQL baseline 2/3: unique constraints and secondary indexes.
// SQL is generated from the real MySQL schema by scripts/db/generate-pg-schema.mjs (database/migrations-pg/sql/002_indexes).
const { runSqlFile } = require("../pg-migration-helpers");

module.exports = {
	async up(queryInterface) {
		await runSqlFile(queryInterface, "002_indexes.sql");
	},
	async down(queryInterface) {
		await runSqlFile(queryInterface, "002_indexes.down.sql");
	},
};
