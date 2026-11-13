'use strict';
// Parent link codes, and retirement of the short-lived self-service "Parent / Family" role.
//
// Business rule: learner profiles are created by instructors/administrators; a parent can only be LINKED to an
// existing profile, with a single-use code issued by an authorised adult. So:
//  - fam_link_codes: the codes (only an HMAC is stored), single use, expiring.
//  - the reserved "Parent / Family" role (which granted learners.create to self-registered parents) is removed
//    together with its assignments. Nothing else is touched: no learner, enrolment, progress or guardian row is
//    changed, and no ownership moves. Idempotent; down() only drops the table (the role is not recreated).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { UUID, UUIDV4, STRING, DATE, ENUM } = Sequelize;
		const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === "string" ? t : t.tableName));
		if (!tables.includes("fam_link_codes")) {
			await queryInterface.createTable("fam_link_codes", {
				id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
				learner_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "ml_learners", key: "id" } },
				issued_by: { type: UUID, allowNull: false },
				code_hash: { type: STRING(64), allowNull: false },
				status: { type: ENUM("open", "used", "cancelled"), allowNull: false, defaultValue: "open" },
				expires_at: { type: DATE, allowNull: false },
				used_by: { type: UUID },
				used_at: { type: DATE },
				created_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
				updated_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			});
			await queryInterface.addIndex("fam_link_codes", ["code_hash"], { unique: true, name: "uq_fam_link_hash" });
			await queryInterface.addIndex("fam_link_codes", ["learner_id", "status"]);
		}
		const [roles] = await queryInterface.sequelize.query("SELECT id FROM ml_roles WHERE name = 'Parent / Family'");
		for (const r of roles) {
			await queryInterface.sequelize.query("DELETE FROM ml_user_roles WHERE role_id = :id", { replacements: { id: r.id } });
			await queryInterface.sequelize.query("DELETE FROM ml_roles WHERE id = :id", { replacements: { id: r.id } });
		}
	},
	async down(queryInterface) {
		await queryInterface.dropTable("fam_link_codes");
	},
};
