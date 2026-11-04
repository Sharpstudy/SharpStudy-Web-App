'use strict';
// Instructor applications and their status history. Additive only: two new
// tables plus a profile table. Nothing is dropped, no existing
// user role is changed, and down() removes only what up() created.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { UUID, UUIDV4, STRING, INTEGER, DATE, TEXT, ENUM, BOOLEAN } = Sequelize;
		const JSONT = Sequelize.JSON;
		const timestamps = {
			created_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			updated_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
		};
		const STATUS = ["draft", "pending", "under_review", "more_info_requested", "approved", "rejected", "revoked"];
		const EMAIL = ["none", "pending", "sent", "failed", "skipped"];

		await queryInterface.createTable("instructor_applications", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			// One application row per account; re-applying reopens it (history is kept in the events table).
			user_id: { type: UUID, allowNull: false, unique: true, onDelete: "CASCADE", references: { model: "users", key: "id" } },
			status: { type: ENUM(...STATUS), allowNull: false, defaultValue: "draft" },
			attempt: { type: INTEGER, allowNull: false, defaultValue: 1 },
			version: { type: INTEGER, allowNull: false, defaultValue: 0 }, // optimistic concurrency

			// --- applicant-provided (validated server-side) ---
			full_name: { type: STRING(120) },
			phone: { type: STRING(40) },
			country: { type: STRING(80) },
			location: { type: STRING(120) },
			education_level: { type: STRING(40) },
			degree: { type: STRING(160) },
			institution: { type: STRING(160) },
			graduation_year: { type: INTEGER },
			certifications: { type: TEXT },
			profession: { type: STRING(120) },
			has_teaching_experience: { type: BOOLEAN },
			teaching_years: { type: INTEGER },
			teaching_modes: { type: JSONT },
			student_levels: { type: JSONT },
			prior_experience: { type: TEXT },
			subjects: { type: JSONT }, // [{id,name}] resolved against categories
			topics: { type: TEXT },
			languages: { type: STRING(200) },
			expertise_notes: { type: TEXT },
			sample_kind: { type: ENUM("video", "document", "lesson_plan") },
			sample_url: { type: STRING(500) },
			sample_title: { type: STRING(160) },
			sample_outline: { type: TEXT },
			methodology: { type: TEXT },
			material_url: { type: STRING(500) },
			motivation: { type: TEXT },
			agreed_policies: { type: BOOLEAN, allowNull: false, defaultValue: false },
			consented_privacy: { type: BOOLEAN, allowNull: false, defaultValue: false },

			// --- admin side (never returned to the applicant, except applicant_feedback) ---
			admin_notes: { type: TEXT },
			rubric: { type: JSONT },
			applicant_feedback: { type: TEXT },
			submitted_at: { type: DATE },
			reviewed_by: { type: UUID, allowNull: true, onDelete: "SET NULL", references: { model: "users", key: "id" } },
			reviewed_at: { type: DATE },
			decided_at: { type: DATE },
			reapply_after: { type: DATE },

			// Notification bookkeeping: a failed e-mail never undoes the recorded decision.
			notify_kind: { type: STRING(32) },
			notify_status: { type: ENUM(...EMAIL), allowNull: false, defaultValue: "none" },
			notify_error: { type: STRING(300) },
			...timestamps,
		});
		await queryInterface.addIndex("instructor_applications", ["status", "submitted_at"]);
		await queryInterface.addIndex("instructor_applications", ["full_name"]);

		await queryInterface.createTable("instructor_application_events", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			application_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "instructor_applications", key: "id" } },
			from_status: { type: STRING(24) },
			to_status: { type: STRING(24), allowNull: false },
			actor: { type: STRING(12), allowNull: false }, // applicant | admin | system
			actor_user_id: { type: UUID, allowNull: true, onDelete: "SET NULL", references: { model: "users", key: "id" } },
			feedback: { type: TEXT }, // applicant-visible message
			internal_note: { type: TEXT }, // admin only
			...timestamps,
		});
		await queryInterface.addIndex("instructor_application_events", ["application_id", "created_at"]);

		// Teaching profile of an approved instructor. A separate table (not new users columns) so
		// every existing users query keeps working before and after this migration runs.
		await queryInterface.createTable("instructor_profiles", {
			user_id: { type: UUID, primaryKey: true, onDelete: "CASCADE", references: { model: "users", key: "id" } },
			qualifications: { type: TEXT },
			languages: { type: STRING(200) },
			subjects: { type: STRING(300) },
			experience: { type: TEXT },
			...timestamps,
		});
	},

	async down(queryInterface) {
		await queryInterface.dropTable("instructor_profiles");
		await queryInterface.dropTable("instructor_application_events");
		await queryInterface.dropTable("instructor_applications");
	},
};
