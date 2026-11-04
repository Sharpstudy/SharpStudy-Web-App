'use strict';
// A single-row table that approvers lock (SELECT ... FOR UPDATE) so that "check for
// overlapping approved meetings, then approve" is serialised across all server
// instances. Additive; holds no data beyond the one row.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		await queryInterface.createTable("meeting_schedule_lock", {
			id: { type: Sequelize.TINYINT, primaryKey: true, allowNull: false },
		});
		await queryInterface.sequelize.query("INSERT IGNORE INTO meeting_schedule_lock (id) VALUES (1)");
	},
	async down(queryInterface) {
		await queryInterface.dropTable("meeting_schedule_lock");
	},
};
