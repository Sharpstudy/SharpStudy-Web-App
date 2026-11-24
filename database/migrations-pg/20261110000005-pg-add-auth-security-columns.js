'use strict';
// PostgreSQL copy of database/migrations/20261110000000-add-auth-security-columns.js (same columns, same names, same meaning; see that file).
// ADDITIVE ONLY: seven new nullable / defaulted columns on `users` and two unique indexes. Nothing existing is changed, dropped or rewritten.
//
// Written as plain SQL with UNQUALIFIED names on purpose: it applies to whatever schema is first on the connection's search_path (the
// normal `public`, or a throw-away test schema pinned with PG_SEARCH_PATH). Sequelize's queryInterface helpers (describeTable / addColumn)
// default to the "public" schema for PostgreSQL and ignore the search_path, which made an earlier version of this file alter the wrong
// schema during a test. IF NOT EXISTS / IF EXISTS keep it safe to run more than once. down() removes only what up() added.
const COLUMNS = [
	['password_reset_token_hash', 'char(64)'],
	['password_reset_expires_at', 'timestamptz'],
	['password_reset_requested_at', 'timestamptz'],
	['password_changed_at', 'timestamptz'],
	['failed_login_count', 'integer NOT NULL DEFAULT 0'],
	['locked_until', 'timestamptz'],
	['google_sub', 'varchar(64)'],
];
const INDEXES = [
	['uq_users_password_reset_token_hash', 'password_reset_token_hash'],
	['uq_users_google_sub', 'google_sub'],
];

module.exports = {
	async up(queryInterface) {
		const sequelize = queryInterface.sequelize;
		if (sequelize.getDialect() !== 'postgres') throw new Error('PostgreSQL only');
		await sequelize.transaction(async (transaction) => {
			// refuse to run when `users` is not visible on the search_path (it would otherwise fail halfway)
			const [[t]] = await sequelize.query("SELECT to_regclass('users') AS t", { transaction });
			if (!t) throw new Error('table "users" is not on the current search_path: nothing was changed');
			for (const [name, type] of COLUMNS) await sequelize.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "${name}" ${type}`, { transaction });
			for (const [name, col] of INDEXES) await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS "${name}" ON "users" ("${col}")`, { transaction });
		});
	},

	async down(queryInterface) {
		const sequelize = queryInterface.sequelize;
		await sequelize.transaction(async (transaction) => {
			for (const [name] of INDEXES) await sequelize.query(`DROP INDEX IF EXISTS "${name}"`, { transaction });
			for (const [name] of COLUMNS) await sequelize.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "${name}"`, { transaction });
		});
	},
};
