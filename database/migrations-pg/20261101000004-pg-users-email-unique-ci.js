'use strict';
// INTENTIONAL DIFFERENCE FROM MYSQL (approved migration decision): e-mail addresses are unique case-insensitively.
//
// MySQL compared e-mails with a case-insensitive collation (utf8mb4_0900_ai_ci); PostgreSQL compares text exactly,
// so "Bob@x.com" and "bob@x.com" would become two accounts. This index closes that gap. The application also
// lowercases e-mails on write and on lookup (Phase 4). The source data has no duplicates (checked: 21 users, 0 duplicates).
module.exports = {
	async up(queryInterface) {
		const sequelize = queryInterface.sequelize;
		if (sequelize.getDialect() !== "postgres") throw new Error("PostgreSQL only");
		await sequelize.transaction(async (transaction) => {
			await sequelize.query('CREATE UNIQUE INDEX "uq_users_email_lower" ON "users" (lower("email"))', { transaction });
		});
	},
	async down(queryInterface) {
		await queryInterface.sequelize.query('DROP INDEX "uq_users_email_lower"');
	},
};
