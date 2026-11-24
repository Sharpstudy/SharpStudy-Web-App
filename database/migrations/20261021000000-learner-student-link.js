'use strict';
// Additive. An explicit, authorised link between an account student (users) and a learner
// profile (ml_learners). Nothing is linked by this migration; existing rows keep NULL.
// One profile per student account (unique), so a student can never end up with two.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const cols = await queryInterface.describeTable("ml_learners");
		if (!cols.student_user_id) {
			await queryInterface.addColumn("ml_learners", "student_user_id", {
				type: Sequelize.UUID,
				allowNull: true,
				onDelete: "SET NULL",
				references: { model: "users", key: "id" },
			});
			await queryInterface.addIndex("ml_learners", ["student_user_id"], { unique: true, name: "uq_ml_learners_student" });
		}
	},
	async down(queryInterface) {
		await queryInterface.removeColumn("ml_learners", "student_user_id");
	},
};
