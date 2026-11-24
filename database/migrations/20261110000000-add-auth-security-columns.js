'use strict';
// Password reset, session revocation, sign-in lockout and Google sign-in support. ADDITIVE ONLY: seven new columns on `users`
// (and two unique indexes). No existing column, row, role or relationship is changed, dropped or rewritten.
//
//   password_reset_token_hash   SHA-256 (hex) of the one-time reset token. The token itself is only ever e-mailed; it is never stored.
//   password_reset_expires_at   when that token stops working
//   password_reset_requested_at when it was issued (used to throttle new requests per account)
//   password_changed_at         set on every password change / reset. A login token issued BEFORE this moment is rejected, so a reset
//                               signs out every other session.
//   failed_login_count          consecutive wrong-password sign-ins (reset on success); drives a short per-account lockout that works across servers
//   locked_until                sign-in is refused (with the same generic message) until this moment
//   google_sub                  Google's stable account identifier ("sub") once the account is linked to a Google identity
//
// These are deliberately NOT the e-mail confirmation columns (reset_password_token / reset_password_send_at stay exactly as they were).
//
// Safe to run more than once: each column / index is added only when it does not exist. down() removes only what this adds.
// Also exists as database/migrations-pg/20261110000005-pg-add-auth-security-columns.js (same content, PostgreSQL migration history).

const TABLE = 'users';
const COLUMNS = (Sequelize) => ({
	password_reset_token_hash: { type: Sequelize.CHAR(64), allowNull: true },
	password_reset_expires_at: { type: Sequelize.DATE, allowNull: true },
	password_reset_requested_at: { type: Sequelize.DATE, allowNull: true },
	password_changed_at: { type: Sequelize.DATE, allowNull: true },
	failed_login_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
	locked_until: { type: Sequelize.DATE, allowNull: true },
	google_sub: { type: Sequelize.STRING(64), allowNull: true },
});
const INDEXES = [
	{ name: 'uq_users_password_reset_token_hash', fields: ['password_reset_token_hash'] },
	{ name: 'uq_users_google_sub', fields: ['google_sub'] },
];

module.exports = {
	async up(queryInterface, Sequelize) {
		const table = await queryInterface.describeTable(TABLE);
		for (const [name, def] of Object.entries(COLUMNS(Sequelize))) {
			if (!table[name]) await queryInterface.addColumn(TABLE, name, def);
		}
		const existing = (await queryInterface.showIndex(TABLE)).map((i) => i.name);
		for (const ix of INDEXES) {
			if (!existing.includes(ix.name)) await queryInterface.addIndex(TABLE, ix.fields, { name: ix.name, unique: true });
		}
	},

	async down(queryInterface) {
		const existing = (await queryInterface.showIndex(TABLE)).map((i) => i.name);
		for (const ix of INDEXES) {
			if (existing.includes(ix.name)) await queryInterface.removeIndex(TABLE, ix.name);
		}
		const table = await queryInterface.describeTable(TABLE);
		for (const name of Object.keys(COLUMNS({ CHAR: () => null, DATE: null, STRING: () => null, INTEGER: null }))) {
			if (table[name]) await queryInterface.removeColumn(TABLE, name);
		}
	},
};
