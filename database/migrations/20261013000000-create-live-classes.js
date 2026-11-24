'use strict';
// Scheduled live classes ("sessions"), their seats and their attendance.
//
// This migration was already applied to the development database (it is listed
// in SequelizeMeta) but the file was missing from the repository. It is restored
// here so fresh databases get the same tables. Every table is guarded with
// hasTable, so running it against a database that already has them changes
// nothing. The unused lc_quiz_* tables of that earlier schema are not recreated.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { CHAR, STRING, TEXT, DATE, INTEGER, ENUM } = Sequelize;
		const id = { type: CHAR(36).BINARY, primaryKey: true, allowNull: false };
		const ref = (model, allowNull, onDelete) => ({ type: CHAR(36).BINARY, allowNull, onDelete, references: { model, key: "id" } });
		const ts = {
			created_at: { allowNull: false, type: DATE(3), defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)") },
			updated_at: { allowNull: false, type: DATE(3), defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)") },
		};

		if (!(await queryInterface.tableExists("lc_classes"))) {
			await queryInterface.createTable("lc_classes", {
				id,
				instructor_id: ref("users", false, "CASCADE"),
				title: { type: STRING(160), allowNull: false },
				description: { type: TEXT },
				subject: { type: STRING(80), allowNull: false },
				course_id: ref("courses", true, "SET NULL"),
				start_at: { type: DATE(3), allowNull: false },
				end_at: { type: DATE(3), allowNull: false },
				time_zone: { type: STRING(64), allowNull: false },
				provider: { type: ENUM("jitsi", "external"), allowNull: false, defaultValue: "jitsi" },
				meeting_url: { type: STRING(500) },
				room_name: { type: STRING(80), allowNull: false },
				status: { type: ENUM("scheduled", "live", "completed", "cancelled"), allowNull: false, defaultValue: "scheduled" },
				started_at: { type: DATE(3) },
				ended_at: { type: DATE(3) },
				cancelled_at: { type: DATE(3) },
				...ts,
			});
			await queryInterface.addIndex("lc_classes", ["room_name"], { unique: true, name: "uq_lc_classes_room" });
			await queryInterface.addIndex("lc_classes", ["instructor_id", "start_at"], { name: "ix_lc_classes_instructor" });
			await queryInterface.addIndex("lc_classes", ["status", "start_at"], { name: "ix_lc_classes_status" });
		}

		if (!(await queryInterface.tableExists("lc_enrolments"))) {
			await queryInterface.createTable("lc_enrolments", {
				id,
				class_id: ref("lc_classes", false, "CASCADE"),
				participant_key: { type: STRING(64), allowNull: false },
				user_id: ref("users", true, "CASCADE"),
				learner_id: ref("ml_learners", true, "CASCADE"),
				display_name: { type: STRING(120), allowNull: false },
				added_by: ref("users", true, "SET NULL"),
				...ts,
			});
			await queryInterface.addIndex("lc_enrolments", ["class_id", "participant_key"], { unique: true, name: "uq_lc_enrol_participant" });
			await queryInterface.addIndex("lc_enrolments", ["participant_key"], { name: "ix_lc_enrol_participant" });
		}

		if (!(await queryInterface.tableExists("lc_attendance"))) {
			await queryInterface.createTable("lc_attendance", {
				id,
				class_id: ref("lc_classes", false, "CASCADE"),
				participant_key: { type: STRING(64), allowNull: false },
				display_name: { type: STRING(120), allowNull: false },
				status: { type: ENUM("present", "late", "absent", "excused"), allowNull: false, defaultValue: "present" },
				source: { type: ENUM("auto", "instructor"), allowNull: false, defaultValue: "auto" },
				first_joined_at: { type: DATE(3) },
				last_seen_at: { type: DATE(3) },
				left_at: { type: DATE(3) },
				total_seconds: { type: INTEGER, allowNull: false, defaultValue: 0 },
				note: { type: STRING(300) },
				...ts,
			});
			await queryInterface.addIndex("lc_attendance", ["class_id", "participant_key"], { unique: true, name: "uq_lc_attendance_participant" });
			await queryInterface.addIndex("lc_attendance", ["participant_key"], { name: "ix_lc_attendance_participant" });
		}
	},

	// Not dropped on rollback: these tables may hold data created before this file existed.
	async down() {},
};
