'use strict';
// Live sessions: one-to-one vs group, seat capacity, and linking live questions
// to a scheduled session. Additive only; existing rows keep working
// (session_type defaults to "group", class_id stays NULL for course-level questions).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const classes = await queryInterface.describeTable("lc_classes");
		if (!classes.session_type) {
			await queryInterface.addColumn("lc_classes", "session_type", {
				type: Sequelize.ENUM("group", "one_to_one"),
				allowNull: false,
				defaultValue: "group",
			});
		}
		if (!classes.capacity) {
			// Seats a session offers; always 1 for one_to_one.
			await queryInterface.addColumn("lc_classes", "capacity", { type: Sequelize.INTEGER, allowNull: false, defaultValue: 30 });
		}

		const lq = await queryInterface.describeTable("live_questions");
		if (!lq.class_id) {
			await queryInterface.addColumn("live_questions", "class_id", {
				type: Sequelize.CHAR(36).BINARY,
				allowNull: true,
				onDelete: "CASCADE",
				references: { model: "lc_classes", key: "id" },
			});
			await queryInterface.addIndex("live_questions", ["class_id", "seq"], { name: "ix_live_questions_class_seq" });
			await queryInterface.addIndex("live_questions", ["class_id", "status"], { name: "ix_live_questions_class_status" });
		}
	},

	async down(queryInterface) {
		await queryInterface.removeColumn("live_questions", "class_id");
		await queryInterface.removeColumn("lc_classes", "capacity");
		await queryInterface.removeColumn("lc_classes", "session_type");
	},
};
