'use strict';
// Mastery Ladder tables. Additive only: no existing table is altered.
// All timestamps are stored in UTC; `local_date` columns hold the learner's
// family-local calendar day (used for streaks and daily goals).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { UUID, UUIDV4, STRING, INTEGER, BOOLEAN, DATE, DATEONLY, FLOAT, TEXT, JSON, ENUM } = Sequelize;
		const timestamps = {
			created_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			updated_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
		};
		const learnerFk = {
			type: UUID,
			allowNull: false,
			onDelete: "CASCADE",
			references: { model: "ml_learners", key: "id" },
		};
		const userFk = (allowNull = false) => ({
			type: UUID,
			allowNull,
			onDelete: "CASCADE",
			references: { model: "users", key: "id" },
		});

		await queryInterface.createTable("ml_learners", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			owner_user_id: userFk(),
			display_name: { type: STRING(40), allowNull: false },
			avatar: { type: STRING(16) },
			birth_year: { type: INTEGER },
			pin_hash: { type: STRING(100), allowNull: false },
			pin_failed_attempts: { type: INTEGER, allowNull: false, defaultValue: 0 },
			pin_locked_until: { type: DATE },
			adult_mode: { type: BOOLEAN, allowNull: false, defaultValue: false },
			adult_mode_set_by: { type: UUID },
			daily_goal: { type: INTEGER, allowNull: false, defaultValue: 1 },
			time_zone: { type: STRING(64), allowNull: false, defaultValue: "UTC" },
			reminder_time: { type: STRING(5) },
			last_seen_at: { type: DATE },
			...timestamps,
		});
		await queryInterface.addIndex("ml_learners", ["owner_user_id"]);

		await queryInterface.createTable("ml_learner_guardians", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			learner_id: learnerFk,
			user_id: userFk(),
			relation: { type: ENUM("parent", "instructor"), allowNull: false },
			created_by: { type: UUID },
			...timestamps,
		});
		await queryInterface.addIndex("ml_learner_guardians", ["learner_id", "user_id"], { unique: true });
		await queryInterface.addIndex("ml_learner_guardians", ["user_id"]);

		await queryInterface.createTable("ml_subject_enrolments", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			learner_id: learnerFk,
			subject: { type: STRING(16), allowNull: false },
			active: { type: BOOLEAN, allowNull: false, defaultValue: true },
			...timestamps,
		});
		await queryInterface.addIndex("ml_subject_enrolments", ["learner_id", "subject"], { unique: true });

		await queryInterface.createTable("ml_progress", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			learner_id: learnerFk,
			subject: { type: STRING(16), allowNull: false },
			level_id: { type: STRING(8), allowNull: false },
			set_id: { type: STRING(12), allowNull: false },
			worksheet_no: { type: INTEGER, allowNull: false },
			version: { type: INTEGER, allowNull: false, defaultValue: 1 },
			updated_by: { type: STRING(80) },
			...timestamps,
		});
		await queryInterface.addIndex("ml_progress", ["learner_id", "subject"], { unique: true });

		await queryInterface.createTable("ml_attempts", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			learner_id: learnerFk,
			client_attempt_id: { type: STRING(64), allowNull: false },
			session_id: { type: STRING(64) },
			subject: { type: STRING(16), allowNull: false },
			level_id: { type: STRING(8), allowNull: false },
			set_id: { type: STRING(12), allowNull: false },
			worksheet_no: { type: INTEGER, allowNull: false },
			variant: { type: INTEGER, allowNull: false, defaultValue: 0 },
			seed: { type: STRING(80), allowNull: false },
			total: { type: INTEGER, allowNull: false },
			correct_first: { type: INTEGER, allowNull: false },
			accuracy: { type: FLOAT, allowNull: false },
			duration_ms: { type: INTEGER, allowNull: false },
			target_seconds: { type: INTEGER, allowNull: false },
			stars: { type: INTEGER, allowNull: false, defaultValue: 0 },
			status: { type: STRING(16), allowNull: false },
			outcome: { type: STRING(24), allowNull: false },
			counted: { type: BOOLEAN, allowNull: false, defaultValue: false },
			hints_used: { type: INTEGER, allowNull: false, defaultValue: 0 },
			responses: { type: JSON },
			started_at: { type: DATE, allowNull: false },
			completed_at: { type: DATE, allowNull: false },
			local_date: { type: DATEONLY, allowNull: false },
			...timestamps,
		});
		// Idempotent offline sync: one row per client-generated attempt id.
		await queryInterface.addIndex("ml_attempts", ["learner_id", "client_attempt_id"], { unique: true });
		await queryInterface.addIndex("ml_attempts", ["learner_id", "completed_at"]);
		await queryInterface.addIndex("ml_attempts", ["learner_id", "subject", "level_id", "set_id", "worksheet_no"], {
			name: "ml_attempts_worksheet",
		});

		await queryInterface.createTable("ml_daily_activity", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			learner_id: learnerFk,
			local_date: { type: DATEONLY, allowNull: false },
			worksheets: { type: INTEGER, allowNull: false, defaultValue: 0 },
			stars: { type: INTEGER, allowNull: false, defaultValue: 0 },
			seconds: { type: INTEGER, allowNull: false, defaultValue: 0 },
			...timestamps,
		});
		await queryInterface.addIndex("ml_daily_activity", ["learner_id", "local_date"], { unique: true });

		await queryInterface.createTable("ml_hint_events", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			learner_id: learnerFk,
			session_id: { type: STRING(64), allowNull: false },
			question_index: { type: INTEGER, allowNull: false },
			mode: { type: STRING(16), allowNull: false },
			...timestamps,
		});
		await queryInterface.addIndex("ml_hint_events", ["session_id"]);

		// No foreign keys: audit history must survive deletion of users/learners.
		await queryInterface.createTable("ml_audit_logs", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			actor_user_id: { type: UUID },
			actor_learner_id: { type: UUID },
			learner_id: { type: UUID },
			action: { type: STRING(64), allowNull: false },
			details: { type: JSON },
			ip: { type: STRING(64) },
			...timestamps,
		});
		await queryInterface.addIndex("ml_audit_logs", ["created_at"]);
		await queryInterface.addIndex("ml_audit_logs", ["action"]);
		await queryInterface.addIndex("ml_audit_logs", ["learner_id"]);

		await queryInterface.createTable("ml_feedback", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			user_id: { type: UUID },
			learner_id: { type: UUID },
			message: { type: TEXT, allowNull: false },
			page: { type: STRING(200) },
			screenshot: { type: TEXT("medium") },
			status: { type: ENUM("new", "reviewing", "resolved"), allowNull: false, defaultValue: "new" },
			admin_note: { type: TEXT },
			...timestamps,
		});
		await queryInterface.addIndex("ml_feedback", ["status", "created_at"]);

		await queryInterface.createTable("ml_settings", {
			key: { type: STRING(64), primaryKey: true },
			value: { type: JSON },
			updated_by: { type: UUID },
			...timestamps,
		});

		await queryInterface.createTable("ml_roles", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			name: { type: STRING(60), allowNull: false, unique: true },
			description: { type: STRING(255) },
			permissions: { type: JSON },
			...timestamps,
		});

		await queryInterface.createTable("ml_user_roles", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			user_id: userFk(),
			role_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "ml_roles", key: "id" } },
			...timestamps,
		});
		await queryInterface.addIndex("ml_user_roles", ["user_id", "role_id"], { unique: true });

		await queryInterface.createTable("ml_presence", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			kind: { type: ENUM("user", "learner"), allowNull: false },
			subject_id: { type: UUID, allowNull: false },
			path: { type: STRING(200) },
			last_seen_at: { type: DATE, allowNull: false },
			...timestamps,
		});
		await queryInterface.addIndex("ml_presence", ["kind", "subject_id"], { unique: true });
		await queryInterface.addIndex("ml_presence", ["last_seen_at"]);
	},

	// Rolls back ONLY the tables created above (children first).
	async down(queryInterface) {
		for (const t of [
			"ml_presence",
			"ml_user_roles",
			"ml_roles",
			"ml_settings",
			"ml_feedback",
			"ml_audit_logs",
			"ml_hint_events",
			"ml_daily_activity",
			"ml_attempts",
			"ml_progress",
			"ml_subject_enrolments",
			"ml_learner_guardians",
			"ml_learners",
		]) {
			await queryInterface.dropTable(t);
		}
	},
};
