'use strict';
// Additive only; nothing existing is altered in behaviour.
//  - lc_classes.enrollment_mode: "open" (default, every existing session: eligible students
//    book their own seat) or "assigned" (the instructor chose the students).
//  - notifications: in-app notifications with a unique dedupe_key so a retried operation
//    never notifies twice. email_status records the e-mail outcome separately.
//  - live_question_images: images for live questions, stored in the database (private,
//    served only through an authorised API route) because the project has no private file store.
//  - live_questions.image_id: optional image shown with the question.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { CHAR, STRING, TEXT, DATE, INTEGER, ENUM, BLOB } = Sequelize;
		const ts = {
			created_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			updated_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
		};

		const classes = await queryInterface.describeTable("lc_classes");
		if (!classes.enrollment_mode) {
			await queryInterface.addColumn("lc_classes", "enrollment_mode", { type: ENUM("open", "assigned"), allowNull: false, defaultValue: "open" });
		}

		const lq = await queryInterface.describeTable("live_questions");
		if (!lq.image_id) await queryInterface.addColumn("live_questions", "image_id", { type: CHAR(36).BINARY, allowNull: true });

		if (!(await queryInterface.tableExists("live_question_images"))) {
			await queryInterface.createTable("live_question_images", {
				id: { type: CHAR(36).BINARY, primaryKey: true, allowNull: false },
				course_id: { type: CHAR(36).BINARY, allowNull: false, onDelete: "CASCADE", references: { model: "courses", key: "id" } },
				class_id: { type: CHAR(36).BINARY, allowNull: true, onDelete: "CASCADE", references: { model: "lc_classes", key: "id" } },
				uploader_id: { type: CHAR(36).BINARY, allowNull: false, onDelete: "CASCADE", references: { model: "users", key: "id" } },
				mime: { type: STRING(32), allowNull: false },
				size: { type: INTEGER, allowNull: false },
				data: { type: "MEDIUMBLOB", allowNull: false },
				...ts,
			});
			await queryInterface.addIndex("live_question_images", ["course_id", "class_id"], { name: "ix_lqi_scope" });
		}

		if (!(await queryInterface.tableExists("notifications"))) {
			await queryInterface.createTable("notifications", {
				id: { type: CHAR(36).BINARY, primaryKey: true, allowNull: false },
				user_id: { type: CHAR(36).BINARY, allowNull: false, onDelete: "CASCADE", references: { model: "users", key: "id" } },
				type: { type: STRING(40), allowNull: false },
				title: { type: STRING(200), allowNull: false },
				body: { type: TEXT },
				link: { type: STRING(300) },
				ref_id: { type: CHAR(36).BINARY }, // e.g. the live session id
				dedupe_key: { type: STRING(190), allowNull: false },
				email_status: { type: ENUM("none", "sent", "skipped", "failed"), allowNull: false, defaultValue: "none" },
				read_at: { type: DATE },
				...ts,
			});
			await queryInterface.addIndex("notifications", ["dedupe_key"], { unique: true, name: "uq_notifications_dedupe" });
			await queryInterface.addIndex("notifications", ["user_id", "created_at"], { name: "ix_notifications_user" });
		}
	},

	async down(queryInterface) {
		await queryInterface.dropTable("notifications");
		await queryInterface.dropTable("live_question_images");
		await queryInterface.removeColumn("live_questions", "image_id");
		await queryInterface.removeColumn("lc_classes", "enrollment_mode");
	},
};
