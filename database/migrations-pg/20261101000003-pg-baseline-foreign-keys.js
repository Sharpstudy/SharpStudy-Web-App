'use strict';
// PostgreSQL baseline 3/3: foreign keys with the MySQL delete rules.
// SQL is generated from the real MySQL schema by scripts/db/generate-pg-schema.mjs (database/migrations-pg/sql/003_foreign_keys).
const { runSqlFile } = require("../pg-migration-helpers");

module.exports = {
	async up(queryInterface) {
		await runSqlFile(queryInterface, "003_foreign_keys.sql");
	},
	async down(queryInterface) {
		await runSqlFile(queryInterface, "003_foreign_keys.down.sql");
	},
};
