'use strict';
// Live questions asked inside an existing Jitsi class (a class = a course).
// Additive only: no existing table is altered. Timestamps are UTC.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { UUID, UUIDV4, STRING, INTEGER, BOOLEAN, DATE, TEXT, JSON, ENUM } = Sequelize;
		const timestamps = {
			created_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			updated_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
		};
		const fk = (model, allowNull = false) => ({ type: UUID, allowNull, onDelete: "CASCADE", references: { model, key: "id" } });

		await queryInterface.createTable("live_questions", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			course_id: fk("courses"),
			instructor_id: fk("users"),
			seq: { type: INTEGER, allowNull: false },
			// Only "single" (single-answer multiple choice) exists today; the column
			// leaves room for other question types.
			question_type: { type: STRING(20), allowNull: false, defaultValue: "single" },
			question_text: { type: TEXT, allowNull: false },
			options: { type: JSON, allowNull: false }, // [{ id, text }]
			correct_option_id: { type: STRING(16), allowNull: false }, // private until revealed
			explanation: { type: TEXT },
			source_question_id: { type: UUID }, // informational: existing quiz question it was copied from
			status: { type: ENUM("draft", "open", "closed", "revealed"), allowNull: false, defaultValue: "draft" },
			duration_sec: { type: INTEGER },
			allow_change: { type: BOOLEAN, allowNull: false, defaultValue: false },
			results_published: { type: BOOLEAN, allowNull: false, defaultValue: false },
			deadline_at: { type: DATE }, // server-side deadline
			opened_at: { type: DATE },
			closed_at: { type: DATE },
			revealed_at: { type: DATE },
			...timestamps,
		});
		await queryInterface.addIndex("live_questions", ["course_id", "seq"]);
		await queryInterface.addIndex("live_questions", ["course_id", "status"]);

		await queryInterface.createTable("live_question_responses", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			live_question_id: fk("live_questions"),
			user_id: fk("users"),
			option_id: { type: STRING(16), allowNull: false },
			is_correct: { type: BOOLEAN, allowNull: false },
			submitted_at: { type: DATE, allowNull: false },
			...timestamps,
		});
		// One response per student per question: the database enforces it.
		await queryInterface.addIndex("live_question_responses", ["live_question_id", "user_id"], { unique: true });
	},

	async down(queryInterface) {
		await queryInterface.dropTable("live_question_responses");
		await queryInterface.dropTable("live_questions");
	},
};
