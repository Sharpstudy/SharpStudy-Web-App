'use strict';
// Additive only. Existing learner profiles, progress and attempts are untouched.
//  - ml_learners: school grade (LKG, UKG, C1..C7), optional date of birth (age is derived from it),
//    optional parent/guardian contact.
//  - ml_assignments / ml_assignment_targets: a worksheet an instructor assigns to one or more
//    learners. The target row only records start/completion and points at the graded attempt;
//    scores always come from ml_attempts.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { UUID, UUIDV4, STRING, INTEGER, DATE, DATEONLY, TEXT, ENUM } = Sequelize;
		const timestamps = {
			created_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			updated_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
		};

		const cols = await queryInterface.describeTable("ml_learners");
		const add = async (name, def) => {
			if (!cols[name]) await queryInterface.addColumn("ml_learners", name, def);
		};
		await add("grade", { type: STRING(4), allowNull: true });
		await add("birth_date", { type: DATEONLY, allowNull: true });
		await add("contact_name", { type: STRING(80), allowNull: true });
		await add("contact_phone", { type: STRING(32), allowNull: true });
		await add("contact_email", { type: STRING(120), allowNull: true });

		if (!(await queryInterface.tableExists("ml_assignments"))) {
			await queryInterface.createTable("ml_assignments", {
				id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
				created_by: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "users", key: "id" } },
				course_id: { type: UUID, allowNull: true, onDelete: "SET NULL", references: { model: "courses", key: "id" } },
				title: { type: STRING(160), allowNull: false },
				subject: { type: STRING(16), allowNull: false },
				level_id: { type: STRING(32), allowNull: false },
				set_id: { type: STRING(40), allowNull: false },
				worksheet_no: { type: INTEGER, allowNull: false },
				grade: { type: STRING(4), allowNull: true }, // grade the work was chosen for (informational)
				group_label: { type: STRING(80), allowNull: true },
				instructions: { type: TEXT },
				due_at: { type: DATE },
				status: { type: ENUM("active", "cancelled"), allowNull: false, defaultValue: "active" },
				...timestamps,
			});
			await queryInterface.addIndex("ml_assignments", ["created_by", "created_at"], { name: "ix_ml_assignments_creator" });
		}

		if (!(await queryInterface.tableExists("ml_assignment_targets"))) {
			await queryInterface.createTable("ml_assignment_targets", {
				id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
				assignment_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "ml_assignments", key: "id" } },
				learner_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "ml_learners", key: "id" } },
				started_at: { type: DATE },
				attempt_id: { type: UUID }, // the graded ml_attempts row; set only by a stored submission
				completed_at: { type: DATE },
				...timestamps,
			});
			await queryInterface.addIndex("ml_assignment_targets", ["assignment_id", "learner_id"], { unique: true, name: "uq_ml_assignment_target" });
			await queryInterface.addIndex("ml_assignment_targets", ["learner_id"], { name: "ix_ml_assignment_targets_learner" });
		}
	},

	async down(queryInterface) {
		await queryInterface.dropTable("ml_assignment_targets");
		await queryInterface.dropTable("ml_assignments");
		for (const c of ["contact_email", "contact_phone", "contact_name", "birth_date", "grade"]) await queryInterface.removeColumn("ml_learners", c);
	},
};
